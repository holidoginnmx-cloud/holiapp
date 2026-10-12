import { FastifyInstance } from "fastify";
import { createInternalGuard, logInternal } from "../lib/internalAuth";
import { purgeFinishedStayVideos } from "../lib/purgeEvidence";
import { sendPushToUser } from "../lib/push";

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

  // ───────────────────────────────────────────────────────────────────────────
  //  POST /internal/push-test — ¿a quién del equipo le llegan los avisos?
  //
  //  Manda un push de PRUEBA a los ADMIN activos (o a los roles que se pidan)
  //  y devuelve, por persona, cuántos teléfonos tiene registrados y si Expo
  //  aceptó el envío. Sirve para diagnosticar "a mí no me llegó el aviso de
  //  reserva nueva" sin tener que crear una reserva falsa.
  //
  //  Solo push: NO crea fila en la bandeja de notificaciones (sería ruido).
  //  Se dispara a mano desde GitHub Actions (cron.yml → job push-test).
  //
  //    { roles?: ("ADMIN" | "STAFF")[] }   — por omisión, solo ADMIN
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post<{ Body: { roles?: string[] } }>(
    "/internal/push-test",
    { preHandler: internalGuard },
    async (request, reply) => {
      const pedidos = (request.body?.roles ?? ["ADMIN"]).filter(
        (r): r is "ADMIN" | "STAFF" => r === "ADMIN" || r === "STAFF"
      );
      const roles = pedidos.length > 0 ? pedidos : (["ADMIN"] as const);

      const users = await prisma.user.findMany({
        where: { role: { in: [...roles] }, isActive: true },
        select: { id: true, firstName: true, lastName: true, role: true },
        orderBy: { firstName: "asc" },
      });

      const resultados = [];
      for (const u of users) {
        const tokens = await prisma.pushToken.findMany({
          where: { userId: u.id },
          select: { platform: true },
        });
        const aceptado =
          tokens.length > 0 &&
          (await sendPushToUser(prisma, u.id, {
            title: "🔔 Prueba de avisos",
            body: "Si ves esto, te llegan los avisos de reservas nuevas. No hay que hacer nada.",
            data: { kind: "PUSH_TEST" },
          }));
        resultados.push({
          nombre: `${u.firstName ?? ""} ${u.lastName?.charAt(0) ?? ""}`.trim(),
          rol: u.role,
          telefonos: tokens.length,
          plataformas: tokens.map((t) => t.platform),
          aceptado,
        });
      }

      logInternal(request, "internal.push-test", {
        roles,
        total: resultados.length,
        aceptados: resultados.filter((r) => r.aceptado).length,
      });

      return reply.send({
        total: resultados.length,
        aceptados: resultados.filter((r) => r.aceptado).length,
        resultados,
      });
    }
  );
}
