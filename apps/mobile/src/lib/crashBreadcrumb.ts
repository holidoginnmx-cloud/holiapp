import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { apiFetch } from "@/lib/api/client";
import { buildInfo } from "@/lib/appUpdates";

/**
 * Rastro de cierres de la app.
 *
 * El porqué: el 2026-10-01 a alguien del equipo se le cerró la app tres veces
 * al abrir el selector de fecha/hora y no quedó NINGÚN rastro — no hay Sentry
 * ni handler global, y un cierre nativo no pasa por el ErrorBoundary. Hubo que
 * pedirle el registro del iPhone por WhatsApp.
 *
 * Mismo truco que la telemetría de pagos (`present_called` sin
 * `present_resolved`): se deja una marca ANTES de abrir algo delicado y se
 * borra al cerrarlo. Si en el siguiente arranque la marca sigue ahí, la app
 * murió con eso abierto. Además se guarda el último error JS fatal, que en
 * release también cierra la app sin avisar.
 *
 * Nada de esto puede romper ni frenar la pantalla: todo va en try/catch.
 */

const OPEN_KEY = "crash_breadcrumb_open";
const FATAL_KEY = "crash_breadcrumb_fatal";
/** SecureStore falla con valores grandes (~2 KB): el stack se recorta. */
const MAX_STACK_CHARS = 1200;
const MAX_MESSAGE_CHARS = 200;
const REPORT_TIMEOUT_MS = 8000;

/**
 * Marca que se abrió algo que puede tumbar la app (p. ej. "date-picker").
 *
 * Escritura SÍNCRONA a propósito: si el cierre llega en el mismo frame, una
 * promesa pendiente se perdería con el proceso.
 */
export function markRiskyOpen(tag: string) {
  openTag = tag;
  watchAppState();
  writeOpenMark();
}

export function clearRiskyOpen() {
  openTag = null;
  SecureStore.deleteItemAsync(OPEN_KEY)
    .then(() => {
      // Cerrar y reabrir en milisegundos: este borrado pudo aterrizar DESPUÉS
      // de la marca nueva y llevársela. Si hay algo abierto, se repone.
      if (openTag) writeOpenMark();
    })
    .catch(() => {});
}

/** Lo que está abierto AHORA en este proceso (null = nada). */
let openTag: string | null = null;
let watching = false;

function writeOpenMark() {
  if (!openTag) return;
  try {
    SecureStore.setItem(OPEN_KEY, JSON.stringify({ tag: openTag, at: Date.now() }));
  } catch {
    // Sin marca seguimos igual: es diagnóstico, no una función.
  }
}

/**
 * En segundo plano la marca se quita, y se repone al volver. Sin esto, dejar
 * la app con el selector abierto y que iOS la mate por memoria (o cerrarla
 * deslizando) se reportaría como un cierre de la app, que no lo es.
 */
function watchAppState() {
  if (watching) return;
  watching = true;
  AppState.addEventListener("change", (state) => {
    if (!openTag) return;
    if (state === "active") writeOpenMark();
    else SecureStore.deleteItemAsync(OPEN_KEY).catch(() => {});
  });
}

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

let installed = false;

/**
 * Guarda el error JS fatal antes de que React Native cierre la app. Solo
 * persiste: mandar una petición desde un proceso que se está muriendo no es
 * confiable, así que el envío ocurre en el siguiente arranque.
 */
export function installFatalErrorRecorder() {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) {
      try {
        const err = error as { message?: unknown; stack?: unknown } | null;
        SecureStore.setItem(
          FATAL_KEY,
          JSON.stringify({
            message: String(err?.message ?? error).slice(0, MAX_MESSAGE_CHARS),
            stack: String(err?.stack ?? "").slice(0, MAX_STACK_CHARS),
            at: Date.now(),
          }),
        );
      } catch {
        // Nunca tapar el error original por no poder guardarlo.
      }
    }
    previous(error, isFatal);
  });
}

async function readAndParse(key: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

let reported = false;

/**
 * Manda lo que haya quedado del arranque anterior. Se llama con sesión ya
 * cargada (el endpoint pide auth). Solo se borra lo que sí se envió: si la
 * API falla, se reintenta en el próximo arranque.
 *
 * UNA vez por proceso: una segunda pasada (p. ej. al cambiar de cuenta) con un
 * selector abierto en esta misma sesión lo reportaría como cierre anterior.
 */
export async function reportPreviousCrash() {
  if (reported) return;
  reported = true;
  // Algo abierto ahora mismo: la marca es de ESTA sesión, no de la anterior.
  if (openTag) return;
  try {
    const [open, fatal] = await Promise.all([
      readAndParse(OPEN_KEY),
      readAndParse(FATAL_KEY),
    ]);
    if (!open && !fatal) return;

    const info = buildInfo();
    const app = {
      version: info.appVersion,
      buildNumber: info.buildNumber,
      runtimeVersion: info.runtimeVersion,
      updateId: info.updateId,
      platform: info.platform,
    };

    const send = (body: Record<string, unknown>) =>
      apiFetch("/telemetry/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, app }),
        timeoutMs: REPORT_TIMEOUT_MS,
      });

    if (open) {
      await send({ kind: "unclosed", tag: open.tag, at: open.at });
      await SecureStore.deleteItemAsync(OPEN_KEY);
    }
    if (fatal) {
      await send({
        kind: "js_fatal",
        message: fatal.message,
        stack: fatal.stack,
        at: fatal.at,
      });
      await SecureStore.deleteItemAsync(FATAL_KEY);
    }
  } catch {
    // Se queda guardado para el siguiente arranque.
  }
}
