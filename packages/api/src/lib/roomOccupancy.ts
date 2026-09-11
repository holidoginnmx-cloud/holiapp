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

/** Un perro que ocupa el cuarto en el rango consultado. */
export type RoomOccupant = {
  reservationId: string;
  petName: string;
  checkIn: Date | null;
  checkOut: Date | null;
  status: ReservationStatus;
};

/**
 * roomId → quiénes lo ocupan en ese rango. Mismo predicado que
 * countRoomOccupancy: la lista de nombres y el conteo no pueden contradecirse.
 */
export async function listRoomOccupants(
  prisma: PrismaClient,
  args: { checkIn: Date; checkOut: Date; excludeReservationIds?: string[] }
): Promise<Map<string, RoomOccupant[]>> {
  const filas = await prisma.reservation.findMany({
    where: { ...stayOverlapWhere(args), roomId: { not: null } },
    select: {
      id: true,
      roomId: true,
      checkIn: true,
      checkOut: true,
      status: true,
      pet: { select: { name: true } },
    },
    orderBy: { checkIn: "asc" },
  });

  const porCuarto = new Map<string, RoomOccupant[]>();
  for (const f of filas) {
    if (!f.roomId) continue;
    porCuarto.set(f.roomId, [
      ...(porCuarto.get(f.roomId) ?? []),
      {
        reservationId: f.id,
        petName: f.pet.name,
        checkIn: f.checkIn,
        checkOut: f.checkOut,
        status: f.status as ReservationStatus,
      },
    ]);
  }
  return porCuarto;
}

/**
 * ¿Caben `adding` perros más en el cuarto en ese rango? Sin lock: sirve para
 * fallar rápido con un mensaje claro antes de tocar dinero. La verificación que
 * cuenta de verdad es la de lockRoomsAndVerifyCapacity dentro de la transacción.
 */
export async function checkRoomCapacity(
  prisma: PrismaClient,
  args: {
    roomId: string;
    checkIn: Date;
    checkOut: Date;
    excludeReservationIds?: string[];
    adding?: number;
  }
): Promise<{
  ok: boolean;
  room: { name: string; capacity: number } | null;
  taken: number;
}> {
  const { roomId, checkIn, checkOut, excludeReservationIds, adding = 1 } = args;
  const [room, porCuarto] = await Promise.all([
    prisma.room.findUnique({
      where: { id: roomId },
      select: { name: true, capacity: true },
    }),
    countRoomOccupancy(prisma, { checkIn, checkOut, excludeReservationIds }),
  ]);
  const taken = porCuarto.get(roomId) ?? 0;
  return { ok: !!room && taken + adding <= room.capacity, room, taken };
}

export type RoomWithOccupancy = Prisma.RoomGetPayload<object> & {
  /** Perros que ya tienen ese cuarto en el rango. */
  occupied: number;
  /** Lugares libres. Puede ser negativo si alguien sobrevendió a mano. */
  remaining: number;
  /** Solo con `withOccupants`: quiénes son esos perros. */
  occupants?: RoomOccupant[];
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
    /**
     * Incluye los nombres de los perros. SOLO para rutas del equipo: la app del
     * dueño (/rooms/available) no debe ver mascotas ajenas.
     */
    withOccupants?: boolean;
  }
): Promise<RoomWithOccupancy[]> {
  // Con ocupantes, el conteo sale de la MISMA consulta que los nombres: así
  // "2 de 4" y la lista de abajo nunca se contradicen.
  const ocupacion = args.withOccupants
    ? listRoomOccupants(prisma, args).then((ocupantes) => ({
        ocupantes,
        conteo: new Map([...ocupantes].map(([id, l]) => [id, l.length])),
      }))
    : countRoomOccupancy(prisma, args).then((conteo) => ({
        ocupantes: null,
        conteo,
      }));

  const [rooms, { ocupantes, conteo }] = await Promise.all([
    prisma.room.findMany({
      where: {
        isActive: true,
        ...(args.size ? { sizeAllowed: { has: args.size } } : {}),
      },
      orderBy: { createdAt: "asc" },
    }),
    ocupacion,
  ]);

  return rooms.map((room) => {
    const occupied = conteo.get(room.id) ?? 0;
    return {
      ...room,
      occupied,
      remaining: room.capacity - occupied,
      ...(ocupantes ? { occupants: ocupantes.get(room.id) ?? [] } : {}),
    };
  });
}
