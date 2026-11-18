import { Prisma } from "@holidoginn/db";
import type { PrismaClient, RecurringBooking } from "@holidoginn/db";
import {
  addDaysYMD,
  hotelTodayYMD,
  occurrencesBetween,
  shortDateLabelES,
  type CreateReservation,
} from "@holidoginn/shared";
import { createTeamReservation } from "./reservationTeamCreate";
import { daycareDayAnchor } from "./daycareCreate";
import { localMinutesOfDay, ymdAtLocalMinutes } from "./bathAvailability";
import { adminsActivosIds, notifyUsers } from "./notify";
import { findPetStayOnDay, type PetStayOnDay } from "./petStayOnDay";

// ─────────────────────────────────────────────────────────────────────────────
//  Citas recurrentes — generador
//
//  Pedido de Jessica (2026-11-14): Polly, Luna y Bongo (Gurrola) se bañan un
//  viernes sí y uno no, y el equipo va por ellos. Es un hecho pactado, pero
//  había que capturarlo a mano cada vez (y a veces se capturaba DESPUÉS de
//  hacerlo, o nunca). Una serie (`recurring_bookings`) describe la regla y
//  este generador crea cada cita `leadDays` antes, con `createTeamReservation`
//  — exactamente como si el equipo la capturara: mismo precio por talla,
//  mismos perros encadenados en la agenda, mismo push al cliente.
//
//  Reglas:
//   · Idempotente. Cada cita lleva (recurringBookingId, recurrenceDate) y hay
//     un único (serie, fecha, mascota): si el generador corre dos veces, la
//     segunda ve que la fecha ya existe y no hace nada. Si el equipo MUEVE la
//     cita a otro día o la CANCELA, `recurrenceDate` sigue apuntando a la
//     fecha original y tampoco se vuelve a crear.
//   · Es un hecho pactado: si la cita se encima con otra o cae en día cerrado
//     se crea IGUAL (marcada como "agendada de todos modos") y se avisa a los
//     ADMIN para que la acomoden. Bloquearla haría que el perro se quedara sin
//     cita sin que nadie se enterara.
//   · Un error de negocio (variante de baño desactivada, etc.) se avisa a los
//     ADMIN y la fecha se da por revisada: reintentarlo cada 10 min solo
//     mandaría el mismo aviso cada 10 min. Una excepción inesperada (BD caída)
//     NO avanza la serie: se reintenta en la siguiente vuelta.
//   · `generatedThrough` = último día ya revisado; ahorra consultas en el
//     ciclo de cada 10 min. Editar, reanudar o des-saltar una fecha lo BORRA
//     (routes/recurringBookings.ts) para que la ventana se revise de nuevo:
//     las fechas que ya tienen cita se respetan (existe la fila) y las que
//     faltan se crean. Las citas ya creadas nunca se tocan.
// ─────────────────────────────────────────────────────────────────────────────

export type GenerateResult = {
  /** Visitas creadas (un grupo multi-perro cuenta como una). */
  sent: number;
  created: { seriesId: string; date: string; reservationIds: string[] }[];
  failed: { seriesId: string; date: string; error: string }[];
};

