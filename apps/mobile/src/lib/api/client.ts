import { BASE_URL } from "@/constants/api";
import { useAuthStore } from "@/store/authStore";
import { withTimeout } from "@/lib/promiseTimeout";
import { triggerSessionExpired } from "@/lib/api/sessionExpiry";

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

const NETWORK_MESSAGE =
  "No pudimos conectar. Revisa tu internet e intenta de nuevo.";

export class ApiTimeoutError extends Error {
  constructor() {
    super(TIMEOUT_MESSAGE);
    this.name = "ApiTimeoutError";
  }
}

/**
 * El teléfono no pudo hablar con el servidor: sin señal, wifi de cortesía que
 * pide login, Railway dormido. Se distingue de un error de DATOS (4xx) porque
 * el mensaje al usuario es otro: aquí no hay nada que corregir, solo reintentar.
 */
export class ApiNetworkError extends Error {
  cause?: unknown;
  constructor(cause?: unknown) {
    super(NETWORK_MESSAGE);
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

/**
 * Respuesta de error del servidor. Antes esto era un `Error` pelado con dos
 * propiedades pegadas a mano; ahora es una clase para poder preguntar
 * `err instanceof ApiError` y, sobre todo, para que el tratamiento por código
 * (401/403/429/5xx) viva en UN solo lugar y no en 84 `Alert.alert`.
 */
export class ApiError extends Error {
  status: number;
  body: any;
  /** Código de negocio del API (`{ error, code }`), p. ej. "DUPLICATE_PET". */
  code?: string;
  /** Segundos que pidió esperar el servidor en un 429 (cabecera retry-after). */
  retryAfterSeconds?: number;
  /** Ruta que falló; útil en los logs de dev. */
  path: string;
  /**
   * true si este 401 fue el que disparó el cierre de sesión. Quien muestra el
   * error lo usa para NO sacar una alerta encima de la salida al login.
   */
  sessionExpired = false;

  constructor(args: {
    message: string;
    status: number;
    body: any;
    code?: string;
    retryAfterSeconds?: number;
    path: string;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.body = args.body;
    this.code = args.code;
    this.retryAfterSeconds = args.retryAfterSeconds;
    this.path = args.path;
  }
}

/**
 * Rutas donde un 401 NO significa "tu sesión venció".
 *
 * Son las que el API acepta sin sesión (o con sesión a medio formar): si
 * contestan 401 es por otra razón y cerrar la sesión del usuario que está
 * usando la app sería un despropósito.
 */
const PUBLIC_PATH_PREFIXES = [
  "/pricing/",
  "/vaccine-catalog",
  "/quotes/public",
  "/telemetry/",
];

function isPublicPath(path: string) {
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * ¿Este 401 debe cerrar la sesión?
 *
 * Tres candados, y los tres importan:
 *
 *  - Sin cabecera Authorization no hubo sesión que vencer (ruta pública, o el
 *    token de Clerk todavía no está listo). Cerrar sesión aquí echaría del
 *    login a quien apenas está entrando.
 *  - En el ARRANQUE manda `authStore`: mientras `syncStatus` no sea "ok", un
 *    401 de `/users/me` es el servidor rechazando la cuenta ("no se encontró
 *    email"), y eso ya lo cuenta ConnectingScreen con su propio botón de salir.
 *    Si cerráramos sesión aquí, el usuario vería un parpadeo al login sin
 *    entender por qué.
 *  - Las rutas públicas quedan fuera por nombre, por si alguna llega a mandar
 *    el token igual.
 */
function shouldSignOutOn401(path: string, sentAuthHeader: boolean) {
  if (!sentAuthHeader) return false;
  if (isPublicPath(path)) return false;
  return useAuthStore.getState().syncStatus === "ok";
}

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  // La cabecera también admite una fecha HTTP.
  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return undefined;
  const diff = Math.round((asDate - Date.now()) / 1000);
  return diff > 0 ? diff : undefined;
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
  const sentAuthHeader = authHeader.Authorization != null;

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
    // Cancelación del caller (React Query al desmontar/cambiar de key): se
    // propaga TAL CUAL. Convertirla en "no hay internet" haría que una
    // navegación normal pintara un error de red que nunca ocurrió.
    if (callerSignal?.aborted) throw err;
    throw new ApiNetworkError(err);
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
    // El API manda `{ error }` en español; alguna ruta vieja manda `{ message }`.
    // Se aceptan las dos para no acabar enseñando "Error 400" cuando el
    // servidor sí explicó el motivo.
    const msg =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : `Error ${res.status}`;
    const err = new ApiError({
      message: msg,
      status: res.status,
      // Adjuntamos el cuerpo completo para que el caller pueda leer campos extra
      // (p. ej. el 409 DUPLICATE_PET trae `petId`).
      body,
      code: typeof body.code === "string" ? body.code : undefined,
      retryAfterSeconds: res.status === 429 ? parseRetryAfter(res) : undefined,
      path,
    });

    // 401 = la sesión ya no vale. Se cierra AQUÍ, una sola vez para todas las
    // peticiones que fallen a la vez, en vez de dejar cada pantalla mostrando
    // "Error 401" mientras la app sigue con datos de una sesión muerta.
    if (res.status === 401 && shouldSignOutOn401(path, sentAuthHeader)) {
      // `triggerSessionExpired` solo devuelve true a la PRIMERA de las
      // peticiones simultáneas, pero todas describen el mismo hecho: la marca
      // va en todas para que ninguna saque su propia alerta camino al login.
      triggerSessionExpired();
      err.sessionExpired = true;
    }

    throw err;
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}
