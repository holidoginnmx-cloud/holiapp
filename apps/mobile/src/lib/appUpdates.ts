import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Actualizaciones por aire (OTA).
 *
 * El porqué: `expo-updates` venía instalado pero sin usarse en una sola línea, y
 * con `fallbackToCacheTimeout: 0` eso significa que un update **solo se aplica
 * en el siguiente arranque en frío**. Un cliente que deja la app en segundo
 * plano sigue con el código viejo durante días: el 2026-09-02 no hubo forma de
 * saber si a quien reportó el pago colgado le había llegado el arreglo publicado
 * dos horas antes.
 *
 * Aquí se resuelven las dos mitades del problema: aplicar el update sin esperar
 * a que el cliente mate la app, y poder saber qué versión trae puesta.
 */

/** La app no se recarga si estuvo fuera menos de esto: se sentiría como un salto. */
const MIN_BACKGROUND_MS = 30 * 60 * 1000;

/**
 * Candado de flujos que no se pueden interrumpir. Recargar a media hoja de pago
 * sería peor que el problema que arregla.
 */
let criticalFlows = 0;

export function beginCriticalFlow() {
  criticalFlows += 1;
}

export function endCriticalFlow() {
  criticalFlows = Math.max(0, criticalFlows - 1);
}

export function isCriticalFlowActive() {
  return criticalFlows > 0;
}

/** Datos de build para soporte: "mándame esto por WhatsApp". */
export function buildInfo() {
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : null;
  return {
    appVersion: Constants.expoConfig?.version ?? "?",
    buildNumber:
      Platform.OS === "ios"
        ? (Constants.expoConfig?.ios?.buildNumber ?? "?")
        : String(Constants.expoConfig?.android?.versionCode ?? "?"),
    runtimeVersion:
      typeof Updates.runtimeVersion === "string" ? Updates.runtimeVersion : null,
    channel: Updates.channel ?? null,
    updateId,
    /** true = corriendo el código que venía en el binario, sin OTA encima. */
    isEmbedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt ? Updates.createdAt.toISOString() : null,
    platform: `${Platform.OS} ${String(Platform.Version)}`,
  };
}

/** Línea corta para pintar en pantalla: "1.3.0 (29) · a1b2c3d4". */
export function buildLabel() {
  const info = buildInfo();
  const suffix = info.updateId ? ` · ${info.updateId}` : " · base";
  return `${info.appVersion} (${info.buildNumber})${suffix}`;
}

/** Bloque para compartir con soporte. */
export function buildDiagnostics() {
  const info = buildInfo();
  return [
    `App: ${info.appVersion} (${info.buildNumber})`,
    `Runtime: ${info.runtimeVersion ?? "?"}`,
    `Canal: ${info.channel ?? "?"}`,
    `Update: ${info.updateId ?? "ninguno (versión base)"}`,
    `Publicado: ${info.createdAt ?? "—"}`,
    `Dispositivo: ${info.platform}`,
  ].join("\n");
}

/**
 * Busca y descarga un update. No recarga: eso lo decide quien llama.
 * Devuelve true si quedó uno listo para aplicarse.
 */
export async function checkAndFetch(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew;
  } catch {
    // Sin red, o servidor de updates caído: no es un error del que enterar al
    // cliente. Se reintenta la próxima vez que vuelva a la app.
    return false;
  }
}

/**
 * Aplica un update ya descargado, pero solo si es un momento seguro: nada de
 * flujos críticos en curso y con la app suficientemente tiempo en segundo plano
 * como para que recargar se sienta igual que abrirla de nuevo.
 */
export async function applyIfSafe(backgroundedMs: number): Promise<boolean> {
  if (isCriticalFlowActive()) return false;
  if (backgroundedMs < MIN_BACKGROUND_MS) return false;
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
