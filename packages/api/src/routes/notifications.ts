import { FastifyInstance } from "fastify";
import { createAuthMiddleware } from "../middleware/auth";
import { parsePageRequest, prismaPageArgs, buildPage } from "../lib/pagination";

export default async function notificationsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  const isAdmin = (role?: string) => role === "ADMIN";

  // GET /notifications/:userId — notificaciones de un usuario (self o admin)
  //
  // Paginación OPT-IN (ver lib/pagination.ts): la app instalada pide esto cada
  // 30 segundos SIN parámetros y espera un arreglo pelón con toda la bandeja;
  // eso no se puede tocar hasta que el OTA llegue a todos los teléfonos. Con
  // `?limit=` (y `?cursor=`) devuelve `{ items, nextCursor, hasMore,
  // unreadCount }`. `unreadCount` es de la bandeja COMPLETA, no de la página:
  // es lo que necesita el badge, que es justo lo que va a buscar el poll.
  fastify.get<{
    Params: { userId: string };
    Querystring: { limit?: string; cursor?: string };
  }>(
    "/notifications/:userId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      if (!isAdmin(request.userRole) && request.params.userId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const parsedPage = parsePageRequest(request.query);
      if (!parsedPage.ok) {
        return reply.status(400).send({ error: parsedPage.error });
      }
      const pageReq = parsedPage.page;

      const user = await prisma.user.findUnique({
        where: { id: request.params.userId },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      const notifications = await prisma.notification.findMany({
        where: { userId: request.params.userId },
        // `id` de desempate: el cursor necesita un orden determinista (varias
        // notificaciones de la misma reserva se crean en el mismo instante).
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...prismaPageArgs(pageReq),
      });

      if (!pageReq.paginated) return notifications;

      const page = buildPage(notifications, pageReq.limit);
      const unreadCount = await prisma.notification.count({
        where: { userId: request.params.userId, isRead: false },
      });
      return {
        items: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        unreadCount,
      };
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
