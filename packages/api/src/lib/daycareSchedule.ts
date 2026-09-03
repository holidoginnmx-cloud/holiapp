import { Prisma } from "@holidoginn/db";
import type { PrismaClient, ReservationStatus } from "@holidoginn/db";
import type { z } from "zod";
import type { UpdateDaycareScheduleSchema } from "@holidoginn/shared";
import { notifyPetAudience, notifyTeamReservationUpdated } from "./notify";
import { TZ_OFFSET_HOURS } from "./bathAvailability";
import { daycareDayAnchor, countDaycareOccupancy } from "./daycareCreate";
import {
  getLodgingPricing,
  computeDaycareHours,
  isWithinDaycareHours,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
} from "./pricing";
import { opFail as fail, opOk as ok, type OpResult } from "./reservationAdminOps";

/**
 * Mover el día y/o el horario de una guardería YA creada.
 *
 * Extraída de `PATCH /staff/daycares/:id/schedule` (routes/daycare.ts) para que
 * la compartan la app del equipo y `PATCH /internal/reservations/:id/
 * daycare-schedule` (admin web). Antes el panel escribía `appointmentAt`
 * directo en Supabase: movía el día sin revalidar el cupo, sin recalcular el
 * precio por la diferencia de horas, sin arrastrar al resto del grupo y sin
 * borrar el recordatorio de 24 h ya enviado (que seguía anunciando el día viejo).
 *
 * En guardería las horas SON el precio (horas × tarifa), así que esto no es el
 * `/reservations/:id/times` del dueño: ajusta el total por la DIFERENCIA de
 * horas, como el cambio de fechas de una estancia.
 *
 * A propósito NO usa `validateDaycareWindow`: esa es la ventana del flujo del
 * cliente. El equipo captura lo que pasa en la vida real ("me lo recogen hasta
 * las 7"), igual que al crear desde la app; el horario fuera de 9-18 sale como
 * aviso (`warning`), no como error.
 */

