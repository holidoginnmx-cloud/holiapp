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
 * En qué quedó el registro de push de este teléfono.
 *
 * El porqué: las tres formas de fallar (permiso negado, Expo no dio token, el
 * backend no lo guardó) terminaban en un `return null` que solo se veía en
 * consola de desarrollo. En producción el equipo simplemente "no se enteraba"
 * de las reservas nuevas y no había forma de saber por qué.
 *
 *  - "ok"         → token guardado en el backend: los avisos llegan.
 *  - "denied"     → las notificaciones están apagadas en Ajustes. Es el único
 *                   caso que solo la persona puede arreglar: se le avisa.
 *  - "no-token"   → Expo no entregó token (red, credenciales). Se reintenta.
 *  - "not-synced" → hay token pero el backend no lo guardó. Se reintenta.
 *  - "not-device" → simulador: no aplica.
 */
export type PushStatus = "ok" | "denied" | "no-token" | "not-synced" | "not-device";

let pushStatus: PushStatus | null = null;
let registerInFlight: Promise<string | null> | null = null;
const statusListeners = new Set<() => void>();

function setPushStatus(next: PushStatus | null) {
  if (pushStatus === next) return;
  pushStatus = next;
  statusListeners.forEach((l) => l());
}

export function getPushStatus(): PushStatus | null {
  return pushStatus;
}

export function subscribeToPushStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Al cerrar sesión: el estado es de la cuenta que se va. */
export function resetPushStatus() {
  setPushStatus(null);
}

/**
 * Registra el dispositivo para push y sincroniza el token Expo con el backend.
 * Idempotente: llamable varias veces — el backend hace upsert, y si ya hay un
 * registro en vuelo se devuelve ese mismo.
 *
 * Returns el token Expo si todo salió bien, null si no (el motivo queda en
 * `getPushStatus()`).
 */
export function registerForPushNotifications(
  options: { prompt?: boolean } = {},
): Promise<string | null> {
  if (registerInFlight) return registerInFlight;
  registerInFlight = doRegister(options.prompt ?? true).finally(() => {
    registerInFlight = null;
  });
  return registerInFlight;
}

/**
 * @param prompt false en los reintentos: solo se revisa el permiso, no se
 *   vuelve a pedir. En Android un segundo `requestPermissionsAsync` le
 *   reabriría el diálogo a quien ya dijo que no.
 */
async function doRegister(prompt: boolean): Promise<string | null> {
  if (!Device.isDevice) {
    if (__DEV__) console.log("[push] Saltando — no es dispositivo físico");
    setPushStatus("not-device");
    return null;
  }

  // Configura el handler de forma perezosa (no en import-time, ver arriba).
  configureNotificationHandler();

  // Pedir permisos si no los tenemos
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted" && prompt) {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    if (__DEV__) console.log("[push] Permisos denegados");
    setPushStatus("denied");
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
    if (__DEV__) console.error("[push] Error obteniendo token Expo:", err);
    setPushStatus("no-token");
    return null;
  }

  const token = tokenResult.data;
  try {
    await registerPushToken(
      token,
      Platform.OS === "ios" ? "ios" : "android"
    );
    if (__DEV__) console.log("[push] Token sincronizado con el backend");
    setPushStatus("ok");
  } catch (err) {
    if (__DEV__) console.error("[push] Error sincronizando con backend:", err);
    // Aun así devolvemos el token — se reintenta al volver a primer plano.
    setPushStatus("not-synced");
  }

  return token;
}
