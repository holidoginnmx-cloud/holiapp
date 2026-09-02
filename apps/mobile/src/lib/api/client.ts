import { BASE_URL } from "@/constants/api";
import { useAuthStore } from "@/store/authStore";
import { withTimeout } from "@/lib/promiseTimeout";

// ─── Fetch wrapper ───────────────────────────────────────

/**
 * Tope de espera por petición. `fetch` de React Native NO trae timeout: si el
 * servidor no contesta (red que se cae a media petición, Railway despertando,
 * túnel de datos zombie), la promesa se queda pendiente PARA SIEMPRE y la
 * pantalla que la esperaba se queda en spinner sin error ni salida — que es
 * justo lo que pasaba al confirmar una reserva.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const TIMEOUT_MESSAGE =
  "La conexión tardó demasiado. Revisa tu internet e intenta de nuevo.";

export class ApiTimeoutError extends Error {
  constructor() {
    super(TIMEOUT_MESSAGE);
    this.name = "ApiTimeoutError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { tokenResolver } = useAuthStore.getState();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {};

  // Timing (solo dev): separa el costo del token de Clerk del costo real de
  // red/servidor. Es el marcador para medir las mejoras de latencia por tap.
  const t0 = __DEV__ ? performance.now() : 0;

  let authHeader: Record<string, string> = {};
  if (tokenResolver) {
    // Con timeout también aquí: si Clerk no devuelve el token, la petición ni
    // siquiera llega a salir y el spinner se queda igual de colgado.
    const token = await withTimeout(
      tokenResolver(),
      timeoutMs,
      TIMEOUT_MESSAGE,
    );
    if (token) {
      authHeader = { Authorization: `Bearer ${token}` };
    }
  }

  const t1 = __DEV__ ? performance.now() : 0;

  const hasBody = fetchOptions.body != null;

  // El caller puede traer su propio signal (React Query lo pasa al cancelar);
  // abortamos con el nuestro y nos colgamos del suyo para no perderlo.
  const controller = new AbortController();
  const callerSignal = fetchOptions.signal;
  const abortFromCaller = () => controller.abort();
  callerSignal?.addEventListener?.("abort", abortFromCaller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...authHeader,
        ...fetchOptions.headers,
      },
    });
  } catch (err) {
    if (timedOut) throw new ApiTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.("abort", abortFromCaller);
  }

  if (__DEV__) {
    const t2 = performance.now();
    console.log(
      `[api] ${options?.method ?? "GET"} ${path} token=${Math.round(t1 - t0)}ms fetch=${Math.round(t2 - t1)}ms`
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (__DEV__) console.log("❌ API error:", res.status, JSON.stringify(body));
    const msg = typeof body.error === "string" ? body.error : `Error ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; body?: any };
    err.status = res.status;
    // Adjuntamos el cuerpo completo para que el caller pueda leer campos extra
    // (p. ej. el 409 DUPLICATE_PET trae `petId`).
    err.body = body;
    throw err;
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}
