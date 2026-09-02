import { useCallback, useEffect, useRef } from "react";
import { InteractionManager, Platform } from "react-native";

/**
 * Registro de los modales que están REALMENTE presentados en pantalla.
 *
 * El porqué: en iOS un `Modal` de React Native es un view controller presentado.
 * Si Stripe intenta abrir su hoja de pago mientras uno de esos modales todavía
 * se está descartando, la presentación falla en silencio y la promesa de
 * `presentPaymentSheet` NUNCA resuelve — el botón se queda girando para siempre.
 *
 * No basta con mirar la prop `visible`: entre que se pone en `false` y que UIKit
 * termina la animación pasan ~350 ms, y ahí es donde se pierde la carrera. Este
 * registro se da de baja con el descarte REAL (`onDismiss` en iOS,
 * `runAfterInteractions` en Android), que es lo que de verdad importa.
 */

const presented = new Set<string>();
const listeners = new Set<() => void>();

let seq = 0;

/**
 * Tope de edad. En iOS, si hubo una transición encadenada (un modal cerrándose
 * mientras otro se presenta), UIKit puede tragarse el `onDismiss` y no llamarlo
 * nunca. Sin este tope, la compuerta se quedaría cerrada para siempre y el cobro
 * no arrancaría — que es un fallo peor que el que estamos arreglando.
 */
const MAX_DISMISS_WAIT_MS = 1500;

/**
 * Respiro después de que se vacía el registro. `onDismiss` llega al completar la
 * animación, pero UIKit agradece un frame antes de presentar encima.
 */
const SETTLE_MS = 50;

function notify() {
  for (const listener of listeners) listener();
}

export function markPresented(id: string) {
  presented.add(id);
}

export function markDismissed(id: string) {
  if (presented.delete(id)) notify();
}

/** Solo para pruebas y diagnóstico. */
export function presentedCount() {
  return presented.size;
}

/**
 * Sigue el ciclo de vida real de un `Modal`. Devuelve el `onDismiss` que hay que
 * pasarle al `<Modal>` (en Android va `undefined`: esa prop es solo de iOS).
 */
export function useTrackedModal(visible: boolean) {
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = `modal-${++seq}`;
  const id = idRef.current;

  useEffect(() => {
    if (visible) markPresented(id);
  }, [visible, id]);

  // Baja del registro cuando se pide cerrar. En iOS la señal buena es
  // `onDismiss` (abajo); esto es la red por si no llega, y en Android es el
  // mecanismo principal porque `Modal` no tiene `onDismiss` ahí.
  const wasVisible = useRef(visible);
  useEffect(() => {
    const wasOpen = wasVisible.current;
    wasVisible.current = visible;
    if (!wasOpen || visible) return;

    const task =
      Platform.OS === "android"
        ? InteractionManager.runAfterInteractions(() => markDismissed(id))
        : null;
    const timer = setTimeout(() => markDismissed(id), MAX_DISMISS_WAIT_MS);

    return () => {
      task?.cancel();
      clearTimeout(timer);
    };
  }, [visible, id]);

  // Si la pantalla se desmonta con el modal abierto, el registro no puede
  // quedarse con un id vivo: bloquearía la compuerta de todos los cobros.
  useEffect(() => () => markDismissed(id), [id]);

  const handleDismiss = useCallback(() => markDismissed(id), [id]);

  return Platform.OS === "ios" ? handleDismiss : undefined;
}

/**
 * Espera a que no quede ningún modal presentado. Se llama justo antes de abrir
 * la hoja de pago de Stripe.
 *
 * Devuelve `true` si la pantalla quedó libre y `false` si se agotó la espera —
 * en ese caso se sigue adelante igual (mejor intentar el cobro que dejar al
 * cliente sin poder pagar), pero el caller deja un breadcrumb para saber que
 * este camino se usó.
 */
export function waitForNoPresentedModal(maxWaitMs = 4000): Promise<boolean> {
  // Ojo con el atajo: el caso caliente es justo este — el cobro arranca desde el
  // `onDismiss` que acaba de vaciar el registro. Devolver aquí sin esperar el
  // respiro deja a Stripe presentando en el mismo frame del descarte, que es
  // exactamente lo que rompe. El respiro se paga siempre; son 50 ms.
  if (presented.size === 0) {
    return new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SETTLE_MS));
  }

  return new Promise<boolean>((resolve) => {
    let done = false;

    const finish = (clean: boolean) => {
      if (done) return;
      done = true;
      listeners.delete(check);
      clearTimeout(timer);
      if (clean) setTimeout(() => resolve(true), SETTLE_MS);
      else resolve(false);
    };

    const check = () => {
      if (presented.size === 0) finish(true);
    };

    const timer = setTimeout(() => finish(false), maxWaitMs);
    listeners.add(check);
  });
}
