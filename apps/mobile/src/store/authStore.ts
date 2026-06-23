import { create } from "zustand";
import { BASE_URL } from "@/constants/api";

type TokenResolver = (options?: { template?: string }) => Promise<string | null>;

interface AuthState {
  clerkUserId: string | null;
  dbUserId: string | null;
  userId: string | null; // alias for dbUserId — backward compat
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
  tokenResolver: TokenResolver | null;
  setTokenResolver: (fn: TokenResolver) => void;
  setClerkUserId: (id: string | null) => void;
  syncUser: () => Promise<string | null>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  clerkUserId: null,
  dbUserId: null,
  userId: null,
  firstName: null,
  lastName: null,
  email: null,
  role: null,
  tokenResolver: null,

  setTokenResolver: (fn) => set({ tokenResolver: fn }),

  setClerkUserId: (id) => set({ clerkUserId: id }),

  syncUser: async () => {
    const { tokenResolver } = get();
    if (!tokenResolver) {
      if (__DEV__) console.log("[syncUser] No tokenResolver available");
      return null;
    }

    // Reintenta ante fallos transitorios (cold start de la API en Railway, red
    // lenta tras el login). Antes un solo fallo dejaba userId en null toda la
    // sesión, rompiendo la lista de mascotas (query deshabilitada por !userId)
    // y la creación de mascota (ownerId nulo → 400 en el revisor de Apple).
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const token = await tokenResolver();
        if (token) {
          const res = await fetch(`${BASE_URL}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const user = await res.json();
            if (__DEV__) console.log("[syncUser] OK — role:", user.role);
            set({
              dbUserId: user.id,
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              role: user.role,
            });
            return user.id as string;
          }
          if (__DEV__) {
            const body = await res.text();
            console.log("[syncUser] Error", res.status, body, "(intento", attempt + ")");
          }
        } else if (__DEV__) {
          console.log("[syncUser] No token returned (intento", attempt + ")");
        }
      } catch (err) {
        if (__DEV__) console.log("[syncUser] Network error (intento", attempt + "):", err);
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 800));
      }
    }
    return null;
  },

  logout: () =>
    set({
      clerkUserId: null,
      dbUserId: null,
      userId: null,
      firstName: null,
      lastName: null,
      email: null,
      role: null,
    }),
}));
