import { Prisma } from "@holidoginn/db";
import type { PrismaClient, User } from "@holidoginn/db";
import type { CreateReservation } from "@holidoginn/shared";
import { randomUUID } from "crypto";
import { sharedPetIds } from "./petAccess";
import { quoteDelivery } from "./delivery";
import { notifyNewReservation } from "./notifyNewReservation";
import { markQuoteConverted } from "./quotes";
import {
  getLodgingPricing,
  computeDays,
  computeStayPricing,
  sizeFromWeight,
  computeDaycareHours,
} from "./pricing";
import { chainStarts, evaluateStart, localYMD } from "./bathAvailability";
import { loadScheduleCfg, loadBusyIntervals, resolveBathDuration } from "./bathAvailabilityDb";
import { lockRoomsAndVerifyCapacity, RoomTakenError } from "./reservationCreate";
import { splitGroupTotal, splitProportional, type OpResult } from "./reservationAdminOps";

/**
 * Alta MANUAL de una reservación por el EQUIPO (mostrador/teléfono): nace
 * CONFIRMED sin pago, sin cartilla aprobada y sin gate legal, y acepta
 * staffId, internalNotes, anticipo acordado y total manual.
 *
 * Es el cuerpo de `POST /reservations` (routes/reservations.ts) portado a una
 * función para que el admin web la use por `/internal/reservations` con las
 * MISMAS reglas: variante de baño por talla, agenda encadenada por perro,
 * guardería por horas, cuarto por mascota con cupo, desglose persistido
 * (totalDays / lodgingAmount / medicationFee), domicilio cotizado en el
 * servidor, anticipo repartido por fila y aviso al equipo.
 *
 * ⚠️ routes/reservations.ts no se podía tocar al escribir esto, así que el
 * handler original sigue con su copia inline. Cuando se pueda, debe quedar
 * como `createTeamReservation(prisma, {...})` + `reply.status(201).send(
 * teamCreatePayload(rows))`, y borrar el cuerpo duplicado.
 *
 * Diferencia deliberada con el handler: la capacidad de los cuartos se
 * re-verifica DENTRO de la transacción con advisory lock
 * (`lockRoomsAndVerifyCapacity`), igual que el flujo del cliente. El handler
 * solo cuenta antes de escribir.
 *
 * Lo que NO hace, a propósito (igual que la app): recargo de mismo día
 * (`sameDayFee` queda null: el equipo no se lo cobra a un walk-in), descuentos
 * (van en `totalAmountOverride`) ni pago (se registra después con
 * `registerManualPayment`).
 */

export type CreatedReservation = Prisma.ReservationGetPayload<{
  include: { pet: true; room: true };
}>;

export type TeamCreateParams = {
  /** Body YA validado con `CreateReservationSchema`. */
  input: CreateReservation;
  /** Quién captura (se le excluye del aviso de reserva nueva). */
  actorUserId: string | null;
  source?: "APP_ADMIN" | "SITIO_WEB";
};

export type TeamCreateData = {
  reservations: CreatedReservation[];
  groupId: string | null;
  agendaWarnings: string[];
};

/** Respuesta con la forma histórica de `POST /reservations` (compatible con la app). */
export function teamCreatePayload(rows: CreatedReservation[]) {
  return rows.length > 1
    ? {
        ...rows[0],
        groupReservations: rows.map((r) => ({
          id: r.id,
          petId: r.petId,
          petName: r.pet?.name ?? null,
          totalAmount: r.totalAmount,
        })),
      }
    : rows[0];
}

const fail = (
  status: number,
  error: string,
  code?: string,
  extra?: Record<string, unknown>
): OpResult<never> => ({ ok: false, status, error, code, extra });

