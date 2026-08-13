import { Alert, Linking, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { BUSINESS } from "@/constants/business";

/**
 * Invitación a calificar la app en la tienda, después de una reseña buena
 * (lo que hace Uber tras calificar al conductor).
 *
 * Se usa `Linking` a la ficha de la tienda y NO `expo-store-review`: ese es un
 * módulo nativo y meterlo obligaría a subir un binario nuevo a Apple, cuando
 * todo esto viaja por OTA sobre el build ya aprobado.
 *
 * Falla en silencio, igual que `whatsNewSeen`: es UX, no puede tumbar el flujo
 * de la reseña.
 */

/** Sólo a quien calificó bien; a los demás se les atiende, no se les pide reseña. */
const MIN_RATING = 4;
/** Nadie debería ver esto más de dos veces al año. */
const COOLDOWN_MS = 180 * 86_400_000;

// La clave lleva el userId porque el logout NO limpia SecureStore: sin eso, una
// cuenta nueva en el mismo teléfono heredaba el "ya se le pidió" de la anterior.
function storageKey(userId: string): string {
  return `storeReviewAsked_${userId}`;
}

async function readLastAsked(userId: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(storageKey(userId));
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

async function writeLastAsked(userId: string) {
  try {
    await SecureStore.setItemAsync(storageKey(userId), new Date().toISOString());
  } catch {
    // ignore
  }
}

export function storeUrl(): string {
  return Platform.OS === "ios"
    ? `https://apps.apple.com/app/id${BUSINESS.appStoreId}?action=write-review`
    : `https://play.google.com/store/apps/details?id=${BUSINESS.androidPackage}`;
}

/**
 * Ofrece calificar en la tienda si la reseña fue buena y no se ha pedido
 * recientemente. Llamar SIEMPRE desde el `onPress` de la alerta anterior: dos
 * `Alert` en el mismo tick se pisan en iOS y el segundo no se ve.
 */
export async function maybePromptStoreReview(
  userId: string | null | undefined,
  rating: number,
): Promise<void> {
  if (!userId || rating < MIN_RATING) return;

  const last = await readLastAsked(userId);
  if (last !== null && Date.now() - last < COOLDOWN_MS) return;

  await writeLastAsked(userId);

  Alert.alert(
    "¡Nos alegra! 🐾",
    "¿Nos regalas una calificación en la tienda? Ayuda a que más familias nos encuentren.",
    [
      { text: "Ahora no", style: "cancel" },
      {
        text: "Calificar",
        onPress: () => {
          Linking.openURL(storeUrl()).catch(() => {
            // Tienda no disponible (simulador, sin App Store). No molestar más.
          });
        },
      },
    ],
  );
}