/** "YYYY-MM-DD" de hoy en hora local del hotel (Hermosillo, UTC-7 fijo). */
export function todayYMDLocal(): string {
  const local = new Date(Date.now() - TZ_OFFSET_HOURS * 3600 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

/**
 * "YYYY-MM-DD" del día de una guardería. El `appointmentAt` se ancla a MEDIODÍA
 * UTC (convención de daycareDayAnchor), así que el día se lee en UTC — leerlo
 * en local correría la fecha un día.
 */
export function ymdFromDayAnchor(anchor: Date): string {
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
}

/**
 * El contrato ya vive en `UpdateDaycareScheduleSchema`; shared no exporta el
 * tipo inferido, así que se infiere aquí en vez de mantener una copia a mano.
 */
export type DaycareScheduleInput = z.infer<typeof UpdateDaycareScheduleSchema>;

export type DaycareScheduleResult = {
  success: true;
  hours: number;
  previousHours: number | null;
  newTotal: number;
  previousTotal: number;
  delta: number;
  balance: number;
  overpaid: number;
  warning: string | null;
};

export async function applyDaycareScheduleUpdate(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    input: DaycareScheduleInput;
    actorUserId: string | null;
  }
): Promise<OpResult<DaycareScheduleResult>> {
  const { date, checkInTime, checkOutTime, updateTotal, force } = params.input;

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: {
      pet: { select: { name: true } },
      payments: {
        where: { status: { in: ["PAID", "PARTIAL"] } },
        select: { amount: true },
      },
    },
  });
  if (!reservation || reservation.reservationType !== "DAYCARE") {
    return fail(404, "Guardería no encontrada", "NOT_FOUND");
  }
  // Una guardería concluida ya cobró sus horas extra al recoger: moverle el
  // horario después descuadraría ese cobro.
  if (reservation.status !== "CONFIRMED" && reservation.status !== "CHECKED_IN") {
    return fail(
      400,
      reservation.status === "CANCELLED" ? "La guardería está cancelada" : "La guardería ya concluyó",
      reservation.status === "CANCELLED" ? "CANCELLED" : "NOT_ACTIVE"
    );
  }

  const newHours = computeDaycareHours(checkInTime, checkOutTime);
  if (newHours <= 0) {
    return fail(400, "La hora de salida debe ser posterior a la de entrada", "VALIDATION");
  }

  const oldYMD = reservation.appointmentAt ? ymdFromDayAnchor(reservation.appointmentAt) : null;
  const newYMD = date ?? oldYMD;
  if (!newYMD) return fail(400, "La guardería no tiene día", "NO_DAY");
  const newAnchor = daycareDayAnchor(newYMD);
  if (!newAnchor) return fail(400, "Fecha inválida (YYYY-MM-DD)", "VALIDATION");
  const dayChanged = newYMD !== oldYMD;

  // Mover a un día que ya pasó solo con "Registrar de todos modos" (mismo gate
  // que al crear). Si el día NO cambia no aplica: una guardería retroactiva se
  // sigue pudiendo corregir de horas.
  if (dayChanged && newYMD < todayYMDLocal() && !force) {
    return fail(400, "Ese día ya pasó", "DATE_IN_PAST");
  }

  // Todas las mascotas del grupo se mueven juntas (entran y salen juntas).
  const groupWhere = reservation.groupId
    ? {
        groupId: reservation.groupId,
        reservationType: "DAYCARE" as const,
        status: { in: ["CONFIRMED", "CHECKED_IN"] as ReservationStatus[] },
      }
    : { id: reservation.id };

  const pricing = await getLodgingPricing(prisma);
  // Sin horas previas (guardería vieja o capturada a medias) no hay diferencia
  // que cobrar: se corrige el horario sin tocar el dinero.
  const previousHours =
    reservation.checkInTime && reservation.checkOutTime
      ? computeDaycareHours(reservation.checkInTime, reservation.checkOutTime)
      : null;
  const delta =
    updateTotal && previousHours != null && previousHours > 0
      ? (newHours - previousHours) * pricing.daycareHourPrice
      : 0;

  const previousTotal = Number(reservation.totalAmount);
  const outcome = await prisma.$transaction(async (tx) => {
    const rows = await tx.reservation.findMany({
      where: groupWhere,
      select: { id: true, totalAmount: true },
    });

    if (dayChanged) {
      // Mismo lock por día del cupo (namespace 43) que la creación. Se toman el
      // día viejo y el nuevo en orden fijo para que dos cambios cruzados no se
      // deadlockeen.
      const days = [...new Set([oldYMD, newYMD].filter(Boolean))].sort();
      for (const ymd of days) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(43, hashtext(${ymd}))`;
      }
      // El grupo entero sale del día viejo, así que ninguna de sus filas está
      // contada en el día nuevo: no hace falta excluirlas.
      const { occupied, maxCapacity } = await countDaycareOccupancy(tx, newYMD);
      if (occupied + rows.length > maxCapacity && !force) {
        return { ok: false as const, occupied, maxCapacity };
      }
    }

    for (const row of rows) {
      await tx.reservation.update({
        where: { id: row.id },
        data: {
          appointmentAt: newAnchor,
          checkInTime,
          checkOutTime,
          ...(delta !== 0
            ? { totalAmount: new Prisma.Decimal(Math.max(0, Number(row.totalAmount) + delta)) }
            : {}),
        },
      });

      // El recordatorio de 24 h deduplica por la existencia de una Notification
      // previa de esta reserva: sin borrarla, una guardería movida después del
      // recordatorio nunca anunciaría el día u hora nuevos (ver
      // /internal/bath-reminders).
      if (dayChanged || checkInTime !== reservation.checkInTime) {
        await tx.notification.deleteMany({
          where: {
            userId: reservation.ownerId,
            type: "RESERVATION_REMINDER",
            data: { path: ["reservationId"], equals: row.id },
          },
        });
      }
    }

    return { ok: true as const };
  });

  if (!outcome.ok) {
    return fail(
      409,
      `No hay cupo de guardería ese día (${outcome.occupied}/${outcome.maxCapacity} ocupado).`,
      "DAYCARE_FULL",
      { occupied: outcome.occupied, maxCapacity: outcome.maxCapacity }
    );
  }

  const newTotal = delta !== 0 ? Math.max(0, previousTotal + delta) : previousTotal;
  const totalPaid = reservation.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = Math.max(0, Number((newTotal - totalPaid).toFixed(2)));
  const overpaid = Math.max(0, Number((totalPaid - newTotal).toFixed(2)));

  const dayLabel = newAnchor.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const horario = `${checkInTime} a ${checkOutTime}`;

  await notifyPetAudience(
    prisma,
    { petId: reservation.petId, ownerId: reservation.ownerId },
    {
      type: "GENERAL",
      title: "Horario de guardería actualizado 🕘",
      body:
        `${reservation.pet.name}: ${dayLabel}, de ${horario}.` +
        (delta !== 0 ? ` Nuevo total: $${newTotal.toLocaleString("es-MX")}.` : ""),
      data: { reservationId: reservation.id, kind: "DAYCARE_RESCHEDULED" },
    }
  );
  await notifyTeamReservationUpdated(prisma, {
    reservationId: reservation.id,
    petName: reservation.pet.name,
    body:
      `Guardería del ${dayLabel}, de ${horario}.` +
      (delta !== 0 ? ` Total: $${newTotal.toLocaleString("es-MX")}.` : ""),
    actorUserId: params.actorUserId,
    assignedStaffId: reservation.staffId,
  });

  const outOfWindow = !isWithinDaycareHours(checkInTime) || !isWithinDaycareHours(checkOutTime);

  return ok({
    success: true as const,
    hours: newHours,
    previousHours,
    newTotal,
    previousTotal,
    delta: Number(delta.toFixed(2)),
    balance,
    overpaid,
    warning: outOfWindow
      ? `El horario queda fuera de ${DAYCARE_OPEN_HOUR}:00 a ${DAYCARE_CLOSE_HOUR}:00.`
      : null,
  });
}
