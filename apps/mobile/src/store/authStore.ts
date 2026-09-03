import { create } from "zustand";
import { AppState } from "react-native";
import { apiFetch } from "@/lib/api/client";
import { loadProfileCache, saveProfileCache } from "@/lib/authProfileCache";

type TokenResolver = (options?: { template?: string }) => Promise<string | null>;

/**
 * Estado de la sincronización con `/users/me`:
 *   - idle:    todavía no se ha intentado (o se cerró sesión).
 *   - syncing: hay una petición en vuelo (con sus reintentos cortos).
 *   - ok:      la API contestó; `role`/`userId` son los reales.
 *   - failed:  se agotaron los intentos; se reintenta solo en segundo plano
 *              (backoff de 30 s / 60 s y al volver la app a primer plano).
 *
 * Mientras no sea "ok" y no haya rol, (tabs)/_layout muestra "Conectando…"
 * en vez de enrutar al usuario como cliente.
 */
export type SyncStatus = "idle" | "syncing" | "ok" | "failed";

interface AuthState {
  clerkUserId: string | null;
  dbUserId: string | null;
  userId: string | null; // alias for dbUserId — backward compat
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
  syncStatus: SyncStatus;
  /** Mensaje del servidor cuando /users/me rechazó la cuenta (4xx); null si
   *  el fallo fue de red. Con esto "Conectando…" no miente con "revisa tu internet". */
  syncError: string | null;
  tokenResolver: TokenResolver | null;
  setTokenResolver: (fn: TokenResolver) => void;
  setClerkUserId: (id: string | null) => void;
  syncUser: () => Promise<string | null>;
  logout: () => void;
}

type MeResponse = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
};

/**
 * Intentos "cortos" dentro de una misma llamada a syncUser: cubren el cold
 * start de Railway y la red lenta tras el login. Antes un solo fallo dejaba
 * userId en null toda la sesión (mascotas sin cargar, ownerId nulo → 400 en el
 * revisor de Apple).
 */
const QUICK_ATTEMPTS = 4;
const QUICK_BACKOFF_MS = 800;
/**
 * Tope por petición en el arranque. `fetch` crudo no tiene timeout: con
 * Railway a medio despertar la promesa se quedaba colgada y nunca llegábamos
 * ni a "failed". 10 s en vez de los 30 s por defecto de apiFetch: aquí
 * preferimos fallar rápido y reintentar.
 */
const STARTUP_TIMEOUT_MS = 10_000;
/** Backoff largo tras agotar los intentos cortos; el último valor se repite. */
const SLOW_RETRY_MS = [30_000, 60_000];

// ── Estado de módulo (no de React): una sola sincronización en vuelo ────────
let inFlight: Promise<string | null> | null = null;
let inFlightGeneration = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let slowRetries = 0;
/**
 * Se incrementa en cada logout: una petición que estaba en vuelo para la
 * cuenta anterior descarta su respuesta en vez de pisar la sesión nueva.
 */
