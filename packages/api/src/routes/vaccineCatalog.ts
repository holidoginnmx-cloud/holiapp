import { FastifyInstance } from "fastify";
import { createAuthMiddleware } from "../middleware/auth";

export default async function vaccineCatalogRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // GET /vaccine-catalog — tipos de vacuna disponibles con duración default
  fastify.get(
    "/vaccine-catalog",
    { preHandler: [authMiddleware] },
    async () => {
      const entries = await prisma.vaccineCatalog.findMany({
        where: { isActive: true },
        orderBy: { displayName: "asc" },
      });
      return entries;
    }
  );
}
