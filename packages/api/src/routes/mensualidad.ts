import { FastifyInstance } from "fastify";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { createInternalGuard } from "../lib/internalAuth";
import { getEstadoMensualidad } from "../lib/mensualidad";

// ─────────────────────────────────────────────────────────────────────────────
//  Recordatorio de la mensualidad de las apps (ver lib/mensualidad.ts)
//
//  GET /admin/mensualidad     → app móvil, solo ADMIN (el STAFF no ve dinero)
//  GET /internal/mensualidad  → admin web (x-cron-secret); el panel decide
//                               si el viewer es ADMIN antes de mostrarlo
// ─────────────────────────────────────────────────────────────────────────────

export default async function mensualidadRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const internalGuard = createInternalGuard(prisma);

  fastify.get(
    "/admin/mensualidad",
    { preHandler: [authMiddleware, adminMiddleware] },
    async () => getEstadoMensualidad(),
  );

  fastify.get(
    "/internal/mensualidad",
    { preHandler: internalGuard },
    async () => getEstadoMensualidad(),
  );
}