/** Ventana del ciclo automático: 9:00–20:00 hora del hotel. */
export function isRecurringGenerationHour(now: Date): boolean {
  const m = localMinutesOfDay(now);
  return m >= 9 * 60 && m < 20 * 60;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Hora (HH:mm) de la serie que, si ya pasó HOY, hace que no tenga caso crearla. */
function seriesStartTime(s: RecurringBooking): string | null {
  return s.reservationType === "BATH" ? s.startTime : s.checkInTime;
}

/** Arma el body de `createTeamReservation` para una fecha de la serie. */
export function buildOccurrenceInput(
  s: RecurringBooking,
  date: string,
  petIds: string[]
): CreateReservation | null {
  const base = {
    notes: null,
    internalNotes: s.internalNotes ?? null,
    legalAccepted: true,
    ownerId: s.ownerId,
    petIds,
    ...(s.staffId ? { staffId: s.staffId } : {}),
    ...(s.totalAmountOverride != null
      ? { totalAmountOverride: Number(s.totalAmountOverride) }
      : {}),
    ...(s.homeDelivery &&
    s.homeDeliveryAddress &&
    s.homeDeliveryLat != null &&
    s.homeDeliveryLng != null
      ? {
          homeDelivery: {
            address: s.homeDeliveryAddress,
            lat: s.homeDeliveryLat,
            lng: s.homeDeliveryLng,
            ...(s.homeDeliveryPlaceId ? { placeId: s.homeDeliveryPlaceId } : {}),
            trip: s.homeDeliveryTrip,
          },
        }
      : {}),
  };

  if (s.reservationType === "BATH") {
    if (!s.startTime) return null;
    return {
      ...base,
      reservationType: "BATH",
      appointmentAt: ymdAtLocalMinutes(date, hhmmToMinutes(s.startTime)),
      deslanado: s.deslanado,
      corte: s.corte,
      // Pactado: se guarda aunque se encime (queda marcado en la agenda).
      scheduleOverride: true,
    };
  }
  if (s.reservationType === "DAYCARE") {
    const anchor = daycareDayAnchor(date);
    if (!anchor || !s.checkInTime || !s.checkOutTime) return null;
    return {
      ...base,
      reservationType: "DAYCARE",
      appointmentAt: anchor,
      checkInTime: s.checkInTime,
      checkOutTime: s.checkOutTime,
    };
  }
  return null;
}

async function avisarAdmins(
  prisma: PrismaClient,
  title: string,
  body: string,
  data: Record<string, string | null>
): Promise<void> {
  try {
    const ids = await adminsActivosIds(prisma);
    await notifyUsers(prisma, ids, {
      type: "GENERAL",
      title,
      body,
      data: { kind: "RECURRING_BOOKING", ...data },
    });
  } catch (err) {
    console.error("[recurrentes] no se pudo avisar a los admin:", err);
  }
}

async function deliveryServiceActive(prisma: PrismaClient): Promise<boolean> {
  const cfg = await prisma.deliveryConfig.findUnique({
    where: { id: "singleton" },
    select: { isActive: true },
  });
  return cfg?.isActive ?? false;
}

function ownerLabel(o: { firstName: string; lastName: string } | null): string {
  if (!o) return "un cliente";
  const last = o.lastName && o.lastName !== "—" ? ` ${o.lastName}` : "";
  return `${o.firstName}${last}`.trim();
}

/**
 * Crea las citas que ya entraron en la ventana de cada serie activa.
 * Con `seriesId`, solo esa serie (al darla de alta o editarla).
 */
export async function generateRecurringOccurrences(
  prisma: PrismaClient,
  now: Date = new Date(),
  opts: { seriesId?: string } = {}
): Promise<GenerateResult> {
  const result: GenerateResult = { sent: 0, created: [], failed: [] };
  const today = hotelTodayYMD(now);
  const nowMinutes = localMinutesOfDay(now);

  const series = await prisma.recurringBooking.findMany({
    where: {
      active: true,
      deletedAt: null,
      ...(opts.seriesId ? { id: opts.seriesId } : {}),
    },
    include: { owner: { select: { firstName: true, lastName: true } } },
  });

  for (const s of series) {
    const horizon = addDaysYMD(today, s.leadDays);
    // Nada hacia atrás: si la serie estuvo en pausa, las fechas que pasaron
    // mientras tanto ya no se crean.
    const from =
      s.generatedThrough && s.generatedThrough >= today
        ? addDaysYMD(s.generatedThrough, 1)
        : today;
    if (from > horizon) continue;

    const dates = occurrencesBetween(
      {
        intervalWeeks: s.intervalWeeks,
        weekdays: s.weekdays,
        anchorDate: s.anchorDate,
        endDate: s.endDate,
        skipDates: s.skipDates,
      },
      from,
      horizon
    );

    let reviewedThrough = horizon;
    for (const date of dates) {
      // Hoy, pero la hora ya pasó (p. ej. la serie se dio de alta en la tarde
      // para una cita de la mañana): no tiene caso crearla.
      const startTime = seriesStartTime(s);
      if (date === today && startTime && hhmmToMinutes(startTime) <= nowMinutes) continue;

      try {
        const already = await prisma.reservation.findFirst({
          where: { recurringBookingId: s.id, recurrenceDate: date },
          select: { id: true },
        });
        if (already) continue;

        // Solo los perros que siguen activos, en el orden de la serie (es el
        // orden en que se encadenan en la agenda).
        const pets = await prisma.pet.findMany({
          where: { id: { in: s.petIds }, isActive: true },
          select: { id: true },
        });
        const activos = new Set(pets.map((p) => p.id));
        const petIds = s.petIds.filter((id) => activos.has(id));
        if (petIds.length === 0) {
          await prisma.recurringBooking.update({
            where: { id: s.id },
            data: { active: false, pausedReason: "Ninguna de sus mascotas sigue activa" },
          });
          await avisarAdmins(
            prisma,
            "🔁 Cita recurrente en pausa",
            `La serie de ${ownerLabel(s.owner)} se pausó: ninguna de sus mascotas sigue activa.`,
            { recurringBookingId: s.id }
          );
          // Esta fecha NO se da por revisada: al reanudar se vuelve a intentar.
          reviewedThrough = addDaysYMD(date, -1);
          break;
        }

        // Un perro se dio de baja: se quita de la serie UNA vez y se avisa (si
        // no, cada visita lo omitiría en silencio).
        if (petIds.length < s.petIds.length) {
          const fuera = s.petIds.filter((id) => !activos.has(id));
          await prisma.recurringBooking.update({ where: { id: s.id }, data: { petIds } });
          s.petIds = petIds;
          await avisarAdmins(
            prisma,
            "🔁 Cita recurrente sin una mascota",
            `${ownerLabel(s.owner)}: ${fuera.length === 1 ? "una mascota se dio" : `${fuera.length} mascotas se dieron`} de baja y ya no se agenda${fuera.length === 1 ? "" : "n"} en su cita recurrente.`,
            { recurringBookingId: s.id }
          );
        }

        // Perro hospedado ese día: ya está en el hotel y su baño va DENTRO de
        // la estancia (regla de 87b5198, el caso de Koa). Una cita aparte sería
        // cobrarle doble al cliente. Se quita de ESTA fecha y se avisa; si
        // todos están hospedados, la fecha no se crea.
        const hospedados: PetStayOnDay[] = [];
        for (const petId of petIds) {
          const stay = await findPetStayOnDay(prisma, petId, date);
          if (stay) hospedados.push(stay);
        }
        if (hospedados.length > 0) {
          const servicio = s.reservationType === "DAYCARE" ? "guardería" : "baño";
          const nombres = hospedados.map((h) => h.petName || "Una mascota").join(", ");
          const verbo = hospedados.length === 1 ? "está hospedado" : "están hospedados";
          const todos = hospedados.length === petIds.length;
          await avisarAdmins(
            prisma,
            "🔁 Cita recurrente: perro hospedado",
            todos
              ? `${ownerLabel(s.owner)} · ${shortDateLabelES(date)}: ${nombres} ${verbo} ese día, así que no se agendó su ${servicio} recurrente. Si toca, agrégalo a su estancia.`
              : `${ownerLabel(s.owner)} · ${shortDateLabelES(date)}: ${nombres} ${verbo} ese día y no entra${hospedados.length === 1 ? "" : "n"} en la cita recurrente; los demás sí se agendaron${s.totalAmountOverride != null ? " con su precio normal" : ""}. Si toca, agrégalo a su estancia.`,
            { reservationId: hospedados[0].reservationId, recurringBookingId: s.id }
          );
          if (todos) continue;
        }
        const fueraPorEstancia = new Set(hospedados.map((h) => h.petId));
        const petIdsFecha = petIds.filter((id) => !fueraPorEstancia.has(id));

        // El staff asignado pudo darse de baja desde que se armó la serie: la
        // cita se crea igual, sin asignar, en vez de tronar.
        let staffOk = true;
        if (s.staffId) {
          const staff = await prisma.user.findUnique({
            where: { id: s.staffId },
            select: { role: true, isActive: true },
          });
          staffOk = !!staff && staff.role === "STAFF" && staff.isActive;
        }
        const input = buildOccurrenceInput(
          staffOk ? s : { ...s, staffId: null },
          date,
          petIdsFecha
        );
        if (!input) {
          result.failed.push({ seriesId: s.id, date, error: "Serie incompleta" });
          continue;
        }
        // El precio pactado cubre a TODOS los perros de la serie: con uno
        // hospedado fuera, se cobra cada uno a su precio normal.
        if (hospedados.length > 0) input.totalAmountOverride = undefined;

        // Domicilio cobrado pero el servicio está apagado en Config: sin esto
        // el viaje desaparecería de la cita y nadie iría por el perro. Se
        // registra sin costo y se avisa.
        let courtesy = !s.chargeDelivery;
        if (input.homeDelivery && s.chargeDelivery && !(await deliveryServiceActive(prisma))) {
          courtesy = true;
          await avisarAdmins(
            prisma,
            "🔁 Domicilio sin cobrar",
            `${ownerLabel(s.owner)} · ${shortDateLabelES(date)}: el servicio a domicilio está apagado en Ajustes, así que el viaje quedó registrado sin costo.`,
            { recurringBookingId: s.id }
          );
        }

        const res = await createTeamReservation(prisma, {
          input,
          // Nadie la capturó: el aviso de reserva nueva le llega a TODO el equipo.
          actorUserId: null,
          source: "RECURRING",
          deliveryCourtesy: courtesy,
          recurrence: { id: s.id, date },
        });

        if (!res.ok) {
          result.failed.push({ seriesId: s.id, date, error: res.error });
          console.error("[recurrentes] no se pudo crear", { seriesId: s.id, date, error: res.error });
          await avisarAdmins(
            prisma,
            "⚠️ No se pudo agendar una cita recurrente",
            `${ownerLabel(s.owner)} · ${shortDateLabelES(date)}: ${res.error}. Agéndala a mano.`,
            { recurringBookingId: s.id }
          );
          continue;
        }

        const rows = res.data.reservations;
        result.sent += 1;
        result.created.push({ seriesId: s.id, date, reservationIds: rows.map((r) => r.id) });
        console.info("[recurrentes] cita creada", {
          seriesId: s.id,
          date,
          reservations: rows.length,
          warnings: res.data.agendaWarnings.length,
        });

        if (res.data.agendaWarnings.length > 0) {
          await avisarAdmins(
            prisma,
            "🔁 Revisa una cita recurrente",
            `${ownerLabel(s.owner)} · ${shortDateLabelES(date)}: ${res.data.agendaWarnings.join(" ")} Se agendó de todos modos; muévela si hace falta.`,
            { reservationId: rows[0]?.id ?? null, recurringBookingId: s.id }
          );
        }
      } catch (err) {
        // Dos corridas a la vez: la otra ya la creó. Es justo lo que el
        // único (serie, fecha, mascota) está para atrapar.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        console.error("[recurrentes] error inesperado; se reintenta en la siguiente vuelta", {
          seriesId: s.id,
          date,
          err,
        });
        result.failed.push({ seriesId: s.id, date, error: "Error inesperado" });
        reviewedThrough = addDaysYMD(date, -1);
        break;
      }
    }

    if (!s.generatedThrough || reviewedThrough > s.generatedThrough) {
      await prisma.recurringBooking.update({
        where: { id: s.id },
        data: { generatedThrough: reviewedThrough },
      });
    }
  }

  return result;
}
