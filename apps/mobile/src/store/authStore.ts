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
  syncUser: () => Promise<void>;
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
      console.log("[syncUser] No tokenResolver available");
      return;
    }

    const token = await tokenResolver();
    if (!token) {
      console.log("[syncUser] No token returned");
      return;
    }

    try {
      const res = await fetch(`${BASE_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = await res.json();
        console.log("[syncUser] OK — role:", user.role);
        set({
          dbUserId: user.id,
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        });
      } else {
        const body = await res.text();
        console.log("[syncUser] Error", res.status, body);
      }
    } catch (err) {
      console.log("[syncUser] Network error:", err);
    }
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
