// ─────────────────────────────────────────────────────────────────────────────
//  Cloudinary — Admin API (borrado de archivos)
//
//  La app SUBE con un preset "unsigned" (solo cloud_name + preset, sin llaves).
//  BORRAR es otra cosa: necesita las llaves de administrador, que viven SOLO
//  aquí, en el servidor. Por eso el borrado nunca puede hacerlo la app.
//
//  Contexto (14-sep-2026): la cuenta se bloqueó con "cloud_name is disabled"
//  por agotar el plan gratuito. Medido: 20 GB guardados, 98% videos del
//  checklist. El botón de eliminar evidencias que ya existía borraba la fila de
//  la base pero dejaba el archivo huérfano en Cloudinary — nunca se llamó
//  destroy y no se guardaba el public_id. Este módulo cierra ese hueco.
//
//  Config (variables de Railway). Sin ellas el módulo queda APAGADO y cualquier
//  llamada devuelve `configured: false` sin borrar nada: preferimos no borrar a
//  borrar a ciegas.
//
//    CLOUDINARY_CLOUD_NAME   (dbquowtui)
//    CLOUDINARY_API_KEY
//    CLOUDINARY_API_SECRET
// ─────────────────────────────────────────────────────────────────────────────

export type CloudinaryResourceType = "image" | "video";

export type DestroyResult = {
  configured: boolean;
  /** public_ids que Cloudinary confirmó borrados. */
  deleted: string[];
  /** public_ids que ya no existían (se tratan como éxito: el objetivo es que no estén). */
  notFound: string[];
  /** public_ids que Cloudinary rechazó, con su motivo. */
  failed: { publicId: string; reason: string }[];
};

function config() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

export function cloudinaryAdminConfigured(): boolean {
  return config() !== null;
}

/**
 * public_id a partir de un `secure_url`.
 *
 * Formato: /<cloud>/<resource_type>/upload/[<transformaciones>/][v<versión>/]<public_id>.<ext>
 *
 * Hay que quitar tres cosas que NO son parte del public_id: las
 * transformaciones (`c_fill,w_360,q_auto` — las mete `cloudinaryResized` en la
 * app, así que pueden aparecer en una URL guardada), la versión (`v1787005873`)
 * y la extensión. Lo que queda incluye la carpeta: `checklists/m1rcltqy…`.
 *
 * Devuelve null si la URL no es de Cloudinary o no trae `/upload/`: así una URL
 * de Supabase Storage (hay 10 fotos de mascota ahí) nunca llega al borrado.
 */
export function publicIdFromUrl(url: string): string | null {
  if (!url.includes("res.cloudinary.com/")) return null;
  const marker = "/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return null;

  const rest = url.slice(at + marker.length).split("?")[0].split("#")[0];
  const parts = rest.split("/").filter(Boolean);

  while (parts.length > 1) {
    const head = parts[0];
    const esVersion = /^v\d+$/.test(head);
    // Una transformación es una lista de `clave_valor` separada por comas:
    // `c_fill,w_360,q_auto`, `f_auto`, `w_1600`.
    const esTransformacion = head
      .split(",")
      .every((seg) => /^[a-z]{1,3}_[A-Za-z0-9_.:%-]+$/.test(seg));
    if (!esVersion && !esTransformacion) break;
    parts.shift();
  }

  const full = parts.join("/");
  if (!full) return null;
  return full.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/**
 * Borra hasta 100 archivos por llamada (tope de la Admin API de Cloudinary).
 *
 * Usa `DELETE /resources/<resource_type>/upload` con Basic auth en vez de
 * `destroy` uno por uno: una sola petición por cada 100 archivos, que con el
 * tope de 2000 llamadas diarias de la Admin API del plan deja muchísimo aire.
 */
async function deleteBatch(
  publicIds: string[],
  resourceType: CloudinaryResourceType
): Promise<DestroyResult> {
  const cfg = config();
  if (!cfg) {
    return { configured: false, deleted: [], notFound: [], failed: [] };
  }
  if (publicIds.length === 0) {
    return { configured: true, deleted: [], notFound: [], failed: [] };
  }

  const params = new URLSearchParams();
  for (const id of publicIds) params.append("public_ids[]", id);

  const url =
    `https://api.cloudinary.com/v1_1/${cfg.cloudName}` +
    `/resources/${resourceType}/upload?${params.toString()}`;
  const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Un fallo de red o de credenciales NO es "no encontrado": que fallen todos
    // y el llamador conserve las filas, para reintentar en la siguiente vuelta.
    return {
      configured: true,
      deleted: [],
      notFound: [],
      failed: publicIds.map((publicId) => ({
        publicId,
        reason: `HTTP ${res.status} ${body.slice(0, 200)}`,
      })),
    };
  }

  const json = (await res.json()) as { deleted?: Record<string, string> };
  const deleted: string[] = [];
  const notFound: string[] = [];
  const failed: { publicId: string; reason: string }[] = [];

  for (const publicId of publicIds) {
    const estado = json.deleted?.[publicId];
    if (estado === "deleted") deleted.push(publicId);
    else if (estado === "not_found") notFound.push(publicId);
    else failed.push({ publicId, reason: estado ?? "sin respuesta" });
  }

  return { configured: true, deleted, notFound, failed };
}

/** Borra cualquier cantidad de archivos, partiendo en lotes de 100. */
export async function destroyResources(
  publicIds: string[],
  resourceType: CloudinaryResourceType
): Promise<DestroyResult> {
  const unicos = [...new Set(publicIds)];
  const total: DestroyResult = {
    configured: cloudinaryAdminConfigured(),
    deleted: [],
    notFound: [],
    failed: [],
  };
  if (!total.configured) return total;

  for (let i = 0; i < unicos.length; i += 100) {
    const lote = await deleteBatch(unicos.slice(i, i + 100), resourceType);
    total.deleted.push(...lote.deleted);
    total.notFound.push(...lote.notFound);
    total.failed.push(...lote.failed);
  }
  return total;
}
