import { Prisma, PetSize } from "@holidoginn/db";
import type { PrismaClient, Pet, User } from "@prisma/client";
import { randomUUID } from "crypto";
import { notifyBathContracted } from "../routes/services";
import { reservationConfirmedTemplate, sendEmail } from "./email";
import { notifyUser } from "./notify";
import {
  notifyNewReservation,
  type NewReservationSource,
} from "./notifyNewReservation";
import { getLodgingPricing, pricePerDayForWeight, sizeFromWeight } from "./pricing";
import { hoursUntilHotelDay } from "@holidoginn/shared";
import { quoteDelivery, type DeliveryTripMode } from "./delivery";
import { invalidateAuthCache } from "../middleware/auth";

type ReservationStatusType = import("@holidoginn/db").ReservationStatus;

/** Namespace del advisory lock de cupo de HOSPEDAJE (42 = baños, 43 = guardería). */
export const ROOM_LOCK_NAMESPACE = 44;

/**
 * El cuarto elegido antes de la transacción ya no tiene lugar al momento de
 * escribir. El handler lo convierte en 409.
 */
export class RoomTakenError extends Error {
  constructor(public readonly roomName: string) {
    super(`ROOM_TAKEN:${roomName}`);
    this.name = "RoomTakenError";
  }
}

/**
 * Serializa y re-verifica la capacidad de los cuartos DENTRO de la
 * transacción que crea las reservas. La búsqueda del cuarto ocurre antes y
 * sin lock (count-then-create): dos confirmaciones simultáneas veían el mismo
 * lugar libre y ambas lo tomaban. Igual que la agenda de baños (42) y el cupo
 * de guardería (43), pero por cuarto. Los ids se bloquean ORDENADOS para que
 * dos transacciones con cuartos en común no se traben entre sí.
 *
 * `assignments` son los cuartos que ESTA operación va a ocupar (uno por
 * mascota; repetidos si comparten cuarto).
 */
