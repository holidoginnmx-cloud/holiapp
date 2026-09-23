import { FastifyInstance } from "fastify";
import { createInternalGuard, logInternal } from "../lib/internalAuth";
import { purgeFinishedStayVideos } from "../lib/purgeEvidence";

// ─────────────────────────────────────────────────────────────────────────────
//  POST /internal/purge-evidence — purga manual de videos de evidencia
//
//  La purga normal corre sola con el mantenimiento (cada 10 min) cuando
//  EVIDENCE_PURGE_ENABLED=true. Este endpoint es para las dos cosas que no
//  puede hacer sola:
//
//    · ver qué borraría ANTES de borrarlo  → { "dryRun": true }
//    · vaciar el histórico a ritmo controlado, en tandas
//
//  Corre DENTRO de Railway porque desde la máquina del usuario no hay Postgres
//  (ver memoria "no-hay-postgres-desde-la-maquina"). Se dispara con el
//  CRON_SECRET, igual que el resto de /internal/*.
//
//    { dryRun?: boolean, limit?: number, graceHours?: number }
//
//  `dryRun` es el valor POR OMISIÓN: para que borre de verdad hay que pedirlo
//  explícitamente con { "dryRun": false }. Es un borrado irreversible; la
//  equivocación debe ser no borrar, no borrar de más.
// ─────────────────────────────────────────────────────────────────────────────

export default async function internalMaintenanceRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const internalGuard = createInternalGuard(prisma);

  fastify.post<{
    Body: { dryRun?: boolean; limit?: number; graceHours?: number };
  }>(
    "/internal/purge-evidence",
    { preHandler: internalGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const dryRun = body.dryRun !== false;
      const limit =
        Number.isFinite(body.limit) && (body.limit as number) > 0
          ? Math.min(body.limit as number, 500)
          : undefined;

      const resumen = await purgeFinishedStayVideos(prisma, {
        dryRun,
        limit,
        graceHours: body.graceHours,
      });

      logInternal(request, "internal.purge-evidence", {
        dryRun,
        candidatos: resumen.candidatos,
        filasEliminadas: resumen.filasEliminadas,
        fallidos: resumen.fallidos,
        restantes: resumen.restantes,
      });

      if (!resumen.configured) {
        return reply.status(503).send({
          error:
            "Cloudinary sin llaves de administrador. Faltan CLOUDINARY_CLOUD_NAME, " +
            "CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en Railway.",
          code: "CLOUDINARY_NOT_CONFIGURED",
          ...resumen,
        });
      }
      return resumen;
    }
  );
}