export async function createTeamReservation(
  prisma: PrismaClient,
  params: TeamCreateParams
): Promise<OpResult<TeamCreateData>> {
  const {
    reservationType,
    checkIn,
    checkOut,
    checkInTime,
    checkOutTime,
    ownerId,
    petId,
    petIds,
    roomId,
    roomIds,
    notes,
    internalNotes,
    legalAccepted,
    appointmentAt,
    deslanado,
    corte,
    bath,
    staffId,
    medicationNotes,
    depositAgreed,
    homeDelivery,
    totalAmountOverride,
    scheduleOverride,
    quoteId,
  } = params.input;

  if (!legalAccepted) {
    return fail(400, "Debes aceptar los términos legales para reservar", "LEGAL_REQUIRED");
  }

  const owner: User | null = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner) return fail(404, "Dueño no encontrado", "OWNER_NOT_FOUND");

  // Lista de mascotas: petIds (multi-perro) o petId único. Se crea UNA
  // reserva por mascota; con más de una comparten groupId.
  const petIdList = Array.from(new Set(petIds?.length ? petIds : petId ? [petId] : []));
  if (petIdList.length === 0) {
    return fail(400, "Selecciona al menos una mascota", "VALIDATION");
  }

  const foundPets = await prisma.pet.findMany({ where: { id: { in: petIdList } } });
  if (foundPets.length !== petIdList.length) {
    return fail(404, "Mascota no encontrada", "PET_NOT_FOUND");
  }
  // Basta con que la mascota sea suya O se la hayan compartido (co-dueño).
  const sharedForBooker = await sharedPetIds(prisma, ownerId);
  if (foundPets.some((p) => p.ownerId !== ownerId && !sharedForBooker.includes(p.id))) {
    return fail(400, "La mascota no pertenece al dueño indicado", "PET_NOT_OWNED");
  }
  const groupPets = petIdList.map((id) => foundPets.find((p) => p.id === id)!);
  const groupId = groupPets.length > 1 ? randomUUID() : null;

  if (staffId) {
    const staffUser = await prisma.user.findUnique({ where: { id: staffId } });
    if (!staffUser || staffUser.role !== "STAFF") {
      return fail(400, "El staff asignado no es válido", "INVALID_STAFF");
    }
  }

  const trimmedMedication = medicationNotes?.trim() || null;

  // Servicio a domicilio: la tarifa SIEMPRE se recalcula server-side desde lat/lng.
  let deliveryFee = 0;
  let deliveryDistanceKm = 0;
  let deliveryAddress: string | null = null;
  if (homeDelivery && Number.isFinite(homeDelivery.lat) && Number.isFinite(homeDelivery.lng)) {
    const quote = await quoteDelivery(
      prisma,
      homeDelivery.lat,
      homeDelivery.lng,
      homeDelivery.trip ?? "PICKUP"
    );
    if (quote.active) {
      deliveryFee = quote.fee;
      deliveryDistanceKm = quote.distanceKm;
      deliveryAddress = homeDelivery.address;
    }
  }
  const deliveryData = deliveryAddress
    ? {
        homeDelivery: true,
        homeDeliveryAddress: deliveryAddress,
        homeDeliveryDistanceKm: deliveryDistanceKm,
        homeDeliveryFee: new Prisma.Decimal(deliveryFee),
        homeDeliveryTrip: homeDelivery?.trip ?? "PICKUP",
      }
    : {};

  // Staff y medicamento aplican a TODAS las filas; el domicilio se registra
  // una sola vez (un viaje por grupo) y el anticipo se REPARTE en proporción
  // a lo que cuesta cada mascota.
  const sharedData = {
    ...(staffId ? { staffId } : {}),
    ...(trimmedMedication ? { medicationNotes: trimmedMedication } : {}),
  };
  const splitDeposit = (rowTotals: number[]): number[] | null =>
    depositAgreed != null && depositAgreed > 0 ? splitProportional(depositAgreed, rowTotals) : null;
  const rowExtraData = (isFirst: boolean, depositShare?: number | null) => ({
    ...sharedData,
    ...(depositShare != null && depositShare > 0
      ? { depositAgreed: new Prisma.Decimal(depositShare) }
      : {}),
    ...(isFirst ? deliveryData : {}),
  });

  const finish = (rows: CreatedReservation[], agendaWarnings: string[] = []) => {
    // Aviso al equipo, fire-and-forget: el helper no lanza.
    void notifyNewReservation(prisma, {
      reservations: rows,
      owner,
      source: params.source ?? "APP_ADMIN",
      createdByUserId: params.actorUserId,
    });
    if (quoteId) {
      void markQuoteConverted(
        prisma,
        quoteId,
        { id: rows[0].id, groupId: rows[0].groupId },
        params.actorUserId
      );
    }
    return { ok: true as const, data: { reservations: rows, groupId, agendaWarnings } };
  };

  // ── BATH: cita puntual; precio desde la variante de cada mascota o total manual.
  if (reservationType === "BATH") {
    if (!appointmentAt || Number.isNaN(appointmentAt.getTime())) {
      return fail(400, "appointmentAt es requerido para una cita de baño", "VALIDATION");
    }
    const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
    if (!bathType) return fail(500, "Servicio de baño no configurado", "SERVICE_MISSING");

    const bathVariants: { id: string; price: number; durationMinutes: number | null }[] = [];
    for (const p of groupPets) {
      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bathType.id,
            petSize: sizeFromWeight(p.weight ?? 0),
            deslanado: deslanado ?? false,
            corte: corte ?? false,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return fail(400, `Variante de baño no disponible para ${p.name}`, "VARIANT_UNAVAILABLE");
      }
      bathVariants.push({
        id: variant.id,
        price: Number(variant.price),
        durationMinutes: variant.durationMinutes,
      });
    }

    // Agenda: cada mascota ocupa su propio bloque; el segundo perro empieza
    // cuando termina el primero.
    const schedule = await loadScheduleCfg(prisma);
    const bathDurations = await Promise.all(
      bathVariants.map(async (v, i) => {
        const { durationMinutes } = await resolveBathDuration(
          prisma,
          { variantId: v.id, petId: groupPets[i].id },
          schedule
        );
        return durationMinutes;
      })
    );
    const bathStarts = chainStarts(appointmentAt, bathDurations, schedule.bufferMinutes);
    const dateYMD = localYMD(appointmentAt);

    const agendaWarnings: string[] = [];
    {
      const busy = await loadBusyIntervals(prisma, dateYMD, schedule);
      for (let i = 0; i < bathStarts.length; i++) {
        const verdict = evaluateStart(bathStarts[i], bathDurations[i], schedule, busy);
        if (!verdict.ok) agendaWarnings.push(`${groupPets[i].name}: ${verdict.message}`);
        busy.push({
          startMs: bathStarts[i].getTime(),
          endMs: bathStarts[i].getTime() + bathDurations[i] * 60_000,
          id: `pending-${i}`,
          label: groupPets[i].name,
        });
      }
    }
    // Sin override, el conflicto bloquea; el equipo puede forzar y queda marcado.
    if (agendaWarnings.length > 0 && !scheduleOverride) {
      return fail(409, agendaWarnings.join(" "), "AGENDA_CONFLICT", { warnings: agendaWarnings });
    }

    const amounts =
      totalAmountOverride != null
        ? splitGroupTotal(totalAmountOverride, groupPets.length)
        : bathVariants.map((v) => v.price);
    const deposits = splitDeposit(amounts.map((a, i) => a + (i === 0 ? deliveryFee : 0)));

    const reservations = await prisma.$transaction(async (tx) => {
      const created: CreatedReservation[] = [];
      for (let i = 0; i < groupPets.length; i++) {
        const isFirst = i === 0;
        const res = await tx.reservation.create({
          data: {
            reservationType: "BATH",
            appointmentAt: bathStarts[i],
            durationMinutes: bathDurations[i],
            ...(agendaWarnings.length > 0
              ? { scheduleOverridden: true, scheduleOverrideReason: agendaWarnings.join(" ") }
              : {}),
            totalAmount: new Prisma.Decimal(amounts[i]).add(isFirst ? deliveryFee : 0),
            notes,
            internalNotes: internalNotes ?? null,
            legalAccepted,
            status: "CONFIRMED",
            groupId,
            ownerId,
            petId: groupPets[i].id,
            ...rowExtraData(isFirst, deposits?.[i]),
          },
          include: { pet: true, room: true },
        });
        // Addon para rastrear la variante contratada (conserva el precio de
        // lista aunque el total sea manual).
        await tx.reservationAddon.create({
          data: {
            reservationId: res.id,
            variantId: bathVariants[i].id,
            unitPrice: new Prisma.Decimal(bathVariants[i].price),
            paidWith: "BOOKING",
          },
        });
        created.push(res);
      }
      return created;
    });
    return finish(reservations, agendaWarnings);
  }

  // ── DAYCARE: día único cobrado por hora; appointmentAt anclado a mediodía UTC.
  if (reservationType === "DAYCARE") {
    if (!appointmentAt || Number.isNaN(appointmentAt.getTime())) {
      return fail(400, "appointmentAt es requerido para una guardería", "VALIDATION");
    }
    const inTime = checkInTime ?? null;
    const outTime = checkOutTime ?? null;
    if (!inTime || !outTime) {
      return fail(400, "checkInTime y checkOutTime son requeridos para una guardería", "VALIDATION");
    }
    const hours = computeDaycareHours(inTime, outTime);
    if (hours <= 0) {
      return fail(400, "La hora de salida debe ser posterior a la de entrada", "VALIDATION");
    }
    const dayAnchor = new Date(
      Date.UTC(appointmentAt.getUTCFullYear(), appointmentAt.getUTCMonth(), appointmentAt.getUTCDate(), 12)
    );

    const pricingConfig = await getLodgingPricing(prisma);
    const amounts =
      totalAmountOverride != null
        ? splitGroupTotal(totalAmountOverride, groupPets.length)
        : groupPets.map(() => hours * pricingConfig.daycareHourPrice);
    const deposits = splitDeposit(amounts.map((a, i) => a + (i === 0 ? deliveryFee : 0)));

    const reservations = await prisma.$transaction(async (tx) => {
      const created: CreatedReservation[] = [];
      for (let i = 0; i < groupPets.length; i++) {
        const isFirst = i === 0;
        const res = await tx.reservation.create({
          data: {
            reservationType: "DAYCARE",
            appointmentAt: dayAnchor,
            checkInTime: inTime,
            checkOutTime: outTime,
            totalAmount: new Prisma.Decimal(amounts[i]).add(isFirst ? deliveryFee : 0),
            notes,
            internalNotes: internalNotes ?? null,
            legalAccepted,
            status: "CONFIRMED",
            groupId,
            ownerId,
            petId: groupPets[i].id,
            ...rowExtraData(isFirst, deposits?.[i]),
          },
          include: { pet: true, room: true },
        });
        created.push(res);
      }
      return created;
    });
    return finish(reservations);
  }

  // ── STAY (default): rango de fechas y cuarto por mascota.
  if (!checkIn || !checkOut) {
    return fail(400, "checkIn y checkOut son requeridos para una estancia", "VALIDATION");
  }
  if (checkOut <= checkIn) {
    return fail(400, "checkOut debe ser posterior a checkIn", "VALIDATION");
  }
  if (roomIds && roomIds.length !== groupPets.length) {
    return fail(
      400,
      "Indica un cuarto por mascota (roomIds debe tener el mismo largo que petIds)",
      "VALIDATION"
    );
  }
  const roomIdByPet = roomIds ?? groupPets.map(() => roomId);
  if (roomIdByPet.some((id) => !id)) {
    return fail(400, "roomId es requerido para una estancia", "VALIDATION");
  }

  const uniqueRoomIds = Array.from(new Set(roomIdByPet as string[]));
  const rooms = await prisma.room.findMany({ where: { id: { in: uniqueRoomIds } } });
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const id of uniqueRoomIds) {
    const room = roomById.get(id);
    if (!room) return fail(404, "Cuarto no encontrado", "ROOM_NOT_FOUND");
    if (!room.isActive) return fail(400, `El cuarto ${room.name} no está activo`, "ROOM_INACTIVE");
  }
  // Cupo por cuarto ANTES de escribir (mensaje claro); se re-verifica con lock
  // dentro de la transacción.
  for (const id of uniqueRoomIds) {
    const room = roomById.get(id)!;
    const delGrupo = roomIdByPet.filter((r) => r === id).length;
    const taken = await prisma.reservation.count({
      where: {
        roomId: id,
        reservationType: "STAY",
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] },
        AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
      },
    });
    if (taken + delGrupo > room.capacity) {
      return fail(
        409,
        `El cuarto ${room.name} no tiene capacidad disponible en esas fechas (${taken}/${room.capacity} ocupado).`,
        "ROOM_AT_CAPACITY"
      );
    }
  }

  // Noches en días-calendario UTC (computeDays), como el resto de las rutas
  // de hospedaje: las fechas van ancladas a 00:00 UTC.
  const totalDays = computeDays(checkIn, checkOut);
  if (totalDays < 1) {
    return fail(400, "La estancia debe ser de al menos una noche", "VALIDATION");
  }
  const pricingConfig = await getLodgingPricing(prisma);

  // Baño como complemento del hospedaje (opcional): variante por mascota.
  let stayBathVariants: { id: string; price: number }[] | null = null;
  if (bath) {
    const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
    if (!bathType) return fail(500, "Servicio de baño no configurado", "SERVICE_MISSING");
    stayBathVariants = [];
    for (const p of groupPets) {
      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bathType.id,
            petSize: sizeFromWeight(p.weight ?? 0),
            deslanado: bath.deslanado,
            corte: bath.corte,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return fail(400, `Variante de baño no disponible para ${p.name}`, "VARIANT_UNAVAILABLE");
      }
      stayBathVariants.push({ id: variant.id, price: Number(variant.price) });
    }
  }

  // Precio por mascota — UNA fórmula (computeStayPricing, shared): hospedaje +
  // recargo de medicamento (porcentaje de Config → Tarifas) + baño. El equipo
  // no cobra recargo de mismo día (sameDay: false → sameDayFee 0).
  const stayByPet = groupPets.map((p, i) =>
    computeStayPricing({
      petWeightKg: p.weight,
      totalDays,
      hasMedication: Boolean(trimmedMedication),
      sameDay: false,
      addonsAmount: stayBathVariants?.[i]?.price ?? 0,
      config: pricingConfig,
    })
  );
  // Monto por fila: total manual repartido, o el cálculo automático.
  const amounts =
    totalAmountOverride != null
      ? splitGroupTotal(totalAmountOverride, groupPets.length)
      : stayByPet.map((stay) => stay.total);
  const deposits = splitDeposit(amounts.map((a, i) => a + (i === 0 ? deliveryFee : 0)));

  let reservations: CreatedReservation[];
  try {
    reservations = await prisma.$transaction(async (tx) => {
      await lockRoomsAndVerifyCapacity(
        tx,
        roomIdByPet.map((id) => ({ roomId: id ?? null })),
        checkIn,
        checkOut
      );
      const created: CreatedReservation[] = [];
      for (let i = 0; i < groupPets.length; i++) {
        const isFirst = i === 0;
        const res = await tx.reservation.create({
          data: {
            checkIn,
            checkOut,
            checkInTime: checkInTime ?? null,
            checkOutTime: checkOutTime ?? null,
            totalDays,
            totalAmount: new Prisma.Decimal(amounts[i]).add(isFirst ? deliveryFee : 0),
            // Desglose del cobro original (solo con cálculo automático).
            // Desglose desde el MISMO objeto que fijó el precio.
            ...(totalAmountOverride == null
              ? {
                  lodgingAmount: new Prisma.Decimal(stayByPet[i].lodging),
                  ...(stayByPet[i].medicationFee > 0
                    ? { medicationFee: new Prisma.Decimal(stayByPet[i].medicationFee) }
                    : {}),
                  ...(stayByPet[i].sameDayFee > 0
                    ? { sameDayFee: new Prisma.Decimal(stayByPet[i].sameDayFee) }
                    : {}),
                }
              : {}),
            notes,
            internalNotes: internalNotes ?? null,
            legalAccepted,
            status: "CONFIRMED",
            groupId,
            ownerId,
            petId: groupPets[i].id,
            roomId: roomIdByPet[i],
            ...rowExtraData(isFirst, deposits?.[i]),
          },
          include: { pet: true, room: true },
        });
        if (stayBathVariants) {
          await tx.reservationAddon.create({
            data: {
              reservationId: res.id,
              variantId: stayBathVariants[i].id,
              unitPrice: new Prisma.Decimal(stayBathVariants[i].price),
              paidWith: "BOOKING",
            },
          });
        }
        created.push(res);
      }
      return created;
    });
  } catch (err) {
    if (err instanceof RoomTakenError) {
      return fail(
        409,
        `El cuarto ${err.roomName} ya fue ocupado por otra reserva en esas fechas. Vuelve a intentar.`,
        "ROOM_TAKEN"
      );
    }
    throw err;
  }
  return finish(reservations);
}
