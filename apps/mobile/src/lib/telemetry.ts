import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiFetch } from "@/lib/api/client";

/**
 * Rastro del flujo de pago.
 *
 * El porqué: cuando un cliente reporta "se quedó cargando", hoy no queda NINGÚN
 * rastro en producción — `handlePaymentSheetError` solo escribe en consola bajo
 * `__DEV__`. Con estos breadcrumbs, un reporte se lee de un vistazo: "llegó
 * `present_called` y nunca `present_resolved`".
 *
 * Dos reglas que no se negocian:
 *  1. Esto NUNCA puede romper ni frenar un cobro. Todo va en try/catch, el envío
 *     es fire-and-forget y hay como mucho una petición en vuelo.
 *  2. El buffer se persiste, porque el cliente que se cuelga MATA LA APP — sin
 *     persistir se perdería justo el caso que queremos ver.
 */

export type PaymentFlow =
  | "reservation"
  | "bath"
  | "daycare"
  | "balance"
  | "bath-upsell"
  | "bath-extras"
  | "extension";

export type PaymentEventName =
  | "intent_created"
  | "modal_gate_wait"
  | "modal_gate_timeout"
  | "init_start"
  | "init_ok"
  | "init_error"
  | "present_called"
  | "present_resolved"
  | "present_canceled"
  | "present_error"
  | "stuck_watchdog"
  | "escape_retry"
  | "escape_pi_status"
  | "escape_cancel"
  | "confirm_start"
  | "confirm_ok"
  | "confirm_error"
  | "recovered_on_launch";

type PaymentEvent = {
  event: PaymentEventName;
  at: number;
  flow: PaymentFlow;
  sessionId: string;
  ms?: number;
  paymentIntentId?: string;
  code?: string;
  detail?: string;
};

const STORAGE_KEY = "payment_telemetry_buffer";
/**
 * SecureStore no acepta valores grandes (avisa y falla por encima de ~2 KB en
 * Android). Si nos pasamos, `persist` truena, el catch se lo traga y el buffer
 * NO sobrevive al cierre de la app — que es justo para lo que existe. Por eso
 * el tope es de eventos Y de bytes.
 */
const MAX_BUFFERED = 12;
const MAX_BYTES = 1800;
const MAX_DETAIL_CHARS = 60;
const FLUSH_TIMEOUT_MS = 8000;

let buffer: PaymentEvent[] = [];
let loaded = false;
let flushing = false;

function truncate(value: string | undefined) {
  if (!value) return undefined;
  return value.length > MAX_DETAIL_CHARS
    ? `${value.slice(0, MAX_DETAIL_CHARS)}…`
    : value;
}

async function loadBuffer() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) buffer = [...parsed, ...buffer].slice(-MAX_BUFFERED);
    }
  } catch {
    // Buffer corrupto o sin acceso: se empieza de cero, no es dato crítico.
  }
}

async function persist() {
  try {
    // Se sueltan los eventos más viejos hasta que quepa: lo que importa para el
    // diagnóstico es el final del flujo, no el principio.
    let payload = JSON.stringify(buffer);
    while (buffer.length > 1 && payload.length > MAX_BYTES) {
      buffer = buffer.slice(1);
      payload = JSON.stringify(buffer);
    }
    await SecureStore.setItemAsync(STORAGE_KEY, payload);
  } catch {
    // Sin persistencia seguimos igual: en memoria alcanza para el caso normal.
  }
}

/**
 * Sesión de pago: agrupa los eventos de un mismo intento y mide el tiempo desde
 * que el cliente tocó el botón.
 */
export function startPaymentSession(flow: PaymentFlow) {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();

  return {
    sessionId,
    flow,
    track(
      event: PaymentEventName,
      fields?: { paymentIntentId?: string; code?: string; detail?: string },
    ) {
      void track({
        event,
        at: Date.now(),
        ms: Date.now() - t0,
        flow,
        sessionId,
        paymentIntentId: fields?.paymentIntentId,
        code: truncate(fields?.code),
        detail: truncate(fields?.detail),
      });
    },
  };
}

export type PaymentSession = ReturnType<typeof startPaymentSession>;

async function track(event: PaymentEvent) {
  try {
    await loadBuffer();
    buffer.push(event);
    if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
    await persist();

    // Los eventos que huelen a problema se mandan al momento; el resto espera al
    // flush diferido para no competir con el cobro por el token de Clerk.
    if (
      event.event === "stuck_watchdog" ||
      event.event === "init_error" ||
      event.event === "present_error" ||
      event.event === "confirm_error"
    ) {
      void flushPaymentTelemetry();
    }
  } catch {
    // Nunca romper el cobro por telemetría.
  }
}

/**
 * Manda lo acumulado. Si el endpoint todavía no existe (404) o falla, el buffer
 * se queda para el siguiente intento: así el OTA de hoy ya acumula evidencia
 * aunque la API se despliegue después.
 */
export async function flushPaymentTelemetry() {
  if (flushing) return;
  flushing = true;
  try {
    await loadBuffer();
    if (buffer.length === 0) return;

    const events = buffer.slice(0, MAX_BUFFERED);
    await apiFetch("/telemetry/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: events[0]?.sessionId ?? "unknown",
        app: {
          version: Constants.expoConfig?.version ?? null,
          platform: Platform.OS,
          osVersion: String(Platform.Version),
        },
        events,
      }),
      timeoutMs: FLUSH_TIMEOUT_MS,
    });

    // Solo se descarta lo que se envió: si mientras tanto entraron eventos
    // nuevos, se quedan para el siguiente flush.
    buffer = buffer.slice(events.length);
    await persist();
  } catch {
    // Se queda en el buffer. Sin ruido: esto es diagnóstico, no una función.
  } finally {
    flushing = false;
  }
}
