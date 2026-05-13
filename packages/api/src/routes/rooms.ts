import { FastifyInstance } from "fastify";
import { CreateRoomSchema, UpdateRoomSchema, PetSize, ReservationStatus } from "@holidoginn/shared";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";

export default async function roomsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];

  // GET /rooms — listar activos (acepta query ?size= para filtrar)
  fastify.get<{ Querystring: { size?: PetSize } }>(
    "/rooms",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { size } = request.query;
      const rooms = await prisma.room.findMany({
        where: {
          isActive: true,
          ...(size ? { sizeAllowed: { has: size } } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      return rooms;
    }
  );

  // GET /rooms/:id — obtener uno
  fastify.get<{ Params: { id: string } }>(
    "/rooms/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const room = await prisma.room.findUnique({
        where: { id: request.params.id },
      });
      if (!room) {
        return reply.status(404).send({ error: "Cuarto no encontrado" });
      }
      return room;
    }
  );

  // POST /rooms — crear (solo admin)
  fastify.post("/rooms", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = CreateRoomSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const room = await prisma.room.create({ data: parsed.data });
    return reply.status(201).send(room);
  });

  // PATCH /rooms/:id — actualizar (solo admin)
  fastify.patch<{ Params: { id: string } }>("/rooms/:id", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = UpdateRoomSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const room = await prisma.room.findUnique({ where: { id: request.params.id } });
    if (!room) {
      return reply.status(404).send({ error: "Cuarto no encontrado" });
    }

    const updated = await prisma.room.update({
      where: { id: request.params.id },
      data: parsed.data,
    });
    return updated;
  });

  // DELETE /rooms/:id — eliminar (solo admin)
  // Bloquea si hay reservaciones activas (no CHECKED_OUT ni CANCELLED).
  // Reservaciones históricas mantienen su registro: roomId pasa a null por ON DELETE SET NULL.
  fastify.delete<{ Params: { id: string } }>(
    "/rooms/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const room = await prisma.room.findUnique({
        where: { id: request.params.id },
      });
      if (!room) {
        return reply.status(404).send({ error: "Cuarto no encontrado" });
      }

      const activeCount = await prisma.reservation.count({
        where: {
          roomId: request.params.id,
          status: {
            notIn: ["CHECKED_OUT", "CANCELLED"] as ReservationStatus[],
          },
        },
      });

      if (activeCount > 0) {
        return reply.status(409).send({
          error:
            "El cuarto tiene reservaciones activas. Cancélalas o márcalas como check-out antes de eliminar.",
        });
      }

      await prisma.room.delete({ where: { id: request.params.id } });
      return reply.status(204).send();
    }
  );

  // GET /rooms/available — cuartos con capacidad disponible para fechas y tamaño.
  // Toma en cuenta `capacity`: un cuarto se considera disponible mientras la
  // cantidad de reservaciones activas solapadas sea menor a su capacidad.
  fastify.get<{
    Querystring: { checkIn: string; checkOut: string; petSize: string };
  }>("/rooms/available", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { checkIn, checkOut, petSize } = request.query;
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    if (checkOutDate <= checkInDate) {
      return reply
        .status(400)
        .send({ error: "checkOut debe ser posterior a checkIn" });
    }

    const candidateRooms = await prisma.room.findMany({
      where: {
        isActive: true,
        sizeAllowed: { has: petSize as PetSize },
      },
      include: {
        _count: {
          select: {
            reservations: {
              where: {
                reservationType: "STAY",
                status: {
                  notIn: ["CANCELLED", "CHECKED_OUT"] as ReservationStatus[],
                },
                AND: [
                  { checkIn: { lt: checkOutDate } },
                  { checkOut: { gt: checkInDate } },
                ],
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return candidateRooms
      .filter((r) => r._count.reservations < r.capacity)
      .map(({ _count, ...rest }) => rest);
  });
}
