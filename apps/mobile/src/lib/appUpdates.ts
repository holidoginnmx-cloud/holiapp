import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Actualizaciones por aire (OTA).
 *
 * El porqué: `expo-updates` venía instalado pero sin usarse en una sola línea, y
 * con `fallbackToCacheTimeout: 0` eso significa que un update **solo se aplica
 * en el siguiente arranque en frío**. Un cliente que deja la app en segundo
 * plano sigue con el código viejo durante días: el 2026-09-02 no hubo forma de
 * saber si a quien reportó el pago colgado le había llegado el arreglo publicado
 * dos horas antes.
 *
 * Aquí se resuelven las dos mitades del problema: enterarse de que hay bundle
 * nuevo (y tenerlo descargado) sin esperar a que el cliente mate la app, y poder
 * saber qué versión trae puesta.
 *
 * REGLA: la app NUNCA se recarga sola. Recargar es perder lo que la persona
 * estuviera escribiendo — o peor, cortar un cobro a media hoja de Stripe. Aquí
 * solo se descarga y se levanta la bandera; quien decide es quien toca
 * "Actualizar ahora" en el aviso (src/components/UpdateBanner.tsx).
 */

// ── Estado observable ───────────────────────────────────────────────────────
//
// Un mini-store de módulo en vez de zustand/context: esto lo consume un solo
// componente y tiene que poder escribirse desde fuera de React (el check corre
// en un listener de AppState).

type Listener = () => void;

const listeners = new Set<Listener>();

/** Hay un bundle nuevo descargado y listo para aplicarse con un reload. */
let updateReady = false;
/** Mientras `Date.now()` sea menor, el aviso no se muestra (lo pospusieron). */
let snoozedUntil = 0;
/** Flujos que no se pueden interrumpir (cobros). El aviso se esconde. */
let criticalFlows = 0;
/** Última comprobación, para no preguntar en cada vuelta a primer plano. */
let lastCheckAt = 0;
/** Una sola comprobación en vuelo. */
let checkInFlight: Promise<boolean> | null = null;
let snoozeTimer: ReturnType<typeof setTimeout> | null = null;

/** Al posponer, el aviso vuelve más tarde: no se pierde, solo no estorba. */
const SNOOZE_MS = 2 * 60 * 60 * 1000; // 2 h
/** Piso entre comprobaciones: volver de segundo plano 10 veces no son 10 checks. */
const CHECK_THROTTLE_MS = 15 * 60 * 1000; // 15 min

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeToUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * ¿Se debe ver el aviso ahora mismo? Devuelve un booleano (primitivo) a
 * propósito: es lo que `useSyncExternalStore` puede comparar sin sobresaltos.
 */
export function isUpdateNoticeVisible(): boolean {
  if (!updateReady) return false;
  if (criticalFlows > 0) return false;
  return Date.now() >= snoozedUntil;
}

/**
 * Candado de flujos que no se pueden interrumpir. Enseñar "Actualizar ahora"
 * junto a la hoja de pago sería una invitación a perder un cobro a la mitad.
 */
export function beginCriticalFlow() {
  criticalFlows += 1;
  notify();
}

export function endCriticalFlow() {
  criticalFlows = Math.max(0, criticalFlows - 1);
  notify();
}

/** "Ahora no". El aviso desaparece y vuelve en un par de horas. */
export function snoozeUpdateNotice() {
  snoozedUntil = Date.now() + SNOOZE_MS;
  if (snoozeTimer) clearTimeout(snoozeTimer);
  // Sin este timer, el aviso solo reaparecería la próxima vez que algo más
  // provocara un notify(): podría no volver nunca en esa sesión.
  snoozeTimer = setTimeout(() => {
    snoozeTimer = null;
    notify();
  }, SNOOZE_MS);
  notify();
}

// ── Diagnóstico ─────────────────────────────────────────────────────────────

/** Datos de build para soporte: "mándame esto por WhatsApp". */
export function buildInfo() {
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : null;
  return {
    appVersion: Constants.expoConfig?.version ?? "?",
    buildNumber:
      Platform.OS === "ios"
        ? (Constants.expoConfig?.ios?.buildNumber ?? "?")
        : String(Constants.expoConfig?.android?.versionCode ?? "?"),
    runtimeVersion:
      typeof Updates.runtimeVersion === "string" ? Updates.runtimeVersion : null,
    channel: Updates.channel ?? null,
    updateId,
    /** true = corriendo el código que venía en el binario, sin OTA encima. */
    isEmbedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt ? Updates.createdAt.toISOString() : null,
    platform: `${Platform.OS} ${String(Platform.Version)}`,
  };
}

/** Línea corta para pintar en pantalla: "1.3.0 (29) · a1b2c3d4". */
export function buildLabel() {
  const info = buildInfo();
  const suffix = info.updateId ? ` · ${info.updateId}` : " · base";
  return `${info.appVersion} (${info.buildNumber})${suffix}`;
}

/** Bloque para compartir con soporte. */
export function buildDiagnostics() {
  const info = buildInfo();
  return [
    `App: ${info.appVersion} (${info.buildNumber})`,
    `Runtime: ${info.runtimeVersion ?? "?"}`,
    `Canal: ${info.channel ?? "?"}`,
    `Update: ${info.updateId ?? "ninguno (versión base)"}`,
    `Publicado: ${info.createdAt ?? "—"}`,
    `Dispositivo: ${info.platform}`,
  ].join("\n");
}

// ── Comprobación y descarga ─────────────────────────────────────────────────

/**
 * Busca y descarga un update. NO recarga: solo levanta la bandera para que
 * aparezca el aviso.
 *
 * Nunca lanza: un fallo de red aquí no es un problema del que enterar a nadie,
 * y desde luego no puede romper el arranque. Se reintenta la próxima vez que la
 * app vuelva a primer plano.
 *
 * @param force Ignora el throttle (para un botón manual de "buscar ahora").
 */
export function checkForUpdate(force = false): Promise<boolean> {
  // En desarrollo el bundle lo sirve Metro: preguntar por updates no tiene
  // sentido y `checkForUpdateAsync` además revienta.
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve(false);
  if (updateReady) return Promise.resolve(true);
  if (checkInFlight) return checkInFlight;
  if (!force && lastCheckAt && Date.now() - lastCheckAt < CHECK_THROTTLE_MS) {
    return Promise.resolve(false);
  }

  const run = (async () => {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return false;
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) return false;
      updateReady = true;
      // Un update nuevo cancela cualquier "ahora no" anterior: es otra versión,
      // y probablemente la que trae el arreglo que se está esperando.
      snoozedUntil = 0;
      if (snoozeTimer) {
        clearTimeout(snoozeTimer);
        snoozeTimer = null;
      }
      notify();
      return true;
    } catch {
      return false;
    } finally {
      lastCheckAt = Date.now();
      checkInFlight = null;
    }
  })();

  checkInFlight = run;
  return run;
}

/**
 * Aplica el update descargado. Solo debe llamarse desde el botón del aviso:
 * es la persona la que elige el momento.
 */
export async function applyUpdateNow(): Promise<boolean> {
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // Si el reload falla (raro), el aviso se queda donde estaba y se puede
    // volver a intentar; en el peor caso entra en el próximo arranque.
    return false;
  }
}
