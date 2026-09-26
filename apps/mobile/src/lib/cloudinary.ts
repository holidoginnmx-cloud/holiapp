const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export type CloudinaryResult = {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  width: number;
  height: number;
};

/**
 * Tope de Cloudinary por archivo en el plan gratuito (al que se volvió tras el
 * bloqueo del 13-sep-2026). Por encima de esto rechaza la subida con "File size
 * too large", así que la app lo frena ANTES de mandar 150 MB por datos móviles
 * para nada.
 */
export const CLOUDINARY_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const CLOUDINARY_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Sin tope, `fetch` de React Native espera para siempre: con mala señal el
 * botón de Guardar se quedaba girando sin error. Un video de 30 s en 720p pesa
 * ~10 MB; 3 minutos alcanzan hasta con 3G, y uno de galería de 100 MB en wifi.
 */
const UPLOAD_TIMEOUT_MS = { image: 60_000, video: 180_000 } as const;

/**
 * Error de una subida a Cloudinary, ya con un mensaje que el equipo entiende.
 * `detail` guarda lo que respondió Cloudinary tal cual, para el rastro en los
 * logs: "no me dejó subir el video" sin captura no dice nada, y este texto sí.
 */
export class CloudinaryUploadError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    // No se llama `status` a propósito: errorMessages lee `status` como código
    // de NUESTRA API, y un 401 de Cloudinary (cuenta suspendida) saldría como
    // "Tu sesión expiró".
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "CloudinaryUploadError";
  }
}

function mb(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Traduce la respuesta de error de Cloudinary a algo accionable. Cloudinary
 * responde `{ "error": { "message": "..." } }` en inglés; antes se mostraba ese
 * JSON crudo pegado a "Error subiendo video:".
 */
export function mensajeDeErrorCloudinary(
  status: number,
  body: string,
  mediaType: "image" | "video",
): string {
  let raw = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === "string") raw = parsed.error.message;
  } catch {
    // No era JSON (p. ej. una página de error del proxy): se usa el texto.
  }
  const que = mediaType === "video" ? "el video" : "la foto";

  // La cuenta suspendida o sin créditos: no se arregla desde el teléfono y
  // falla con fotos y videos por igual. Es lo que pasó el 13-sep.
  if (/cloud_name is disabled|account.*(disabled|suspended)|quota|limit.*exceeded/i.test(raw)) {
    return (
      "El espacio para fotos y videos de Holidog Inn está suspendido y no se " +
      `pudo subir ${que}. Avisa a administración.`
    );
  }
  const tamaño = raw.match(/file size too large.*?got (\d+).*?maximum is (\d+)/i);
  if (tamaño || /file size too large/i.test(raw)) {
    const pesa = tamaño ? ` (pesa ${mb(Number(tamaño[1]))}, el máximo es ${mb(Number(tamaño[2]))})` : "";
    return mediaType === "video"
      ? `El video es demasiado grande${pesa}. Grábalo desde «Grabar video» aquí en la app o elige uno más corto.`
      : `La foto es demasiado grande${pesa}. Toma la foto desde la app.`;
  }
  if (/upload preset|unsigned/i.test(raw)) {
    return `La app no tiene permiso para subir ${que}. Avisa a administración.`;
  }
  if (/invalid (image|video) file|unsupported|format/i.test(raw)) {
    return `No se pudo leer ${que}. Intenta grabarlo de nuevo desde la app.`;
  }
  if (status >= 500) {
    return `El servicio de fotos y videos no responde. Intenta subir ${que} en un momento.`;
  }
  return `No se pudo subir ${que}. Intenta de nuevo.`;
}

/**
 * Upload an image or video to Cloudinary using unsigned upload.
 * @param uri - Local file URI from expo-image-picker
 * @param folder - Optional subfolder inside the preset's asset folder
 * @param mediaType - "image" (default) or "video"
 */
export async function uploadToCloudinary(
  uri: string,
  folder?: string,
  mediaType: "image" | "video" = "image",
): Promise<CloudinaryResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      "Cloudinary no configurado. Agrega EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME y EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET al .env"
    );
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${mediaType}/upload`;
  const isVideo = mediaType === "video";

  const formData = new FormData();
  formData.append("file", {
    uri,
    type: isVideo ? "video/mp4" : "image/jpeg",
    name: isVideo ? "upload.mp4" : "upload.jpg",
  } as any);

  formData.append("upload_preset", UPLOAD_PRESET);

  if (folder) {
    formData.append("folder", folder);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS[mediaType]);
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // Sin "Network request failed" en el mensaje a propósito: errorMessages lo
    // traduciría a "No pudimos conectar con Holidog Inn", y no es nuestro
    // servidor el que falló sino la subida del archivo.
    throw new CloudinaryUploadError(
      controller.signal.aborted
        ? `${isVideo ? "El video" : "La foto"} tardó demasiado en subir. Revisa tu señal o conéctate al wifi e intenta de nuevo.`
        : `Se cortó la conexión mientras subía ${isVideo ? "el video" : "la foto"}. Revisa tu señal o conéctate al wifi e intenta de nuevo.`,
      detail,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CloudinaryUploadError(
      mensajeDeErrorCloudinary(response.status, body, mediaType),
      body.slice(0, 300),
      response.status,
    );
  }

  return response.json();
}

/**
 * Given a Cloudinary video URL (.mp4/.mov/.webm…), returns the URL of an
 * auto-generated JPG thumbnail of the first frame. Cloudinary serves it on
 * the same path simply by changing the extension to `.jpg`.
 *
 * Returns the input unchanged if the URL doesn't look like Cloudinary or has
 * no recognized video extension.
 */
export function videoThumbnailUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/video/upload/")) {
    return url;
  }
  return url.replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, ".jpg");
}

/**
 * Devuelve una variante optimizada de una URL de Cloudinary aplicando
 * transformaciones (resize + auto-quality + auto-format) directamente en la
 * ruta. Si la URL no es de Cloudinary, se devuelve sin cambios.
 *
 * @param url      URL original (secure_url de Cloudinary).
 * @param width    Ancho objetivo en píxeles (el alto se ajusta proporcional).
 * @param mode     "fill" recorta para llenar (thumbnails cuadrados); "limit"
 *                 escala sin recortar manteniendo aspect ratio (viewer).
 */
export function cloudinaryResized(
  url: string,
  width: number,
  mode: "fill" | "limit" = "limit",
): string {
  if (!url.includes("res.cloudinary.com/") || !url.includes("/upload/")) {
    return url;
  }
  const crop = mode === "fill" ? "c_fill" : "c_limit";
  const transform = `${crop},w_${Math.round(width)},q_auto,f_auto`;
  // Sólo insertamos si no hay transformaciones ya en el segmento siguiente a
  // /upload/ (las transformaciones de Cloudinary van separadas por comas).
  return url.replace("/upload/", `/upload/${transform}/`);
}
