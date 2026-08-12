import * as SecureStore from "expo-secure-store";

// Último release de Novedades visto, por usuario (ver constants/whatsNew.ts).
// Mismo patrón que dashboardSeen: SecureStore y fallar en silencio — es UX,
// en el peor caso el modal se repite una vez.

function storageKey(userId: string): string {
  // SecureStore requiere alfanumérico + . _ -
  return `whatsNewSeen_${userId}`;
}

export async function readWhatsNewSeen(userId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(storageKey(userId));
  } catch {
    return null;
  }
}

export async function writeWhatsNewSeen(userId: string, releaseId: string) {
  try {
    await SecureStore.setItemAsync(storageKey(userId), releaseId);
  } catch {
    // ignore
  }
}
