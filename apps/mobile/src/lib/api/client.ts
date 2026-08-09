import { BASE_URL } from "@/constants/api";
import { useAuthStore } from "@/store/authStore";

// ─── Fetch wrapper ───────────────────────────────────────

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { tokenResolver } = useAuthStore.getState();

  // Timing (solo dev): separa el costo del token de Clerk del costo real de
  // red/servidor. Es el marcador para medir las mejoras de latencia por tap.
  const t0 = __DEV__ ? performance.now() : 0;

  let authHeader: Record<string, string> = {};
  if (tokenResolver) {
    const token = await tokenResolver();
    if (token) {
      authHeader = { Authorization: `Bearer ${token}` };
    }
  }

  const t1 = __DEV__ ? performance.now() : 0;

  const hasBody = options?.body != null;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...authHeader,
      ...options?.headers,
    },
  });

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
