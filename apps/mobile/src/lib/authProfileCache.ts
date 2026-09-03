import * as SecureStore from "expo-secure-store";

/**
 * Último perfil (`/users/me`) que la API nos devolvió, guardado por usuario de
 * Clerk.
 *
 * Para qué: cuando la API no contesta al arrancar (Railway dormido, red mala)
 * el store no tiene rol y la app no sabe si enrutar al área de cliente o a la
 * del equipo. Con este caché, un usuario que YA entró antes desde este teléfono
 * arranca con su rol provisional mientras la sincronización real se reintenta
 * en segundo plano; el valor fresco de la API siempre lo sobrescribe.
 *
 * Se compara `clerkUserId` antes de usarlo: el caché de una cuenta nunca se
 * aplica a otra (el logout no limpia SecureStore a propósito, igual que las
 * marcas de onboarding).
 */
const KEY = "auth-profile-cache";

export type CachedProfile = {
  clerkUserId: string;
  dbUserId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string;
};

export async function loadProfileCache(): Promise<CachedProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProfile> | null;
    if (
      !parsed ||
      typeof parsed.clerkUserId !== "string" ||
      typeof parsed.dbUserId !== "string" ||
      typeof parsed.role !== "string"
    ) {
      return null;
    }
    return {
      clerkUserId: parsed.clerkUserId,
      dbUserId: parsed.dbUserId,
      firstName: typeof parsed.firstName === "string" ? parsed.firstName : null,
      lastName: typeof parsed.lastName === "string" ? parsed.lastName : null,
      email: typeof parsed.email === "string" ? parsed.email : null,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export async function saveProfileCache(profile: CachedProfile): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(profile));
  } catch {
    // Sin Keychain no hay caché: la app sigue funcionando igual que antes.
  }
}
