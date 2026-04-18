import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAuthMiddleware } from "../middleware/auth";

const RegisterTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

export default async function pushTokensRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // POST /push-tokens — registrar o actualizar un token Expo para el usuario
  // autenticado. Idempotente: si el token ya existe para este user, actualiza
  // el `updatedAt`; si existe para otro user (cambio de cuenta en el mismo
  // dispositivo), reasigna al user actual.
  fastify.post(
    "/push-tokens",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = RegisterTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { token, platform } = parsed.data;

      const saved = await prisma.pushToken.upsert({
        where: { token },
        update: { userId: request.userId!, platform },
        create: {
          token,
          platform,
          userId: request.userId!,
        },
      });

      return reply.status(201).send({ id: saved.id });
    }
  );

  // DELETE /push-tokens — desregistrar un token (logout o opt-out)
  fastify.delete<{ Querystring: { token?: string } }>(
    "/push-tokens",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { token } = request.query;
      if (!token) {
        return reply.status(400).send({ error: "token requerido" });
      }
      // Solo puede borrar tokens propios
      const existing = await prisma.pushToken.findUnique({ where: { token } });
      if (!existing) return reply.send({ deleted: 0 });
      if (existing.userId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      await prisma.pushToken.delete({ where: { token } });
      return reply.send({ deleted: 1 });
    }
  );
}