export async function lockRoomsAndVerifyCapacity(
  tx: Prisma.TransactionClient,
  assignments: Array<{ roomId: string | null }>,
  checkIn: Date,
  checkOut: Date
): Promise<void> {
  const adding = new Map<string, number>();
  for (const a of assignments) {
    if (!a.roomId) continue;
    adding.set(a.roomId, (adding.get(a.roomId) ?? 0) + 1);
  }
  const roomIds = Array.from(adding.keys()).sort();
  for (const roomId of roomIds) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROOM_LOCK_NAMESPACE}, hashtext(${roomId}))`;
  }
  for (const roomId of roomIds) {
    const room = await tx.room.findUnique({
      where: { id: roomId },
      select: { name: true, capacity: true },
    });
    const taken = await tx.reservation.count({
      where: {
        roomId,
        reservationType: "STAY",
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] as ReservationStatusType[] },
        AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
      },
    });
    if (!room || taken + (adding.get(roomId) ?? 0) > room.capacity) {
      throw new RoomTakenError(room?.name ?? roomId);
    }
  }
}

export interface CreateReservationGroupParams {
  owner: User;
  /** Mascotas YA verificadas: existen y pertenecen al owner. */
  pets: Pet[];
  checkIn: Date;
  checkOut: Date;
  roomPreference: "shared" | "separate";
  paymentType: "FULL" | "DEPOSIT";
  bathSelectionsByPet?: Record<string, { deslanado: boolean; corte: boolean }>;
  medicationByPet?: Record<string, { notes: string }>;
  homeDelivery?: {
    address: string;
    lat: number;
    lng: number;
    placeId?: string;
    trip?: DeliveryTripMode;
  };
  /** PI de Stripe (null cuando el saldo cubrió todo). */
  stripePaymentIntentId: string | null;
  /** Saldo a favor ya aplicado (0 en el flujo de invitado). */
  creditApplied?: number;
  notes?: string | null;
  legalAccepted: boolean;
  /** De dónde vino. El único llamador hoy es el sitio público. */
  source?: NewReservationSource;
}

export type CreateReservationGroupResult =
  | {
      ok: true;
      reservations: Array<Prisma.ReservationGetPayload<{ include: { pet: true; room: true } }>>;
      grandTotal: number;
      groupId: string | null;
      creditApplied: number;
    }
  | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

// Crea el grupo de reservaciones STAY (asignación de cuartos por capacidad,
// add-ons de baño, recargo por medicamento, servicio a domicilio, mismo-día),
// registra los pagos/addons y notifica. Espeja la lógica del handler de móvil
// `POST /reservations/multi` (routes/reservations.ts) para que el flujo de
// invitado web la reutilice sin tocar el handler de producción.
//
// NOTA: el llamador debe validar ANTES: pertenencia de mascotas, cartilla,
// gate legal, solapamientos. Aquí solo se hace el cálculo + la creación.
export async function createReservationGroup(
  prisma: PrismaClient,
  params: CreateReservationGroupParams
): Promise<CreateReservationGroupResult> {
  const {
    owner,
    pets,
    checkIn,
    checkOut,
    roomPreference,
    paymentType,
    bathSelectionsByPet,
    medicationByPet,
    homeDelivery,
    stripePaymentIntentId,
    notes = null,
    legalAccepted,
  } = params;
  const ownerId = owner.id;

  async function countOverlappingForRoom(roomId: string): Promise<number> {
    return prisma.reservation.count({
      where: {
        roomId,
        reservationType: "STAY",
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] as ReservationStatusType[] },
        AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
      },
    });
  }

  async function findAvailableRoom(petSize: PetSize, addingCount = 1) {
    const rooms = await prisma.room.findMany({
      where: { isActive: true, sizeAllowed: { has: petSize } },
      orderBy: { createdAt: "asc" },
    });
    for (const room of rooms) {
      const taken = await countOverlappingForRoom(room.id);
      if (taken + addingCount <= room.capacity) return room;
    }
    return null;
  }

  const diffMs = checkOut.getTime() - checkIn.getTime();
  const totalDays = Math.ceil(diffMs / 86_400_000);
  const groupId = pets.length > 1 ? randomUUID() : null;
  const pricingConfig = await getLodgingPricing(prisma);

  const petSizes = pets.map((p) => ({
    pet: p,
    size: sizeFromWeight(p.weight ?? 0) as PetSize,
    pricePerDay: pricePerDayForWeight(p.weight, pricingConfig),
  }));

  const assignments: { petId: string; roomId: string | null; amount: number }[] = [];

  if (roomPreference === "shared") {
    const sizeOrder: PetSize[] = ["XS", "S", "M", "L", "XL"];
    const largestSize = petSizes.reduce(
      (max, ps) => (sizeOrder.indexOf(ps.size) > sizeOrder.indexOf(max) ? ps.size : max),
      petSizes[0].size
    );
    const room = await findAvailableRoom(largestSize, petSizes.length);
    if (!room) {
      return {
        ok: false,
        status: 400,
        error: `No hay cuartos con capacidad para ${petSizes.length} perros (tamaño ${largestSize}) en las fechas seleccionadas`,
      };
    }
    for (const ps of petSizes) {
      assignments.push({ petId: ps.pet.id, roomId: room.id, amount: ps.pricePerDay * totalDays });
    }
  } else {
    const localUsage = new Map<string, number>();
    for (const ps of petSizes) {
      const rooms = await prisma.room.findMany({
        where: { isActive: true, sizeAllowed: { has: ps.size } },
        orderBy: { createdAt: "asc" },
      });
      let chosen: (typeof rooms)[number] | null = null;
      for (const room of rooms) {
        const taken = await countOverlappingForRoom(room.id);
        const localTaken = localUsage.get(room.id) ?? 0;
        if (taken + localTaken + 1 <= room.capacity) {
          chosen = room;
          localUsage.set(room.id, localTaken + 1);
          break;
        }
      }
      if (!chosen) {
        return {
          ok: false,
          status: 400,
          error: `No hay cuartos disponibles para ${ps.pet.name} (tamaño ${ps.size}) en las fechas seleccionadas`,
        };
      }
      assignments.push({ petId: ps.pet.id, roomId: chosen.id, amount: ps.pricePerDay * totalDays });
    }
  }

  // Variantes de baño por mascota
  const bathByPet = new Map<string, { variantId: string; price: number }>();
  if (bathSelectionsByPet && Object.keys(bathSelectionsByPet).length > 0) {
    const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
    if (!bathType) {
      return { ok: false, status: 500, error: "Servicio de baño no configurado" };
    }
    for (const [petId, sel] of Object.entries(bathSelectionsByPet)) {
      const ps = petSizes.find((x) => x.pet.id === petId);
      if (!ps) continue;
      const size: PetSize = ps.size === "XS" ? "S" : ps.size;
      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bathType.id,
            petSize: size,
            deslanado: sel.deslanado,
            corte: sel.corte,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return { ok: false, status: 400, error: `Variante de baño no disponible para ${ps.pet.name}` };
      }
      bathByPet.set(petId, { variantId: variant.id, price: Number(variant.price) });
    }
  }

  // Medicamento: notas requeridas + recargo 10% sobre hospedaje
  const medicationSurchargeByPet = new Map<string, number>();
  const medicationNotesByPet = new Map<string, string>();
  if (medicationByPet && Object.keys(medicationByPet).length > 0) {
    for (const [petId, sel] of Object.entries(medicationByPet)) {
      const trimmed = sel?.notes?.trim() ?? "";
      if (trimmed.length === 0) {
        return {
          ok: false,
          status: 400,
          error: "Las instrucciones de administración del medicamento son obligatorias",
        };
      }
      const a = assignments.find((x) => x.petId === petId);
      if (!a) continue;
      medicationSurchargeByPet.set(petId, a.amount * 0.1);
      medicationNotesByPet.set(petId, trimmed);
    }
  }

  const lodgingTotal = assignments.reduce((sum, a) => sum + a.amount, 0);
  const bathTotal = Array.from(bathByPet.values()).reduce((s, b) => s + b.price, 0);
  const medicationTotal = Array.from(medicationSurchargeByPet.values()).reduce((s, n) => s + n, 0);
  const baseTotal = lodgingTotal + bathTotal + medicationTotal;

  // Mismo día = menos de 24 h para la medianoche LOCAL del check-in (no para
  // las 00:00 UTC, que son las 17:00 del día anterior en Hermosillo).
  const hoursUntilCheckIn = hoursUntilHotelDay(checkIn);
  const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
  const surchargeMultiplier = sameDaySurcharge ? 1.2 : 1;

  let deliveryFee = 0;
  let deliveryDistanceKm = 0;
  let deliveryActive = false;
  if (homeDelivery && Number.isFinite(homeDelivery.lat) && Number.isFinite(homeDelivery.lng)) {
    const quote = await quoteDelivery(
      prisma,
      homeDelivery.lat,
      homeDelivery.lng,
      homeDelivery.trip ?? "PICKUP"
    );
    if (quote.active) {
      deliveryActive = true;
      deliveryFee = quote.fee;
      deliveryDistanceKm = quote.distanceKm;
    }
  }

  const grandTotal = baseTotal * surchargeMultiplier + deliveryFee;

  // Saldo a favor: el invitado nunca tiene, pero soportamos el caso general.
  const creditOnly = !stripePaymentIntentId;
  let creditApplied = params.creditApplied ?? 0;
  if (creditOnly) {
    const amountDue = paymentType === "DEPOSIT" ? Math.ceil(grandTotal * 0.2) : grandTotal;
    const ownerCredit = Number(owner.creditBalance || 0);
    creditApplied = Math.min(ownerCredit, amountDue);
  }

  // Transacción interactiva (no batch) para tomar el lock por cuarto y
  // re-verificar el cupo justo antes de escribir.
  let reservations: Array<Prisma.ReservationGetPayload<{ include: { pet: true; room: true } }>>;
  try {
    reservations = await prisma.$transaction(async (tx) => {
      await lockRoomsAndVerifyCapacity(tx, assignments, checkIn, checkOut);
      const created: typeof reservations = [];
      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        const bath = bathByPet.get(a.petId);
        const medSurcharge = medicationSurchargeByPet.get(a.petId) ?? 0;
        const medNotes = medicationNotesByPet.get(a.petId) ?? null;
        const isFirst = i === 0;
        const deliveryForThis = isFirst && deliveryActive ? deliveryFee : 0;
        const reservationAmount =
          (a.amount + (bath?.price ?? 0) + medSurcharge) * surchargeMultiplier + deliveryForThis;
        created.push(
          await tx.reservation.create({
            data: {
              checkIn,
              checkOut,
              totalDays,
              totalAmount: new Prisma.Decimal(reservationAmount),
              notes,
              medicationNotes: medNotes,
              legalAccepted,
              status: "CONFIRMED",
              groupId,
              paymentType,
              depositDeadline: paymentType === "DEPOSIT" ? checkIn : null,
              ownerId,
              petId: a.petId,
              roomId: a.roomId,
              ...(isFirst && deliveryActive
                ? {
                    homeDelivery: true,
                    homeDeliveryAddress: homeDelivery!.address,
                    homeDeliveryDistanceKm: deliveryDistanceKm,
                    homeDeliveryFee: new Prisma.Decimal(deliveryFee),
                    homeDeliveryTrip: homeDelivery!.trip ?? "PICKUP",
                  }
                : {}),
            },
            include: { pet: true, room: true },
          })
        );
      }
      return created;
    });
  } catch (err) {
    if (err instanceof RoomTakenError) {
      return {
        ok: false,
        status: 409,
        error: `El cuarto ${err.roomName} ya fue ocupado por otra reserva en esas fechas. Vuelve a intentar.`,
        extra: { code: "ROOM_TAKEN" },
      };
    }
    throw err;
  }

  const isDeposit = paymentType === "DEPOSIT";
  for (let i = 0; i < reservations.length; i++) {
    const res = reservations[i];
    const paidAmount = isDeposit
      ? new Prisma.Decimal(Number(res.totalAmount) * 0.2)
      : res.totalAmount;
    const payment = await prisma.payment.create({
      data: {
        amount: paidAmount,
        method: creditOnly ? "CREDIT" : "STRIPE",
        status: isDeposit ? "PARTIAL" : "PAID",
        // Sin esto el anticipo del 20% nacía con el default FULL y el admin
        // web lo mostraba como pago completo.
        kind: isDeposit ? "ANTICIPO" : "FULL",
        stripePaymentIntentId: i === 0 && !creditOnly ? stripePaymentIntentId : null,
        paidAt: new Date(),
        notes: isDeposit
          ? creditOnly
            ? "Anticipo 20% (saldo a favor)"
            : "Anticipo 20%"
          : creditOnly
            ? "Pago con saldo a favor"
            : null,
        reservationId: res.id,
        userId: ownerId,
      },
    });

    const bath = bathByPet.get(res.petId);
    if (bath) {
      await prisma.reservationAddon.create({
        data: {
          reservationId: res.id,
          variantId: bath.variantId,
          unitPrice: new Prisma.Decimal(bath.price),
          paidWith: "BOOKING",
          paymentId: payment.id,
        },
      });
      const variantRow = await prisma.serviceVariant.findUnique({ where: { id: bath.variantId } });
      if (variantRow) {
        await notifyBathContracted(prisma, {
          reservationId: res.id,
          petName: res.pet.name,
          assignedStaffId: res.staffId,
          deslanado: variantRow.deslanado,
          corte: variantRow.corte,
          price: bath.price,
        });
      }
    }
  }

  if (creditApplied > 0) {
    const updatedOwner = await prisma.user.update({
      where: { id: ownerId },
      data: { creditBalance: { decrement: creditApplied }, lastCreditEntryAt: new Date() },
    });
    // /users/me sirve creditBalance — que no lea la copia cacheada vieja.
    invalidateAuthCache(updatedOwner.clerkId);
    await prisma.creditLedger.create({
      data: {
        userId: ownerId,
        type: "CREDIT_APPLIED",
        amount: -creditApplied,
        balanceAfter: Number(updatedOwner.creditBalance),
        description: `Saldo aplicado en nueva reservación`,
        reservationId: reservations[0]?.id ?? null,
      },
    });
    await notifyUser(prisma, {
      userId: ownerId,
      type: "CREDIT_APPLIED",
      title: "Saldo a favor aplicado 💰",
      body: `Se aplicaron $${creditApplied.toLocaleString("es-MX")} de tu saldo a la nueva reservación.`,
      data: { reservationId: reservations[0]?.id, amount: creditApplied },
    });
  }

  await notifyNewReservation(prisma, {
    reservations,
    owner,
    source: params.source ?? "SITIO_WEB",
    // El flujo de invitado no tiene sesión del equipo: nadie que excluir.
    createdByUserId: null,
  });

  if (owner.email) {
    const depositAmount = paymentType === "DEPOSIT" ? grandTotal * 0.2 : grandTotal;
    const remainingAmount = grandTotal - depositAmount;
    const roomNames = [...new Set(reservations.map((r) => r.room?.name).filter(Boolean))];
    const tpl = reservationConfirmedTemplate({
      ownerFirstName: owner.firstName,
      petNames: reservations.map((r) => r.pet.name),
      checkIn,
      checkOut,
      roomName: roomNames.length === 1 ? (roomNames[0] as string) : null,
      totalAmount: grandTotal,
      paymentType: paymentType as "FULL" | "DEPOSIT",
      remainingAmount,
    });
    await sendEmail({ to: owner.email, ...tpl });
  }

  return { ok: true, reservations, grandTotal, groupId, creditApplied };
}
