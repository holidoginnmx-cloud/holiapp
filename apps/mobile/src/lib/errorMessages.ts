import { ApiError, ApiNetworkError, ApiTimeoutError } from "@/lib/api/client";

/**
 * Traduce cualquier error (de `apiFetch`, fallo de red o genérico) a un mensaje
 * corto, en español y orientado a QUÉ PUEDE HACER la persona.
 *
 * El backend ya devuelve sus errores en español y accionables (`{ error, code }`),
 * así que cuando hay un mensaje legible lo respetamos tal cual; solo lo
 * sustituimos cuando es un código crudo ("Error 429", "Error 401", "Bad
 * Request"), que es lo que hasta ahora acababa en la pantalla del cliente.
 *
 * El tratamiento por código HTTP (cerrar sesión en 401, esperar en 429…) vive
 * en `src/lib/api/client.ts`. Aquí solo se decide QUÉ SE LEE.
 */

/** Mensajes que no dicen nada y hay que sustituir por uno útil. */
const OPAQUE_MESSAGE =
  /^(error \d{3}|bad request|unauthorized|forbidden|not found|internal server error|too many requests|request failed.*)$/i;

/** Errores de red que llegan como `TypeError` del fetch nativo. */
const NETWORK_MESSAGE =
  /network request failed|failed to fetch|network error|timeout|timed out/i;

function esMensajeUtil(message: string): boolean {
  if (!message.trim()) return false;
  if (OPAQUE_MESSAGE.test(message.trim())) return false;
  // Un stack o un JSON crudo no es un mensaje para el usuario.
  if (message.startsWith("{") || message.includes("\n    at ")) return false;
  return true;
}

function esperaLegible(segundos: number): string {
  if (segundos <= 1) return "un segundo";
  if (segundos < 60) return `${segundos} segundos`;
  const minutos = Math.ceil(segundos / 60);
  return minutos === 1 ? "un minuto" : `${minutos} minutos`;
}

/** ¿El teléfono no pudo hablar con el servidor? (sin red, timeout, 5xx) */
export function esErrorDeConexion(error: unknown): boolean {
  if (error instanceof ApiNetworkError || error instanceof ApiTimeoutError) return true;
  const err = error as { message?: unknown; status?: unknown; name?: unknown } | null;
  const status = typeof err?.status === "number" ? err.status : undefined;
  if (status !== undefined && status >= 500) return true;
  const message = typeof err?.message === "string" ? err.message : "";
  return NETWORK_MESSAGE.test(message);
}

/** ¿La sesión venció y la app ya va camino al login? */
export function esSesionExpirada(error: unknown): boolean {
  return error instanceof ApiError && error.sessionExpired;
}

/**
 * Mensaje para enseñar a la persona.
 *
 * @param error   Lo que sea que se haya cazado en el `catch` / `onError`.
 * @param respaldo Mensaje propio de la pantalla para cuando el error no dice
 *                 nada útil ("No se pudo subir la imagen"). Sin él se usa un
 *                 genérico.
 */
export function mensajeDeError(error: unknown, respaldo?: string): string {
  const generico = respaldo ?? "Algo salió mal. Intenta de nuevo.";
  if (!error) return generico;

  // Timeout y fallo de red: no hay nada que corregir, solo reintentar.
  if (error instanceof ApiTimeoutError) {
    return "La conexión tardó demasiado. Revisa tu internet e intenta de nuevo.";
  }
  if (error instanceof ApiNetworkError) {
    return "No pudimos conectar con Holidog Inn. Revisa tu internet e intenta de nuevo.";
  }

  const err = error as { message?: unknown; status?: unknown } | null;
  const message = typeof err?.message === "string" ? err.message : "";
  const status = typeof err?.status === "number" ? err.status : undefined;

  if (status === undefined && NETWORK_MESSAGE.test(message)) {
    return "No pudimos conectar con Holidog Inn. Revisa tu internet e intenta de nuevo.";
  }

  // Sesión vencida. El cierre de sesión ya lo disparó el cliente HTTP.
  if (status === 401) {
    return "Tu sesión expiró. Vuelve a iniciar sesión.";
  }

  // Permisos: nunca es culpa de la sesión ni de la red, y el usuario no lo
  // puede resolver solo. Si el servidor explicó el motivo, gana el suyo.
  if (status === 403) {
    return esMensajeUtil(message)
      ? message
      : "Tu cuenta no tiene permiso para esto. Pídeselo a un administrador.";
  }

  // Demasiadas peticiones: lo único accionable es esperar, así que se dice
  // cuánto cuando el servidor lo manda en `retry-after`.
  if (status === 429) {
    const espera =
      error instanceof ApiError && error.retryAfterSeconds
        ? ` Vuelve a intentar en ${esperaLegible(error.retryAfterSeconds)}.`
        : "";
    return `Demasiadas peticiones, espera un momento.${espera}`;
  }

  // Servidor caído o roto: distinto de un dato mal capturado.
  if ((status !== undefined && status >= 500) || /^error 5\d\d$/i.test(message)) {
    return "No pudimos conectar con Holidog Inn. El servidor no responde; intenta de nuevo en un momento.";
  }

  // 4xx con explicación del API (en español): es el mensaje más útil que hay.
  if (esMensajeUtil(message)) return message;

  return generico;
}

/**
 * Título sugerido para el `Alert`. "Error" no le dice nada a nadie; esto al
 * menos separa "no hay internet" de "el dato está mal".
 */
export function tituloDeError(error: unknown, respaldo = "No se pudo completar"): string {
  if (esErrorDeConexion(error)) return "Sin conexión";
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return "Tu sesión expiró";
  if (status === 403) return "Sin permiso";
  if (status === 429) return "Espera un momento";
  return respaldo;
}

/**
 * Alias histórico: `ErrorState` y varias pantallas ya lo importaban.
 * Es la MISMA función; el nombre nuevo (`mensajeDeError`) es el que se usa en
 * el código nuevo.
 */
export const getErrorMessage = (error: unknown): string => mensajeDeError(error);
