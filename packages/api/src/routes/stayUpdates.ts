import { FastifyInstance } from "fastify";
import { CreateStayUpdateSchema } from "@holidoginn/shared";
import { createAuthMiddleware, createStaffMiddleware } from "../middleware/auth";

export default async function stayUpdatesRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const staffMiddleware = createStaffMiddleware();

  // GET /stay-updates/:reservationId — fotos de una reservación (owner o staff/admin)
  fastify.get<{ Params: { reservationId: string } }>(
    "/stay-updates/:reservationId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.reservationId },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const updates = await prisma.stayUpdate.findMany({
        where: { reservationId: request.params.reservationId },
        include: {
          pet: { select: { id: true, name: true, photoUrl: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return updates;
    }
  );

  // POST /stay-updates — subir nueva foto/update (solo staff/admin)
  fastify.post(
    "/stay-updates",
    { preHandler: [authMiddleware, staffMiddleware] },
    async (request, reply) => {
      const parsed = CreateStayUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: parsed.data.reservationId },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const pet = await prisma.pet.findUnique({
        where: { id: parsed.data.petId },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }

      const update = await prisma.stayUpdate.create({
        data: parsed.data,
      });
      return reply.status(201).send(update);
    }
  );
}
