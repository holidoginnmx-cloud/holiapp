import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerPushToken } from "./api";

// IMPORTANTE: NO llamar a setNotificationHandler en import-time. Bajo la New
// Architecture eso toca un TurboModule de expo-notifications durante la
// evaluación del bundle (antes de montar el árbol de React) y crashea al abrir
// (regresión del build 15). Se configura de forma perezosa dentro de
// registerForPushNotifications(), que corre tras el montaje.
let notificationHandlerConfigured = false;

/**
 * Configura cómo se muestran las notificaciones con la app en primer plano.
 * Idempotente y diferido: se invoca dentro de registerForPushNotifications,
 * nunca al importar el módulo.
 */
function configureNotificationHandler() {
  if (notificationHandlerConfigured) return;
  // Mostrar notificaciones aunque la app esté en primer plano (de lo contrario
  // iOS no las despliega y el usuario solo las ve en el centro de notificaciones).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  notificationHandlerConfigured = true;
}

/**
 * Registra el dispositivo para push y sincroniza el token Expo con el backend.
 * Idempotente: llamable varias veces — el backend hace upsert.
 *
 * Returns el token Expo si todo salió bien, null si:
 *   - corre en simulador/emulador (Expo no emite tokens ahí)
 *   - el usuario rechazó permisos
 *   - no hay projectId configurado
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("[push] Saltando — no es dispositivo físico");
    return null;
  }

  // Configura el handler de forma perezosa (no en import-time, ver arriba).
  configureNotificationHandler();

  // Pedir permisos si no los tenemos
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    console.log("[push] Permisos denegados");
    return null;
  }

  // Android: requiere canal para mostrar notificaciones
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "General",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#3a7cab",
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  let tokenResult;
  try {
    tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
  } catch (err) {
    console.error("[push] Error obteniendo token Expo:", err);
    return null;
  }

  const token = tokenResult.data;
  try {
    await registerPushToken(
      token,
      Platform.OS === "ios" ? "ios" : "android"
    );
    console.log("[push] Token sincronizado con el backend");
  } catch (err) {
    console.error("[push] Error sincronizando con backend:", err);
    // Aun así devolvemos el token — se reintenta en el próximo arranque
  }

  return token;
}
