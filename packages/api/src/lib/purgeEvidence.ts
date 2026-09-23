import type { Prisma, PrismaClient } from "@holidoginn/db";
import {
  cloudinaryAdminConfigured,
  destroyResources,
  publicIdFromUrl,
} from "./cloudinaryAdmin";

// ─────────────────────────────────────────────────────────────────────────────
//  Purga de VIDEOS de evidencia de reservaciones ya terminadas
//
//  Decisión del equipo (14-sep-2026), para volver al plan gratuito de
//  Cloudinary: en cuanto una reservación termina, sus VIDEOS se borran. Las
//  fotos se quedan — pesan 0.3 GB contra 19.7 GB de los videos.
//
//  QUÉ NO SE TOCA, NUNCA:
//    · foto de perfil de la mascota (pets.photoUrl)
//    · cartillas (pets.cartillaPhotos / cartillaUrl)
//    · comprobantes de vacunas y desparasitaciones (fileUrl)
//    · fotos de evidencia, de baños y del catálogo de la tienda
//
//  Tres candados para garantizarlo, y cualquiera de los tres basta:
//    1. Solo filas de `stay_updates` (las fotos de perfil y cartillas viven en
//       `pets`, otra tabla; el catálogo en `product_images`).
//    2. Solo `mediaType = "video"`.
//    3. Solo URLs con `/video/upload/`, que es como Cloudinary marca un
//       recurso de tipo video. Todo lo que hay que conservar es `/image/upload/`,
//       así que no puede colarse aunque una fila estuviera mal clasificada.
//
//  Interruptores (Railway):
//    EVIDENCE_PURGE_ENABLED=true     enciende la purga automática. APAGADA por
//                                    omisión: poner las llaves de Cloudinary no
//                                    debe disparar por sorpresa el borrado de
//                                    todo el histórico.
//    EVIDENCE_PURGE_GRACE_HOURS=0    horas de cortesía tras el checkout antes
//                                    de borrar. 0 = en cuanto termina.
// ─────────────────────────────────────────────────────────────────────────────

const LOTE_POR_VUELTA = 200;

export type PurgeOptions = {
  /** Horas tras terminar la reservación antes de borrar. Por omisión, la de Railway (0). */
  graceHours?: number;
  /** Máximo de videos a procesar en esta corrida. */
  limit?: number;
  /** true = solo reporta lo que borraría, no toca nada. */
  dryRun?: boolean;
};

export type PurgeSummary = {
  /** Hay llaves de Cloudinary configuradas. */
  configured: boolean;
  dryRun: boolean;
  graceHours: number;
  /** Videos que cumplen la condición y entraron a esta corrida. */
  candidatos: number;
  borradosEnCloudinary: number;
  yaNoEstaban: number;
  fallidos: number;
  filasEliminadas: number;
  reportesMarcados: number;
  /** Primeras URLs de la corrida, para revisar a ojo antes de aplicar. */
  ejemplos: string[];
  /** Cuántos videos quedan pendientes después de esta corrida. */
  restantes: number;
};

