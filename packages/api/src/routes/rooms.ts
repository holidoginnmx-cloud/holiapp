import { FastifyInstance } from "fastify";
import { CreateRoomSchema, UpdateRoomSchema, PetSize, ReservationStatus } from "@holidoginn/shared";
import {
  createAuthMiddleware,
  createAdminMiddleware,
  createStaffMiddleware,
} from "../middleware/auth";
import { roomsWithOccupancy } from "../lib/roomOccupancy";

export default async function roomsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const staffMiddleware = createStaffMiddleware();
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
  // Lo consume la app del DUEÑO: devuelve Room[] a secas (esconde los llenos).
  // Para ver la ocupación en vez de esconderla, ver /rooms/occupancy.
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

    const rooms = await roomsWithOccupancy(prisma, {
      checkIn: checkInDate,
      checkOut: checkOutDate,
      size: petSize as PetSize,
    });

    return rooms
      .filter((r) => r.remaining > 0)
      .map(({ occupied, remaining, ...rest }) => rest);
  });

  // GET /rooms/occupancy — TODOS los cuartos activos con su ocupación en el
  // rango. El equipo elige el cuarto a mano: necesita ver los llenos en gris,
  // no que desaparezcan (antes se enteraba con el 409 al guardar).
  // Sin filtro de talla: en una reservación de varias mascotas cada perro tiene
  // la suya, y el cliente ya resuelve eso por opción.
  fastify.get<{
    Querystring: {
      checkIn: string;
      checkOut: string;
      /** Al reasignar: la propia estancia no debe contarse a sí misma. */
      excludeReservationId?: string;
    };
  }>(
    "/rooms/occupancy",
    { preHandler: [authMiddleware, staffMiddleware] },
    async (request, reply) => {
      const { checkIn, checkOut, excludeReservationId } = request.query;
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);

      if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        return reply
          .status(400)
          .send({ error: "checkIn y checkOut deben ser fechas válidas" });
      }
      if (checkOutDate <= checkInDate) {
        return reply
          .status(400)
          .send({ error: "checkOut debe ser posterior a checkIn" });
      }

      return roomsWithOccupancy(prisma, {
        checkIn: checkInDate,
        checkOut: checkOutDate,
        ...(excludeReservationId
          ? { excludeReservationIds: [excludeReservationId] }
          : {}),
      });
    }
  );
}
