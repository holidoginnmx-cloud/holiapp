import * as SecureStore from "expo-secure-store";
import { apiFetch } from "@/lib/api/client";
import {
  startPaymentSession,
  flushPaymentTelemetry,
  type PaymentFlow,
} from "@/lib/telemetry";

/**
 * Confirmación pendiente de un cobro que YA se hizo.
 *
 * El hueco que tapa: Stripe cobra, la hoja resuelve "paid" y el POST que crea
 * la reserva (o registra el pago) se cae por red, timeout o 502. Antes ese
 * `paymentIntentId` se perdía en un `Alert("Error")`: el siguiente tap creaba
 * OTRO intent (doble cobro) o el cliente se quedaba con cargo y sin reserva.
 *
 * Todos los POST de confirmación son idempotentes por PaymentIntent: repetir el
 * mismo cuerpo con el mismo `paymentIntentId` devuelve la reserva existente.
 * Así que el registro guarda EXACTAMENTE ese cuerpo y se reenvía tal cual — en
 * pantalla con "Reintentar", y al arrancar la app en segundo plano.
 *
 * Reglas:
 *  1. Se persiste ANTES del POST, no después de que falle: si la app muere a
 *     media petición, el registro ya está.
 *  2. Nunca se crea un intent nuevo desde aquí. Aquí solo se reenvía.
 *  3. Un solo registro persistido a la vez. Si ya hay uno sin resolver, se
 *     conserva ese; el nuevo vive solo en memoria (el reintento en pantalla
 *     sigue funcionando).
 *  4. Nada de esto puede tumbar un cobro: todo acceso a SecureStore va en
 *     try/catch y falla en silencio.
 */

export type PendingFlow =
  | "multi"
  | "bath"
  | "daycare"
  | "balance"
  | "bathAddon"
  | "card";

export type PendingConfirmation = {
  id: string;
  /** Qué endpoint confirma (y qué pantalla lo gatea). */
  flow: PendingFlow;
  /** Flujo con el que se etiqueta la telemetría (`PaymentFlow`). */
  telemetryFlow: PaymentFlow;
  paymentIntentId: string;
  /**
   * Ruta del POST de confirmación. `null` cuando el cuerpo no es serializable
   * (PaymentCardFlow sin `pending`): se reintenta en sesión, no se persiste.
   */
  path: string | null;
  /** Cuerpo EXACTO del POST; se reenvía sin tocar en cada reintento. */
  payload: Record<string, unknown>;
  userId: string;
  createdAt: number;
};

const STORAGE_KEY = "pending_payment_confirmation";

/**
 * Pasado este plazo el registro se descarta: a esas alturas el equipo ya
 * resolvió el cobro a mano (Stripe → "Registrar como pago") y seguir bloqueando
 * el botón de pagar en esa pantalla solo estorbaría.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * SecureStore avisa (y en Android puede fallar) por encima de ~2 KB. Si el
 * cuerpo no cabe, no se persiste y el reintento queda solo en sesión; el aviso
 * en pantalla lo dice tal cual para no prometer lo que no va a pasar.
 */
const MAX_BYTES = 2000;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Un listener roto no debe frenar a los demás.
    }
  }
}

/** Avisa cuando el registro persistido cambia (se guarda o se resuelve). */
export function subscribePendingConfirmation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function newPendingId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is PendingConfirmation {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.flow === "string" &&
    typeof r.telemetryFlow === "string" &&
    typeof r.paymentIntentId === "string" &&
    typeof r.path === "string" &&
    !!r.payload &&
    typeof r.payload === "object" &&
    typeof r.userId === "string" &&
    typeof r.createdAt === "number"
  );
}