let generation = 0;

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useAuthStore = create<AuthState>((set, get) => {
  const scheduleSlowRetry = () => {
    clearRetryTimer();
    const delay = SLOW_RETRY_MS[Math.min(slowRetries, SLOW_RETRY_MS.length - 1)];
    slowRetries += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (get().syncStatus !== "failed") return;
      // En segundo plano no gastamos red: al volver a "active",
      // ClerkTokenSync (app/_layout.tsx) vuelve a llamar a syncUser.
      if (AppState.currentState !== "active") return;
      void get().syncUser();
    }, delay);
  };

  const runSync = async (gen: number): Promise<string | null> => {
    const { tokenResolver, clerkUserId } = get();
    if (!tokenResolver) {
      if (__DEV__) console.log("[syncUser] No tokenResolver available");
      // Hoy inalcanzable (el resolver se fija en el primer commit del root),
      // pero si pasara no se puede dejar "idle" sin salida: se marca como
      // fallo y el backoff vuelve a intentar.
      set({ syncStatus: "failed" });
      scheduleSlowRetry();
      return null;
    }

    clearRetryTimer();
    set({ syncStatus: "syncing", syncError: null });

    // Rol provisional: si esta misma cuenta ya entró antes desde este teléfono,
    // arrancamos con su último perfil conocido mientras la API contesta. Así el
    // equipo no se queda en "Conectando…" cada vez que Railway está dormido.
    if (!get().role && clerkUserId) {
      const cached = await loadProfileCache();
      if (
        cached &&
        cached.clerkUserId === clerkUserId &&
        gen === generation &&
        !get().role
      ) {
        if (__DEV__) console.log("[syncUser] Rol provisional de caché:", cached.role);
        set({
          dbUserId: cached.dbUserId,
          userId: cached.dbUserId,
          firstName: cached.firstName,
          lastName: cached.lastName,
          email: cached.email,
          role: cached.role,
        });
      }
    }

    for (let attempt = 1; attempt <= QUICK_ATTEMPTS; attempt++) {
      try {
        const user = await apiFetch<MeResponse>("/users/me", {
          timeoutMs: STARTUP_TIMEOUT_MS,
        });
        if (gen !== generation) return null; // cambió la sesión mientras tanto
        if (__DEV__) console.log("[syncUser] OK — role:", user.role);
        set({
          dbUserId: user.id,
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          syncStatus: "ok",
        });
        slowRetries = 0;
        if (clerkUserId) {
          void saveProfileCache({
            clerkUserId,
            dbUserId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
          });
        }
        return user.id;
      } catch (err) {
        if (gen !== generation) return null;
        if (__DEV__) {
          console.log("[syncUser] Error (intento", attempt + "):", err);
        }
        // Un 4xx (salvo 408/429) es el servidor rechazando ESTA cuenta (401
        // "no se encontró email", 409 "correo ya vinculado a otra cuenta"):
        // reintentar no cambia nada. Se guarda el mensaje y se sale sin
        // backoff; ConnectingScreen ofrece cerrar sesión.
        const status = (err as { status?: number } | null)?.status;
        if (
          typeof status === "number" &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          set({
            syncStatus: "failed",
            syncError: err instanceof Error && err.message ? err.message : `Error ${status}`,
          });
          return null;
        }
      }
      if (attempt < QUICK_ATTEMPTS) {
        await sleep(attempt * QUICK_BACKOFF_MS);
        if (gen !== generation) return null;
      }
    }

    set({ syncStatus: "failed" });
    scheduleSlowRetry();
    return null;
  };

  return {
    clerkUserId: null,
    dbUserId: null,
    userId: null,
    firstName: null,
    lastName: null,
    email: null,
    role: null,
    syncStatus: "idle",
    syncError: null,
    tokenResolver: null,

    setTokenResolver: (fn) => set({ tokenResolver: fn }),

    setClerkUserId: (id) => set({ clerkUserId: id }),

    // Un solo reintento en vuelo a la vez: (tabs)/_layout, ClerkTokenSync, el
    // botón "Reintentar" y el backoff pueden llamar a la vez y comparten la
    // misma promesa. Una promesa de la sesión anterior (otra `generation`) no
    // cuenta: se arranca una nueva y la vieja descarta su resultado.
    syncUser: () => {
      if (inFlight && inFlightGeneration === generation) return inFlight;
      const gen = generation;
      inFlightGeneration = gen;
      const p = runSync(gen).finally(() => {
        if (inFlight === p) inFlight = null;
      });
      inFlight = p;
      return p;
    },

    logout: () => {
      generation += 1;
      clearRetryTimer();
      slowRetries = 0;
      set({
        clerkUserId: null,
        dbUserId: null,
        userId: null,
        firstName: null,
        lastName: null,
        email: null,
        role: null,
        syncStatus: "idle",
        syncError: null,
      });
    },
  };
});
