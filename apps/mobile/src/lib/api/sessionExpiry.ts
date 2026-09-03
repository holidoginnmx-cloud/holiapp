/**
 * Cierre de sesión ordenado cuando el servidor dice 401.
 *
 * Vive en su propio módulo (y no en client.ts) por dos razones:
 *
 *  1. Quien sabe cerrar sesión de verdad es Clerk (`signOut`), y eso solo se
 *     puede pedir desde un componente montado dentro de <ClerkProvider>. El
 *     cliente HTTP no puede importarlo sin arrastrar React a cada petición.
 *  2. Así se evita el ciclo client.ts → session.ts → authStore → client.ts.
 *
 * El contrato: `app/_layout.tsx` registra el handler real al arrancar; el
 * cliente HTTP solo dispara `triggerSessionExpired()` y se olvida.
 */

type SessionExpiredHandler = () => void | Promise<void>;

let handler: SessionExpiredHandler | null = null;

/**
 * Candado anti-bucle. Una pantalla del equipo lanza 6-8 queries a la vez: si
 * el token murió, TODAS contestan 401 en el mismo tick. Sin esto se dispararían
 * seis cierres de sesión (seis `signOut`, seis `router.replace`) y la app
 * quedaría a medio camino entre el login y el área anterior.
 */
let signingOut = false;

export function setSessionExpiredHandler(fn: SessionExpiredHandler | null) {
  handler = fn;
}

/** true mientras el cierre de sesión por 401 está en curso. */
export function isSigningOutBySessionExpiry() {
  return signingOut;
}

/**
 * Vuelve a armar el candado. Lo llama el propio handler cuando ya aterrizó en
 * el login: si no se rearmara, un segundo vencimiento (otra cuenta, misma
 * sesión de app) se quedaría sin cierre de sesión.
 */
export function rearmSessionExpiry() {
  signingOut = false;
}

/**
 * Cierra la sesión UNA vez, aunque lo pidan diez peticiones a la vez.
 * Devuelve true si esta llamada fue la que lo disparó (las demás, false).
 */
export function triggerSessionExpired(): boolean {
  if (signingOut) return false;
  if (!handler) return false;
  signingOut = true;
  try {
    const result = handler();
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {
        // Si el cierre falló a medias, no dejamos el candado puesto para
        // siempre: el próximo 401 vuelve a intentarlo.
        signingOut = false;
      });
    }
  } catch {
    signingOut = false;
  }
  return true;
}