export async function readPendingConfirmation(): Promise<PendingConfirmation | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.createdAt > TTL_MS) {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persiste el registro. Devuelve `false` si no se pudo (ya hay otro sin
 * resolver, no cabe, o SecureStore falló): el caller sigue igual, solo pierde
 * el reintento al arrancar.
 */
export async function savePendingConfirmation(
  record: PendingConfirmation,
): Promise<boolean> {
  if (!record.path) return false;
  try {
    const existing = await readPendingConfirmation();
    if (existing && existing.id !== record.id) return false;
    const raw = JSON.stringify(record);
    if (raw.length > MAX_BYTES) return false;
    await SecureStore.setItemAsync(STORAGE_KEY, raw);
    notify();
    return true;
  } catch {
    return false;
  }
}

/** Borra el registro, pero solo si sigue siendo ESTE (por id). */
export async function clearPendingConfirmation(id: string): Promise<void> {
  try {
    const existing = await readPendingConfirmation();
    if (!existing || existing.id !== id) return;
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    notify();
  } catch {
    // Si no se pudo borrar, el TTL lo limpia; reenviar de más es inofensivo.
  }
}

type ConfirmErrorInfo = {
  /** Status HTTP o "network"/"timeout" para la telemetría. */
  code: string;
  /** Mensaje corto para el rastro y, si aplica, para el aviso en pantalla. */
  detail: string;
  /**
   * Un 4xx (salvo 408/429) no se arregla reintentando igual: el servidor
   * rechazó el cuerpo. Se muestra el motivo para que el cliente pueda contarlo.
   */
  permanent: boolean;
};

export function describeConfirmError(err: unknown): ConfirmErrorInfo {
  const e = err as (Error & { status?: number; name?: string }) | null;
  const status = typeof e?.status === "number" ? e.status : null;
  const message =
    e instanceof Error && e.message ? e.message : "No se pudo confirmar";
  if (status !== null) {
    return {
      code: String(status),
      detail: message,
      permanent: status >= 400 && status < 500 && status !== 408 && status !== 429,
    };
  }
  return {
    code: e?.name === "ApiTimeoutError" ? "timeout" : "network",
    detail: message,
    permanent: false,
  };
}

/**
 * Corre la confirmación con su rastro de telemetría y, si sale bien, suelta el
 * registro persistido. `execute` es lo que de verdad manda el POST.
 */
export async function runConfirmation<T>(
  record: PendingConfirmation,
  execute: () => Promise<T>,
  options?: { recoveredOnLaunch?: boolean },
): Promise<T> {
  const session = startPaymentSession(record.telemetryFlow);
  const paymentIntentId = record.paymentIntentId;
  session.track("confirm_start", { paymentIntentId, code: record.flow });
  try {
    const result = await execute();
    session.track("confirm_ok", { paymentIntentId, code: record.flow });
    if (options?.recoveredOnLaunch) {
      session.track("recovered_on_launch", { paymentIntentId, code: record.flow });
    }
    await clearPendingConfirmation(record.id);
    void flushPaymentTelemetry();
    return result;
  } catch (err) {
    const info = describeConfirmError(err);
    session.track("confirm_error", {
      paymentIntentId,
      code: info.code,
      detail: info.detail,
    });
    throw err;
  }
}

/** Reenvía el POST guardado tal cual. */
export function postConfirmation<T>(
  record: PendingConfirmation,
  options?: { recoveredOnLaunch?: boolean },
): Promise<T> {
  const { path, payload } = record;
  if (!path) {
    return Promise.reject(new Error("Esta confirmación no se puede reenviar"));
  }
  return runConfirmation<T>(
    record,
    () =>
      apiFetch<T>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    options,
  );
}

/** A qué reservación pertenece el registro, si se puede saber (para invalidar). */
export function reservationIdOf(record: PendingConfirmation): string | null {
  const fromPayload = record.payload.reservationId;
  if (typeof fromPayload === "string" && fromPayload) return fromPayload;
  const match = record.path?.match(/^\/reservations\/([^/]+)\//);
  return match?.[1] ?? null;
}

let launchAttemptDone = false;

/**
 * Al arrancar: si quedó una confirmación pendiente de ESTE usuario, se reenvía
 * una vez en segundo plano. Devuelve el registro si se confirmó; `null` si no
 * había nada, era de otro usuario, o volvió a fallar (se queda guardado y se
 * intenta en el siguiente arranque). Como mucho un intento por arranque.
 */
export async function recoverPendingConfirmation(
  userId: string,
): Promise<PendingConfirmation | null> {
  if (launchAttemptDone) return null;
  const record = await readPendingConfirmation();
  if (!record || record.userId !== userId || !record.path) return null;
  launchAttemptDone = true;
  try {
    await postConfirmation(record, { recoveredOnLaunch: true });
    return record;
  } catch {
    return null;
  }
}
