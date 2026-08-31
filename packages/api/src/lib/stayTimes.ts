import type { PrismaClient, Reservation } from "@holidoginn/db";
import { equipoActivoIds, notifyUsers } from "./notify";
import { ymdAtLocalMinutes } from "./bathAvailability";

/**
 * Escritura de la hora estimada de llegada/recogida de un hospedaje o guardería
 * (`checkInTime`/`checkOutTime`, "HH:mm" en hora local del hotel).
 *
 * Vive aparte del handler porque la usan TRES entradas: la ruta del cliente y
 * del equipo (`PATCH /reservations/:id/times`), la ruta interna que consume el
 * admin web (`PATCH /internal/reservations/:id/times`) y, a futuro, cualquier
 * otro camino. Copiar el cuerpo fue exactamente lo que desincronizó los avisos
 * de reserva nueva en su momento.
 */

/**
 * Instante real en el que llega el cliente.
 *
 * En un baño es la cita (`appointmentAt`, un instante de verdad). En una
 * estancia hay que ARMARLO: `checkIn` guarda solo el DÍA a las 00:00 UTC y la
 * hora vive aparte en `checkInTime` ("HH:mm" en hora del hotel). Sin hora
 * indicada no hay instante, y no se puede avisar "en 1.5 horas".
 */
export function instanteDeLlegada(res: {
  reservationType: string;
  appointmentAt: Date | null;
  checkIn: Date | null;
  checkInTime: string | null;
}): Date | null {
  if (res.reservationType === "BATH") return res.appointmentAt;
  if (!res.checkIn || !res.checkInTime) return null;
  const [hh, mm] = res.checkInTime.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  // El día se lee con componentes UTC a propósito: es como se guardó.
  return ymdAtLocalMinutes(res.checkIn.toISOString().slice(0, 10), hh * 60 + mm);
}

export type StayTimesInput = {
  reservation: Reservation;
  /** `undefined` = no tocar; `null` = borrar la hora. */
  checkInTime?: string | null;
  checkOutTime?: string | null;
  /** Quién hace el cambio (para no auto-notificarse). */
  actorUserId?: string | null;
  /** true cuando lo cambia admin/staff: entonces se avisa al resto del equipo. */
  notifyTeam: boolean;
};

/** "09:00" → "9:00 am", para el cuerpo del aviso que lee el equipo. */
function hhmmLegible(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function describeCambio(
  checkInTime: string | null | undefined,
  checkOutTime: string | null | undefined
): string {
  const partes: string[] = [];
  if (checkInTime !== undefined) {
    partes.push(checkInTime ? `llega a las ${hhmmLegible(checkInTime)}` : "sin hora de llegada");
  }
  if (checkOutTime !== undefined) {
    partes.push(checkOutTime ? `sale a las ${hhmmLegible(checkOutTime)}` : "sin hora de salida");
  }
  return partes.join(" y ");
}

/**
 * Aplica las horas al grupo completo (las mascotas de una multireserva entran y
 * salen juntas), reprograma el recordatorio del cliente y avisa al equipo.
 *
 * Devuelve la reserva actualizada.
 */
export async function applyReservationTimesUpdate(
  prisma: PrismaClient,
  input: StayTimesInput
): Promise<Reservation | null> {
  const { reservation, checkInTime, checkOutTime, actorUserId, notifyTeam } = input;

  const data = {
    ...(checkInTime !== undefined ? { checkInTime } : {}),
    ...(checkOutTime !== undefined ? { checkOutTime } : {}),
  };

  const scope = reservation.groupId
    ? { groupId: reservation.groupId, ownerId: reservation.ownerId }
    : { id: reservation.id };

  await prisma.reservation.updateMany({ where: scope, data });

  // Los recordatorios que ANUNCIAN la hora deduplican por la existencia de una
  // Notification previa de esta reserva. Sin borrarla, mover la hora deja al
  // cliente con el aviso viejo y sin uno nuevo. Mismo paso que el reagendado de
  // baños y el horario de guardería.
  //
  // ⚠️ Se filtra por `kind` a propósito. Bajo el mismo `type` conviven los
  // marcadores CHECKIN_TIME/CHECKOUT_TIME, que son el "¿a qué hora llegas?" que
  // el cron le manda al cliente cuando FALTA la hora. Borrarlos de paso hacía
  // que fijar la llegada volviera a pedirle la recogida al día siguiente —
  // justo después de que el equipo ya la había resuelto.
  const KINDS_A_REPROGRAMAR = ["REMINDER_90MIN", "DAYCARE_REMINDER"];
  const delGrupo = await prisma.reservation.findMany({
    where: scope,
    select: { id: true },
  });
  if (delGrupo.length > 0) {
    await prisma.notification.deleteMany({
      where: {
        userId: reservation.ownerId,
        type: "RESERVATION_REMINDER",
        AND: [
          {
            OR: delGrupo.map((r) => ({
              data: { path: ["reservationId"], equals: r.id },
            })),
          },
          {
            OR: KINDS_A_REPROGRAMAR.map((kind) => ({
              data: { path: ["kind"], equals: kind },
            })),
          },
        ],
      },
    });
  }

  const updated = await prisma.reservation.findUnique({
    where: { id: reservation.id },
    include: { pet: { select: { name: true } } },
  });

  // Aviso al equipo: es el punto del pedido. Quien cambia la hora en su
  // teléfono no tiene que reenviarle nada a quien va a recibir al perro.
  //
  // Va a TODO el equipo activo, no solo a los admins y al staff asignado como
  // `notifyTeamReservationUpdated`: quien recibe al perro suele no ser el
  // responsable de la estancia (la asignación es accountability, no reparto de
  // turnos) y es justo quien necesita saber a qué hora esperarlo.
  if (notifyTeam && updated) {
    const nombre = updated.pet?.name ?? "El perro";
    const targets = await equipoActivoIds(prisma, actorUserId);
    if (targets.length > 0) {
      await notifyUsers(prisma, targets, {
        type: "GENERAL",
        title: `Horario actualizado: ${nombre}`,
        body: `${nombre} ${describeCambio(checkInTime, checkOutTime)}.`,
        // `RESERVATION_UPDATED` es lo que el móvil escucha para refrescar el
        // caché solo (ver notificationInvalidate.ts).
        data: { reservationId: updated.id, kind: "RESERVATION_UPDATED" },
      });
    }
  }

  return updated;
}
