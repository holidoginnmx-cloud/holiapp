import type { PrismaClient, Prisma } from "@prisma/client";
import type { PetSize, ReservationStatus } from "@holidoginn/shared";

/**
 * Ocupación de cuartos en un rango de fechas.
 *
 * ⚠️ El predicado de solape de `stayOverlapWhere` es la MISMA verdad que usan
 * el 409 de reservationTeamCreate.ts y el advisory lock de
 * lockRoomsAndVerifyCapacity (reservationCreate.ts). Si cambia aquí y no allá,
 * la pantalla le dice al equipo que un cuarto está libre y el servidor lo
 * rechaza al guardar (o al revés), que es exactamente el problema que este
 * módulo vino a resolver.
 *
 * Una `Reservation` es una fila POR PERRO: varias filas pueden compartir
 * `roomId`, y el cuarto está lleno cuando el conteo llega a `capacity`.
 */

/** Reservación con cuarto vivo que pisa el rango [checkIn, checkOut). */
export function stayOverlapWhere(args: {
  checkIn: Date;
  checkOut: Date;
  /** Reservaciones a ignorar: al reasignar, la estancia no se cuenta a sí misma. */
  excludeReservationIds?: string[];
}): Prisma.ReservationWhereInput {
  const { checkIn, checkOut, excludeReservationIds } = args;
  return {
    reservationType: "STAY",
    status: { notIn: ["CANCELLED", "CHECKED_OUT"] as ReservationStatus[] },
    ...(excludeReservationIds?.length
      ? { id: { notIn: excludeReservationIds } }
      : {}),
    // Rango medio abierto: el día de salida libera el cuarto, así que una
    // estancia que se va el día que otra llega NO ocupa.
    AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
  };
}

/** roomId → cuántos perros lo ocupan en ese rango. Una sola consulta. */
export async function countRoomOccupancy(
  prisma: PrismaClient,
  args: { checkIn: Date; checkOut: Date; excludeReservationIds?: string[] }
): Promise<Map<string, number>> {
  const grouped = await prisma.reservation.groupBy({
    by: ["roomId"],
    where: { ...stayOverlapWhere(args), roomId: { not: null } },
    _count: { _all: true },
  });

  const porCuarto = new Map<string, number>();
  for (const row of grouped) {
    // roomId nunca es null aquí por el where, pero el tipo lo permite (la FK
    // es ON DELETE SET NULL).
    if (row.roomId) porCuarto.set(row.roomId, row._count._all);
  }
  return porCuarto;
}

export type RoomWithOccupancy = Prisma.RoomGetPayload<object> & {
  /** Perros que ya tienen ese cuarto en el rango. */
  occupied: number;
  /** Lugares libres. Puede ser negativo si alguien sobrevendió a mano. */
  remaining: number;
};

/**
 * Todos los cuartos activos con su ocupación. NO filtra: describir es el punto,
 * que quien llame decida si esconde los llenos (así lo hace /rooms/available).
 */
export async function roomsWithOccupancy(
  prisma: PrismaClient,
  args: {
    checkIn: Date;
    checkOut: Date;
    /** Opcional: solo cuartos que admiten esa talla. */
    size?: PetSize;
    excludeReservationIds?: string[];
  }
): Promise<RoomWithOccupancy[]> {
  const [rooms, porCuarto] = await Promise.all([
    prisma.room.findMany({
      where: {
        isActive: true,
        ...(args.size ? { sizeAllowed: { has: args.size } } : {}),
      },
      orderBy: { createdAt: "asc" },
    }),
    countRoomOccupancy(prisma, args),
  ]);

  return rooms.map((room) => {
    const occupied = porCuarto.get(room.id) ?? 0;
    return { ...room, occupied, remaining: room.capacity - occupied };
  });
}
