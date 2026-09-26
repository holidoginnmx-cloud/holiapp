import { apiFetch } from "@/lib/api/client";
import { buildInfo } from "@/lib/appUpdates";
import { CloudinaryUploadError } from "@/lib/cloudinary";

/**
 * Rastro de una subida de foto/video que falló.
 *
 * El porqué: el 25-sep alguien del equipo reportó "no me dejó subir ningún
 * video en la app", sin captura ni texto del aviso. Las subidas van directo del
 * teléfono a Cloudinary, así que nuestra API nunca se enteraba y no quedaba
 * nada que revisar. Con esto, el motivo real (cuenta suspendida, archivo
 * demasiado grande, señal que se cortó) queda en los logs de Railway con
 * `tag: "upload-failure"`.
 *
 * Fire-and-forget: nunca debe tapar el aviso que ve el equipo ni tronar.
 */
export function reportUploadFailure(
  error: unknown,
  context: {
    screen: string;
    mediaType: "image" | "video";
    source?: string;
    fileSize?: number | null;
    durationMs?: number | null;
  },
) {
  try {
    const info = buildInfo();
    const detail =
      error instanceof CloudinaryUploadError
        ? error.detail
        : error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
    void apiFetch("/telemetry/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...context,
        fileSize: context.fileSize ?? null,
        durationMs: context.durationMs ?? null,
        httpStatus:
          error instanceof CloudinaryUploadError ? (error.httpStatus ?? null) : null,
        message: error instanceof Error ? error.message.slice(0, 200) : null,
        detail: detail.slice(0, 300),
        app: {
          version: info.appVersion,
          platform: info.platform.slice(0, 20),
          updateId: info.updateId,
          runtimeVersion: info.runtimeVersion,
        },
      }),
      timeoutMs: 8000,
    }).catch(() => {
      // Sin rastro esta vez; el aviso al equipo ya salió.
    });
  } catch {
    // Nunca romper la pantalla por diagnóstico.
  }
}
