import { FastifyInstance } from "fastify";
import { createAuthMiddleware } from "../middleware/auth";

export default async function notificationsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  const isAdmin = (role?: string) => role === "ADMIN";

  // GET /notifications/:userId — notificaciones de un usuario (self o admin)
  fastify.get<{ Params: { userId: string } }>(
    "/notifications/:userId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      if (!isAdmin(request.userRole) && request.params.userId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.params.userId },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      const notifications = await prisma.notification.findMany({
        where: { userId: request.params.userId },
        orderBy: { createdAt: "desc" },
      });
      return notifications;
    }
  );

  // PATCH /notifications/:id/read — marcar como leída (solo dueña de la notificación o admin)
  fastify.patch<{ Params: { id: string } }>(
    "/notifications/:id/read",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const notification = await prisma.notification.findUnique({
        where: { id: request.params.id },
      });
      if (!notification) {
        return reply.status(404).send({ error: "Notificación no encontrada" });
      }
      if (!isAdmin(request.userRole) && notification.userId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const updated = await prisma.notification.update({
        where: { id: request.params.id },
        data: { isRead: true },
      });
      return updated;
    }
  );

  // PATCH /notifications/read-all/:userId — marcar todas como leídas (self o admin)
  fastify.patch<{ Params: { userId: string } }>(
    "/notifications/read-all/:userId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      if (!isAdmin(request.userRole) && request.params.userId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.params.userId },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      const result = await prisma.notification.updateMany({
        where: { userId: request.params.userId, isRead: false },
        data: { isRead: true },
      });
      return { updated: result.count };
    }
  );
}
