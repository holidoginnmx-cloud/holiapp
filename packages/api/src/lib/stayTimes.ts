import type { PrismaClient, Reservation } from "@holidoginn/db";
import { equipoActivoIds, notifyUsers } from "./notify";
import { localYMD, ymdAtLocalMinutes } from "./bathAvailability";

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

/**
 * "Mañana" para el recordatorio de hora de llegada/recogida: el día calendario
 * siguiente en HERMOSILLO, como rango [00:00Z de mañana, 00:00Z de pasado].
 *
 * Antes era una ventana de horas (ahora+6 h … ahora+36 h) que suponía fechas a
 * medianoche local. Guardadas a 00:00Z, esa ventana de 30 h abarcaba dos días
 * y, con el cron de GitHub corriendo tarde, se quedaba con el de PASADO
 * mañana: el cliente recibía "mañana es su check-out" dos días antes. El rango
 * por día no depende de a qué hora corra el cron y cubre también las filas
 * viejas ancladas a 07:00Z o 19:00Z (caen en el mismo día UTC).
 */
export function rangoDeMananaHotel(now: Date = new Date()): { start: Date; end: Date } {
  const [y, m, d] = localYMD(now).split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, d + 1)),
    end: new Date(Date.UTC(y, m - 1, d + 2)),
  };
}

export type StayTimesInput = {
  reservation: Reservation;
  /** `undefined` = no tocar; `null` = borrar la hora. */
  checkInTime?: string | null;
  checkOutTime?: string | null;
  /** Quién hace el cambio (para no auto-notificarse). */
  actorUserId?: string | null;
  /** Si se avisa al resto del equipo (hoy: siempre que la hora la fije una persona). */
  notifyTeam: boolean;
  /**
   * true cuando la hora la fija el CLIENTE desde su app. Cambia el texto del
   * aviso: el equipo necesita saber que es la hora que el cliente programó (y
   * de quién), no un ajuste de un compañero.
   */
  byClient?: boolean;
};

/** "2026-11-07T00:00:00Z" → "vie 7 nov" (el día se guarda a 00:00 UTC). */
function diaCorto(d: Date | null | undefined): string | null {
  if (!d) return null;
  // Por partes y no `format()`: según la versión de ICU sale "9 de nov".
  const parts = new Intl.DateTimeFormat("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(d);
  const get = (t: string) =>
    (parts.find((p) => p.type === t)?.value ?? "").replace(/\./g, "");
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/**
 * Texto del aviso al equipo cuando cambia el horario. Puro para poder probarlo.
 *
 * Con el día pegado a cada hora: "llega a las 4:00 pm" sin fecha obliga a abrir
 * la reserva para saber si es hoy o la semana que entra.
 */
export function buildStayTimesMessage(params: {
  petName: string | null | undefined;
  ownerName?: string | null;
  checkIn?: Date | null;
  checkOut?: Date | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  byClient: boolean;
}): { title: string; body: string } {
  const nombre = params.petName ?? "El perro";
  const partes: string[] = [];
  if (params.checkInTime !== undefined) {
    const dia = diaCorto(params.checkIn);
    partes.push(
      params.checkInTime
        ? `llega${dia ? ` el ${dia}` : ""} a las ${hhmmLegible(params.checkInTime)}`
        : "sin hora de llegada"
    );
  }
  if (params.checkOutTime !== undefined) {
    const dia = diaCorto(params.checkOut);
    partes.push(
      params.checkOutTime
        ? `sale${dia ? ` el ${dia}` : ""} a las ${hhmmLegible(params.checkOutTime)}`
        : "sin hora de salida"
    );
  }
  const cambio = partes.join(" y ");
  if (params.byClient) {
    const quien = params.ownerName?.trim() || "El cliente";
    return {
      title: `🕒 Horario programado: ${nombre}`,
      body: `${quien} programó en la app: ${nombre} ${cambio}.`,
    };
  }
  return {
    title: `Horario actualizado: ${nombre}`,
    body: `${nombre} ${cambio}.`,
  };
}

/** "09:00" → "9:00 am", para el cuerpo del aviso que lee el equipo. */
export function hhmmLegible(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
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
  const { reservation, checkInTime, checkOutTime, actorUserId, notifyTeam, byClient } =
    input;

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
  // STAY_CHECKIN_REMINDER: el aviso del día anterior anuncia la hora de
  // llegada (lib/clientReminders.ts); si cambia, se vuelve a mandar.
  const KINDS_A_REPROGRAMAR = [
    "REMINDER_90MIN",
    "DAYCARE_REMINDER",
    "STAY_CHECKIN_REMINDER",
  ];
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
    include: {
      pet: { select: { name: true } },
      owner: { select: { firstName: true, lastName: true } },
    },
  });

  // Aviso al equipo: es el punto del pedido. Quien cambia la hora en su
  // teléfono no tiene que reenviarle nada a quien va a recibir al perro.
  //
  // Va a TODO el equipo activo, no solo a los admins y al staff asignado como
  // `notifyTeamReservationUpdated`: quien recibe al perro suele no ser el
  // responsable de la estancia (la asignación es accountability, no reparto de
  // turnos) y es justo quien necesita saber a qué hora esperarlo.
  if (notifyTeam && updated) {
    const msg = buildStayTimesMessage({
      petName: updated.pet?.name,
      ownerName: [updated.owner?.firstName, updated.owner?.lastName]
        .filter(Boolean)
        .join(" "),
      checkIn: updated.checkIn,
      checkOut: updated.checkOut,
      checkInTime,
      checkOutTime,
      byClient: byClient ?? false,
    });
    // Se excluye a quien hizo el cambio; si fue el cliente no es del equipo y
    // la exclusión no quita a nadie.
    const targets = await equipoActivoIds(prisma, actorUserId);
    if (targets.length > 0) {
      await notifyUsers(prisma, targets, {
        type: "GENERAL",
        title: msg.title,
        body: msg.body,
        // `RESERVATION_UPDATED` es lo que el móvil escucha para refrescar el
        // caché solo (ver notificationInvalidate.ts).
        data: { reservationId: updated.id, kind: "RESERVATION_UPDATED" },
      });
    }
  }

  return updated;
}
