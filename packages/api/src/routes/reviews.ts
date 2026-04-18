import { FastifyInstance } from "fastify";
import { CreateReviewSchema } from "@holidoginn/shared";
import { createAuthMiddleware } from "../middleware/auth";

export default async function reviewsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // POST /reviews — crear reseña post-estancia
  fastify.post(
    "/reviews",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: parsed.data.reservationId },
      });
      if (!reservation) {
        return reply
          .status(404)
          .send({ error: "Reservación no encontrada" });
      }
      if (reservation.status !== "CHECKED_OUT") {
        return reply
          .status(400)
          .send({ error: "Solo puedes dejar reseña en estancias finalizadas" });
      }
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const existing = await prisma.review.findUnique({
        where: { reservationId: parsed.data.reservationId },
      });
      if (existing) {
        return reply
          .status(409)
          .send({ error: "Ya existe una reseña para esta reservación" });
      }

      const review = await prisma.review.create({
        data: {
          ...parsed.data,
          ownerId: request.userId!,
        },
      });
      return reply.status(201).send(review);
    }
  );

  // GET /reviews/:reservationId — obtener reseña por reservación (owner o staff/admin)
  fastify.get<{ Params: { reservationId: string } }>(
    "/reviews/:reservationId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const review = await prisma.review.findUnique({
        where: { reservationId: request.params.reservationId },
      });
      if (!review) {
        return reply.status(404).send({ error: "Reseña no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && review.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      return review;
    }
  );
}