function graceHoursPorOmision(): number {
  const raw = Number(process.env.EVIDENCE_PURGE_GRACE_HOURS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

export function purgaAutomaticaEncendida(): boolean {
  return process.env.EVIDENCE_PURGE_ENABLED === "true";
}

/**
 * Borra los videos de evidencia de reservaciones terminadas o canceladas:
 * primero el archivo en Cloudinary, y solo entonces la fila.
 *
 * El orden importa. Si se borrara la fila primero y Cloudinary fallara, el
 * archivo quedaría huérfano para siempre — sin fila, nadie sabe que existe.
 * Así, un fallo deja la fila viva y la siguiente vuelta lo reintenta.
 */
export async function purgeFinishedStayVideos(
  prisma: PrismaClient,
  opts: PurgeOptions = {}
): Promise<PurgeSummary> {
  const graceHours = opts.graceHours ?? graceHoursPorOmision();
  const limit = opts.limit ?? LOTE_POR_VUELTA;
  const dryRun = opts.dryRun === true;
  const configured = cloudinaryAdminConfigured();

  const where: Prisma.StayUpdateWhereInput = {
    mediaType: "video",
    mediaUrl: { contains: "/video/upload/" },
    reservation: {
      status: { in: ["CHECKED_OUT", "CANCELLED"] },
      ...(graceHours > 0
        ? { updatedAt: { lt: new Date(Date.now() - graceHours * 3_600_000) } }
        : {}),
    },
  };

  const candidatos = await prisma.stayUpdate.findMany({
    where,
    select: { id: true, mediaUrl: true, reservationId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const resumen: PurgeSummary = {
    configured,
    dryRun,
    graceHours,
    candidatos: candidatos.length,
    borradosEnCloudinary: 0,
    yaNoEstaban: 0,
    fallidos: 0,
    filasEliminadas: 0,
    reportesMarcados: 0,
    ejemplos: candidatos.slice(0, 5).map((c) => c.mediaUrl),
    restantes: 0,
  };

  if (candidatos.length === 0 || dryRun || !configured) {
    resumen.restantes = await prisma.stayUpdate.count({ where });
    return resumen;
  }

  // public_id ↔ filas. Varias filas pueden apuntar al mismo archivo (una
  // evidencia duplicada entre hermanos de una multireserva), así que se agrupa.
  const porPublicId = new Map<string, typeof candidatos>();
  for (const fila of candidatos) {
    const publicId = publicIdFromUrl(fila.mediaUrl);
    if (!publicId) {
      resumen.fallidos += 1;
      continue;
    }
    const previas = porPublicId.get(publicId) ?? [];
    previas.push(fila);
    porPublicId.set(publicId, previas);
  }

  const res = await destroyResources([...porPublicId.keys()], "video");
  resumen.borradosEnCloudinary = res.deleted.length;
  resumen.yaNoEstaban = res.notFound.length;
  resumen.fallidos += res.failed.length;

  // Solo se borra la fila de lo que ya no está en Cloudinary. Lo que falló
  // conserva su fila y se reintenta en la siguiente vuelta.
  const liberados = [...res.deleted, ...res.notFound];
  const filas = liberados.flatMap((publicId) => porPublicId.get(publicId) ?? []);
  if (filas.length === 0) return resumen;

  const borradas = await prisma.stayUpdate.deleteMany({
    where: { id: { in: filas.map((f) => f.id) } },
  });
  resumen.filasEliminadas = borradas.count;

  // Marca los reportes diarios para que la app pueda decir "ya no disponibles"
  // en vez de anunciar videos que no se pueden abrir.
  //
  // Se marca por RESERVACIÓN, no por día. El día del reporte es la medianoche
  // UTC de la fecha LOCAL del equipo, mientras que `createdAt` es el instante
  // real: en Hermosillo (UTC-7) una evidencia subida a las 6 de la tarde cae al
  // día siguiente en UTC, y emparejar por día fallaría justo en las tardes. Como
  // la purga se lleva TODOS los videos de una reservación terminada, basta con
  // comprobar que ya no quede ninguno y marcar sus reportes de una vez.
  const ahora = new Date();
  for (const reservationId of new Set(filas.map((f) => f.reservationId))) {
    const quedan = await prisma.stayUpdate.count({
      where: { reservationId, mediaType: "video" },
    });
    if (quedan > 0) continue; // alguno falló: se marca cuando ya no quede nada
    const marcados = await prisma.dailyChecklist.updateMany({
      where: { reservationId, videosCount: { gt: 0 }, videosPurgedAt: null },
      data: { videosPurgedAt: ahora },
    });
    resumen.reportesMarcados += marcados.count;
  }

  resumen.restantes = await prisma.stayUpdate.count({ where });
  return resumen;
}
