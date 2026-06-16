/**
 * Traduce cualquier error (de `apiFetch`, fallo de red o genérico) a un mensaje
 * corto y amigable en español para mostrar al usuario.
 *
 * El backend ya devuelve sus errores en español, así que cuando hay un mensaje
 * legible lo respetamos; solo normalizamos los fallos de red y los errores de
 * servidor crudos (p.ej. "Error 500") para no exponer detalles técnicos.
 *
 * `apiFetch` adjunta el `status` HTTP al Error lanzado (ver src/lib/api.ts),
 * lo que permite mapear 401/403 y 5xx de forma fiable.
 */
export function getErrorMessage(error: unknown): string {
  if (!error) return "Algo salió mal. Intenta de nuevo.";

  const err = error as { message?: unknown; status?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  const status = typeof err.status === "number" ? err.status : undefined;

  // Fallo de red: fetch rechaza antes de obtener una respuesta.
  if (/network request failed|failed to fetch|network error|timeout/i.test(message)) {
    return "Sin conexión a internet. Revisa tu conexión e intenta de nuevo.";
  }

  // Sesión expirada o sin permisos.
  if (status === 401 || status === 403) {
    return "Tu sesión expiró. Inicia sesión de nuevo.";
  }

  // Error del servidor (5xx o mensaje crudo "Error 5xx").
  if ((status !== undefined && status >= 500) || /^error 5\d\d$/i.test(message)) {
    return "El servidor no responde. Intenta de nuevo en un momento.";
  }

  // Mensaje legible del backend (español). Evitamos exponer "Error 4xx" crudos.
  if (message && !/^error \d{3}$/i.test(message)) {
    return message;
  }

  return "Algo salió mal. Intenta de nuevo.";
}
