import { FastifyInstance } from "fastify";
import {
  CreateReservationSchema,
  CreateMultiReservationSchema,
  UpdateReservationStatusSchema,
  UpdateReservationTimesSchema,
  ReservationStatus,
  CancelReservationSchema,
} from "@holidoginn/shared";
import { Prisma, PetSize, ReservationStatus as PrismaResStatus } from "@holidoginn/db";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { notifyBathContracted } from "./services";
import { createAuthMiddleware } from "../middleware/auth";
import { resolveDiscount } from "../lib/discounts";
import {
  reservationConfirmedTemplate,
  sendEmail,
} from "../lib/email";
import { notifyUser, notifyUsers } from "../lib/notify";
import { processRefund } from "../lib/refund";
import { notifyExpiringVaccines } from "../lib/auto-actions";
import { triggerMaintenance } from "../lib/maintenance";
import { LEGAL_DOC_VERSIONS, REQUIRED_FOR_BOOKING } from "../lib/legal";
import { getLodgingPricing, pricePerDayForWeight, sizeFromWeight } from "../lib/pricing";
import { quoteDelivery } from "../lib/delivery";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

export default async function reservationsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // GET /reservations — listar (acepta query ?ownerId= y ?status=)
  // OWNER siempre queda filtrado a sus propias reservas; STAFF/ADMIN pueden filtrar libremente.
  fastify.get<{
    Querystring: { ownerId?: string; status?: ReservationStatus };
  }>("/reservations", { preHandler: [authMiddleware] }, async (request) => {
    // Mantenimiento (auto-checkout, anticipos vencidos, recordatorios) en
    // segundo plano y con throttle — ya no bloquea esta lectura.
    triggerMaintenance(prisma);
    const { ownerId: queryOwnerId, status } = request.query;
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    const effectiveOwnerId = isStaffOrAdmin ? queryOwnerId : request.userId;
    const reservations = await prisma.reservation.findMany({
      where: {
        ...(effectiveOwnerId ? { ownerId: effectiveOwnerId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        pet: { select: { id: true, name: true, breed: true, photoUrl: true } },
        room: { select: { id: true, name: true } },
        staff: { select: { id: true, firstName: true, lastName: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        payments: {
          where: { status: { in: ["PAID", "PARTIAL"] } },
          select: { amount: true },
        },
        changeRequests: {
          where: { status: "PENDING" },
          select: { id: true },
          take: 1,
        },
        updates: {
          select: { createdAt: true },
          orderBy: { createdAt: "desc" as const },
          take: 1,
        },
        review: {
          select: { id: true, rating: true },
        },
        // Para tarjetas de baño: indicadores deslanado/corte. Sólo se incluyen
        // los flags del variant; el precio y demás detalles viven en el detail.
        addons: {
          select: {
            variant: { select: { deslanado: true, corte: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    // Defensa: omite reservaciones con relaciones rotas (datos legacy con FK
    // huérfana) para no romper a los clientes que asumen pet/owner presentes.
    return reservations
      .filter((r) => r.pet && r.owner)
      .map(({ payments, changeRequests, updates, review, addons, ...r }) => {
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(r.totalAmount) - totalPaid;
      const hasDeslanado = addons.some((a) => a.variant?.deslanado === true);
      const hasCorte = addons.some((a) => a.variant?.corte === true);
      return {
        ...r,
        hasBalance: remaining > 0.01,
        hasPendingChangeRequest: (changeRequests?.length ?? 0) > 0,
        lastUpdateAt: updates?.[0]?.createdAt ?? null,
        hasReview: !!review,
        reviewRating: review?.rating ?? null,
        hasDeslanado,
        hasCorte,
      };
    });
  });

  // GET /reservations/:id — obtener con relaciones completas (owner o staff/admin)
  fastify.get<{ Params: { id: string } }>(
    "/reservations/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: true,
          room: true,
          payments: { orderBy: { createdAt: "desc" } },
          updates: {
            orderBy: { createdAt: "desc" },
            include: {
              staff: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          staff: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          review: true,
          addons: {
            include: { variant: { include: { serviceType: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      return reservation;
    }
  );

  // POST /reservations — crear (calcula totalDays y totalAmount)
  fastify.post("/reservations", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = CreateReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const {
      reservationType,
      checkIn,
      checkOut,
      ownerId,
      petId,
      roomId,
      notes,
      legalAccepted,
      appointmentAt,
      deslanado,
      corte,
      bath,
      staffId,
      medicationNotes,
      depositAgreed,
      homeDelivery,
    } = parsed.data;

    // OWNER solo puede reservar para sí mismo; STAFF/ADMIN pueden reservar en nombre de cualquiera.
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    if (!isStaffOrAdmin && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes reservar para tu propia cuenta" });
    }

    if (!legalAccepted) {
      return reply
        .status(400)
        .send({ error: "Debes aceptar los términos legales para reservar" });
    }

    // Verify owner exists
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      return reply.status(404).send({ error: "Dueño no encontrado" });
    }

    // Verify pet exists and belongs to owner
    const pet = await prisma.pet.findUnique({ where: { id: petId } });
    if (!pet) {
      return reply.status(404).send({ error: "Mascota no encontrada" });
    }
    if (pet.ownerId !== ownerId) {
      return reply.status(400).send({ error: "La mascota no pertenece al dueño indicado" });
    }

    // Validar staff asignado (opcional). Solo usuarios con rol STAFF.
    if (staffId) {
      const staffUser = await prisma.user.findUnique({ where: { id: staffId } });
      if (!staffUser || staffUser.role !== "STAFF") {
        return reply.status(400).send({ error: "El staff asignado no es válido" });
      }
    }

    const trimmedMedication = medicationNotes?.trim() || null;

    // Servicio a domicilio: la tarifa SIEMPRE se recalcula server-side desde lat/lng.
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    let deliveryAddress: string | null = null;
    if (
      homeDelivery &&
      Number.isFinite(homeDelivery.lat) &&
      Number.isFinite(homeDelivery.lng)
    ) {
      const quote = await quoteDelivery(prisma, homeDelivery.lat, homeDelivery.lng);
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
        }
      : {};

    // Campos comunes adicionales.
    const extraData = {
      ...(staffId ? { staffId } : {}),
      ...(trimmedMedication ? { medicationNotes: trimmedMedication } : {}),
      ...(depositAgreed != null
        ? { depositAgreed: new Prisma.Decimal(depositAgreed) }
        : {}),
      ...deliveryData,
    };

    // ── Rama BATH: cita puntual; el precio se resuelve server-side desde la variante.
    if (reservationType === "BATH") {
      if (!appointmentAt || Number.isNaN(appointmentAt.getTime())) {
        return reply
          .status(400)
          .send({ error: "appointmentAt es requerido para una cita de baño" });
      }

      const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bathType) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }

      const size = sizeFromWeight(pet.weight ?? 0);
      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bathType.id,
            petSize: size,
            deslanado: deslanado ?? false,
            corte: corte ?? false,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return reply
          .status(400)
          .send({ error: `Variante de baño no disponible para ${pet.name}` });
      }

      const bathTotal = new Prisma.Decimal(Number(variant.price)).add(deliveryFee);

      // Sin pago en creación manual: el total queda como saldo pendiente,
      // el admin registra el cobro después desde el detalle de la reserva.
      const reservation = await prisma.$transaction(async (tx) => {
        const res = await tx.reservation.create({
          data: {
            reservationType: "BATH",
            appointmentAt,
            totalAmount: bathTotal,
            notes,
            legalAccepted,
            status: "CONFIRMED",
            ownerId,
            petId,
            ...extraData,
          },
          include: { pet: true, room: true },
        });
        // Addon para rastrear la variante contratada.
        await tx.reservationAddon.create({
          data: {
            reservationId: res.id,
            variantId: variant.id,
            unitPrice: variant.price,
            paidWith: "BOOKING",
          },
        });
        return res;
      });
      return reply.status(201).send(reservation);
    }

    // ── Rama STAY (default): estancia con rango de fechas y cuarto.
    if (!checkIn || !checkOut) {
      return reply
        .status(400)
        .send({ error: "checkIn y checkOut son requeridos para una estancia" });
    }
    if (checkOut <= checkIn) {
      return reply
        .status(400)
        .send({ error: "checkOut debe ser posterior a checkIn" });
    }

    // Verify room exists
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return reply.status(404).send({ error: "Cuarto no encontrado" });
    }
    if (!room.isActive) {
      return reply.status(400).send({ error: "El cuarto no está activo" });
    }

    // Capacity guard: el cuarto no debe rebasar su capacidad en las fechas pedidas.
    const taken = await countOverlappingForRoom(room.id, checkIn, checkOut);
    if (taken + 1 > room.capacity) {
      return reply.status(409).send({
        error: `El cuarto ${room.name} no tiene capacidad disponible en esas fechas (${taken}/${room.capacity} ocupado).`,
        code: "ROOM_AT_CAPACITY",
      });
    }

    // Hospedaje: precio por día según peso × noches.
    const diffMs = checkOut.getTime() - checkIn.getTime();
    const totalDays = Math.ceil(diffMs / 86_400_000);
    const pricingConfig = await getLodgingPricing(prisma);
    const pricePerDay = pricePerDayForWeight(pet.weight, pricingConfig);
    const lodgingAmount = pricePerDay * totalDays;

    // Baño como complemento del hospedaje (opcional).
    let stayBathVariant: { id: string; price: number } | null = null;
    if (bath) {
      const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bathType) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }
      const size = sizeFromWeight(pet.weight ?? 0);
      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bathType.id,
            petSize: size,
            deslanado: bath.deslanado,
            corte: bath.corte,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return reply
          .status(400)
          .send({ error: `Variante de baño no disponible para ${pet.name}` });
      }
      stayBathVariant = { id: variant.id, price: Number(variant.price) };
    }

    // Recargo de medicamento: +10% sobre el hospedaje (igual que el flujo owner).
    const medicationSurcharge = trimmedMedication ? lodgingAmount * 0.1 : 0;
    const bathPrice = stayBathVariant?.price ?? 0;
    const totalAmount = new Prisma.Decimal(
      lodgingAmount + medicationSurcharge + bathPrice + deliveryFee,
    );

    const reservation = await prisma.$transaction(async (tx) => {
      const res = await tx.reservation.create({
        data: {
          checkIn,
          checkOut,
          totalDays,
          totalAmount,
          notes,
          legalAccepted,
          status: "CONFIRMED",
          ownerId,
          petId,
          roomId,
          ...extraData,
        },
        include: { pet: true, room: true },
      });
      if (stayBathVariant) {
        await tx.reservationAddon.create({
          data: {
            reservationId: res.id,
            variantId: stayBathVariant.id,
            unitPrice: new Prisma.Decimal(stayBathVariant.price),
            paidWith: "BOOKING",
          },
        });
      }
      return res;
    });
    return reply.status(201).send(reservation);
  });

  // PATCH /reservations/:id/times — hora estimada de llegada/recogida.
  // La indica el dueño (o staff/admin). Se propaga a TODO el grupo
  // multi-mascota: las mascotas del mismo dueño llegan y se recogen juntas.
  fastify.patch<{ Params: { id: string } }>(
    "/reservations/:id/times",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = UpdateReservationTimesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      if (reservation.reservationType !== "STAY") {
        return reply
          .status(400)
          .send({ error: "Solo aplica a reservaciones de hospedaje" });
      }

      const { checkInTime, checkOutTime } = parsed.data;
      // La hora de llegada ya no tiene sentido después del check-in; la de
      // recogida se puede indicar hasta antes del check-out.
      if (checkInTime !== undefined && reservation.status !== "CONFIRMED") {
        return reply
          .status(400)
          .send({ error: "La hora de llegada ya no se puede cambiar" });
      }
      if (
        checkOutTime !== undefined &&
        !["CONFIRMED", "CHECKED_IN"].includes(reservation.status)
      ) {
        return reply
          .status(400)
          .send({ error: "La hora de recogida ya no se puede cambiar" });
      }

      const data = {
        ...(checkInTime !== undefined ? { checkInTime } : {}),
        ...(checkOutTime !== undefined ? { checkOutTime } : {}),
      };

      await prisma.reservation.updateMany({
        where: reservation.groupId
          ? { groupId: reservation.groupId, ownerId: reservation.ownerId }
          : { id: reservation.id },
        data,
      });

      const updated = await prisma.reservation.findUnique({
        where: { id: reservation.id },
      });
      return updated;
    }
  );

  // PATCH /reservations/:id/status — cambiar status
  fastify.patch<{ Params: { id: string } }>(
    "/reservations/:id/status",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = UpdateReservationStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const updated = await prisma.reservation.update({
        where: { id: request.params.id },
        data: { status: parsed.data.status },
        include: { pet: true, room: true },
      });
      return updated;
    }
  );

  // ── Helper: cuenta cuántas reservas activas (no CANCELLED/CHECKED_OUT) solapan
  // con la ventana [checkIn, checkOut) en un cuarto. Opcionalmente excluye un id
  // (para edición de la misma reserva).
  async function countOverlappingForRoom(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: string,
  ): Promise<number> {
    return prisma.reservation.count({
      where: {
        roomId,
        reservationType: "STAY",
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] as PrismaResStatus[] },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        AND: [
          { checkIn: { lt: checkOut } },
          { checkOut: { gt: checkIn } },
        ],
      },
    });
  }

  // ── Helper: find available room for a pet size + dates (capacity-aware) ──
  // Toma en cuenta `capacity`: un cuarto se considera disponible mientras la
  // cantidad de reservaciones activas solapadas sea menor a su capacidad.
  // `addingCount` es cuántos perros nuevos se quieren meter (default 1).
  async function findAvailableRoom(
    petSize: PetSize,
    checkIn: Date,
    checkOut: Date,
    addingCount: number = 1,
  ) {
    const rooms = await prisma.room.findMany({
      where: {
        isActive: true,
        sizeAllowed: { has: petSize },
      },
      orderBy: { createdAt: "asc" },
    });
    for (const room of rooms) {
      const taken = await countOverlappingForRoom(room.id, checkIn, checkOut);
      if (taken + addingCount <= room.capacity) return room;
    }
    return null;
  }

  // POST /reservations/discounts/validate — feedback en vivo del código de
  // descuento al reservar (hotel o baño). create-intent es la autoridad final;
  // esto solo da retroalimentación inmediata. Alcance RESERVATIONS/BOTH.
  fastify.post<{ Body: { code?: string; subtotal?: number } }>(
    "/reservations/discounts/validate",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const code = (request.body?.code ?? "").trim();
      const subtotal = Number(request.body?.subtotal);
      if (!code) return reply.status(400).send({ error: "Código requerido" });
      if (!Number.isFinite(subtotal) || subtotal <= 0) {
        return reply.status(400).send({ error: "Subtotal inválido" });
      }
      const discount = await resolveDiscount(prisma, {
        code,
        subtotal,      });
      if (discount.error) {
        return reply.send({ valid: false, discountTotal: 0, message: discount.error });
      }
      return reply.send({
        valid: true,
        discountTotal: discount.discountTotal,
        message: "Cupón aplicado",
      });
    }
  );

  // POST /reservations/multi — crear reservaciones para múltiples mascotas
  fastify.post("/reservations/multi", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = CreateMultiReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { checkIn, checkOut, checkInTime, checkOutTime, ownerId, petIds, notes, legalAccepted, roomPreference, stripePaymentIntentId, paymentType, bathSelectionsByPet, medicationByPet, homeDelivery, discountCode } = parsed.data;

    // OWNER solo puede reservar para sí mismo.
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    if (!isStaffOrAdmin && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes reservar para tu propia cuenta" });
    }

    if (checkOut <= checkIn) {
      return reply.status(400).send({ error: "checkOut debe ser posterior a checkIn" });
    }
    if (!legalAccepted) {
      return reply.status(400).send({ error: "Debes aceptar los términos legales para reservar" });
    }

    // Gate: verificar que el usuario haya aceptado la versión vigente de los
    // documentos requeridos (TOS, PRIVACY, VET_AUTH). 412 = Precondition Failed.
    const acceptances = await prisma.legalAcceptance.findMany({
      where: { userId: ownerId },
      select: { documentType: true, version: true },
    });
    const acceptedSet = new Set(
      acceptances.map((a) => `${a.documentType}@${a.version}`)
    );
    const missingLegal = REQUIRED_FOR_BOOKING.filter(
      (type) => !acceptedSet.has(`${type}@${LEGAL_DOC_VERSIONS[type]}`)
    );
    if (missingLegal.length > 0) {
      return reply.status(412).send({
        error: "Faltan consentimientos legales vigentes",
        code: "LEGAL_ACCEPTANCE_REQUIRED",
        missing: missingLegal,
        versions: LEGAL_DOC_VERSIONS,
      });
    }

    // Verify Stripe payment succeeded (allow credit-only bypass when no intent was created)
    let paymentIntent: Stripe.PaymentIntent | null = null;
    let creditApplied = 0;
    // Descuento: en el flujo Stripe se lee del metadata del PI (autoritativo,
    // fijado en create-intent); en credit-only se re-valida más abajo.
    let discountTotal = 0;
    let discountCodeId: string | null = null;
    if (stripePaymentIntentId) {
      // IDEMPOTENCIA: si este PaymentIntent ya generó reservación(es) (p. ej. el
      // cliente reintentó tras 3DS o recargó la página de confirmación), devolver
      // las existentes en lugar de crear duplicados.
      const existingPayment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId },
        include: { reservation: true },
      });
      if (existingPayment?.reservation) {
        const groupId = existingPayment.reservation.groupId;
        const reservations = groupId
          ? await prisma.reservation.findMany({ where: { groupId } })
          : [existingPayment.reservation];
        const grandTotal = reservations.reduce((s, r) => s + Number(r.totalAmount), 0);
        return reply.status(200).send({
          reservations,
          grandTotal,
          discountTotal: reservations.reduce((s, r) => s + Number(r.discountTotal ?? 0), 0),
          groupId: groupId ?? null,
          creditApplied: 0,
          idempotent: true,
        });
      }

      paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      // ANTI-REPLAY: el PI debe pertenecer al mismo dueño que reserva (create-intent
      // guarda ownerId en metadata). Evita reusar el PI de otra cuenta/booking.
      if (paymentIntent.metadata?.ownerId && paymentIntent.metadata.ownerId !== ownerId) {
        return reply.status(403).send({ error: "El pago no corresponde a esta cuenta" });
      }
      creditApplied = Number(paymentIntent.metadata?.creditApplied ?? 0);
      discountTotal = Number(paymentIntent.metadata?.discountTotal ?? 0);
      discountCodeId = paymentIntent.metadata?.discountCodeId || null;
    }
    // creditOnly = true when the deposit/total was fully covered by the
    // owner's saldo a favor and no Stripe charge was created. We compute the
    // exact credit to apply later (after we know grandTotal).
    const creditOnly = !stripePaymentIntentId;

    // Verify owner
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) return reply.status(404).send({ error: "Dueño no encontrado" });

    // Defense in depth: corre el chequeo de vacunas vencidas antes del guard.
    // Esto asegura que si una vacuna venció y el admin no ha abierto el dashboard,
    // igual se demote la cartilla a EXPIRED y se bloquee la reservación aquí.
    await notifyExpiringVaccines(prisma);

    // Verify all pets belong to owner (re-fetch para tener el cartillaStatus fresco)
    const pets = await prisma.pet.findMany({ where: { id: { in: petIds }, ownerId } });
    if (pets.length !== petIds.length) {
      return reply.status(400).send({ error: "Una o más mascotas no pertenecen al dueño" });
    }

    // Cartilla guard: block pets without APPROVED cartilla
    const blocked = pets.filter((p) => p.cartillaStatus !== "APPROVED");
    if (blocked.length > 0) {
      const names = blocked.map((p) => p.name).join(", ");
      const someExpired = blocked.some((p) => p.cartillaStatus === "EXPIRED");
      return reply.status(400).send({
        error: someExpired
          ? `Cartilla vencida: ${names}. Renueva la cartilla y espera el visto bueno del equipo HDI antes de reservar.`
          : `Cartilla pendiente de aprobación: ${names}. Sube la cartilla y espera el visto bueno del equipo HDI.`,
        blockedPetIds: blocked.map((p) => p.id),
      });
    }

    // Overlap guard: una misma mascota no puede tener dos reservas activas con
    // fechas solapadas. Defensa en profundidad — el frontend ya valida pero no
    // es confiable ante race conditions / clientes desactualizados.
    const overlapping = await prisma.reservation.findMany({
      where: {
        petId: { in: petIds },
        status: { not: "CANCELLED" },
        AND: [
          { checkIn: { lt: checkOut } },
          { checkOut: { gt: checkIn } },
        ],
      },
      include: { pet: { select: { id: true, name: true } } },
    });
    if (overlapping.length > 0) {
      const names = Array.from(
        new Set(overlapping.map((r) => r.pet.name))
      ).join(", ");
      return reply.status(409).send({
        error: `Ya existe una reserva activa para: ${names} en esas fechas.`,
        code: "RESERVATION_OVERLAP",
        conflicts: overlapping.map((r) => ({
          reservationId: r.id,
          petId: r.petId,
          petName: r.pet.name,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          status: r.status,
        })),
      });
    }

    const diffMs = checkOut.getTime() - checkIn.getTime();
    const totalDays = Math.ceil(diffMs / 86_400_000);
    const groupId = petIds.length > 1 ? randomUUID() : null;
    const pricingConfig = await getLodgingPricing(prisma);

    // Determine sizes
    const petSizes = pets.map((p) => ({
      pet: p,
      size: sizeFromWeight(p.weight ?? 0),
      pricePerDay: pricePerDayForWeight(p.weight, pricingConfig),
    }));

    // Find rooms
    const assignments: { petId: string; roomId: string | null; amount: number }[] = [];

    if (roomPreference === "shared") {
      // Find room for the largest pet size that fits TODAS las mascotas del grupo.
      const sizeOrder: PetSize[] = ["XS", "S", "M", "L", "XL"];
      const largestSize = petSizes.reduce((max, ps) =>
        sizeOrder.indexOf(ps.size) > sizeOrder.indexOf(max) ? ps.size : max,
        petSizes[0].size
      );
      const room = await findAvailableRoom(
        largestSize,
        checkIn,
        checkOut,
        petSizes.length,
      );
      if (!room) {
        return reply.status(400).send({
          error: `No hay cuartos con capacidad para ${petSizes.length} perros (tamaño ${largestSize}) en las fechas seleccionadas`,
        });
      }
      for (const ps of petSizes) {
        assignments.push({
          petId: ps.pet.id,
          roomId: room.id,
          amount: ps.pricePerDay * totalDays,
        });
      }
    } else {
      // Separate: find a room per pet — y reservar lugares ya asignados en este
      // mismo request para no asignar dos perros al mismo cuarto rebasando su
      // capacidad dentro de la misma operación.
      const localUsage = new Map<string, number>();
      for (const ps of petSizes) {
        const rooms = await prisma.room.findMany({
          where: { isActive: true, sizeAllowed: { has: ps.size } },
          orderBy: { createdAt: "asc" },
        });
        let chosen: typeof rooms[number] | null = null;
        for (const room of rooms) {
          const taken = await countOverlappingForRoom(room.id, checkIn, checkOut);
          const localTaken = localUsage.get(room.id) ?? 0;
          if (taken + localTaken + 1 <= room.capacity) {
            chosen = room;
            localUsage.set(room.id, localTaken + 1);
            break;
          }
        }
        if (!chosen) {
          return reply.status(400).send({
            error: `No hay cuartos disponibles para ${ps.pet.name} (tamaño ${ps.size}) en las fechas seleccionadas`,
          });
        }
        assignments.push({
          petId: ps.pet.id,
          roomId: chosen.id,
          amount: ps.pricePerDay * totalDays,
        });
      }
    }

    // Resolve bath variants for each pet (if provided)
    const bathByPet = new Map<string, { variantId: string; price: number }>();
    if (bathSelectionsByPet && Object.keys(bathSelectionsByPet).length > 0) {
      const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bathType) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }
      for (const [petId, sel] of Object.entries(bathSelectionsByPet)) {
        const ps = petSizes.find((x) => x.pet.id === petId);
        if (!ps) continue;
        // ps.size proviene de sizeFromWeight → nunca "XS" (no requiere colapso).
        const size: PetSize = ps.size;
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
          return reply.status(400).send({
            error: `Variante de baño no disponible para ${ps.pet.name}`,
          });
        }
        bathByPet.set(petId, { variantId: variant.id, price: Number(variant.price) });
      }
    }

    // Medication: validate notes present per-pet, compute +10% surcharge on lodging
    const medicationSurchargeByPet = new Map<string, number>();
    const medicationNotesByPet = new Map<string, string>();
    if (medicationByPet && Object.keys(medicationByPet).length > 0) {
      for (const [petId, sel] of Object.entries(medicationByPet)) {
        const trimmed = sel?.notes?.trim() ?? "";
        if (trimmed.length === 0) {
          return reply.status(400).send({
            error: "Las instrucciones de administración del medicamento son obligatorias",
          });
        }
        const a = assignments.find((x) => x.petId === petId);
        if (!a) continue;
        medicationSurchargeByPet.set(petId, a.amount * 0.10);
        medicationNotesByPet.set(petId, trimmed);
      }
    }

    // Create all reservations + payments in a transaction
    const lodgingTotal = assignments.reduce((sum, a) => sum + a.amount, 0);
    const bathTotal = Array.from(bathByPet.values()).reduce((s, b) => s + b.price, 0);
    const medicationTotal = Array.from(medicationSurchargeByPet.values()).reduce((s, n) => s + n, 0);
    const baseTotal = lodgingTotal + bathTotal + medicationTotal;

    // Descuento credit-only (sin PI): re-validar server-side contra el subtotal
    // del servicio. En el flujo Stripe ya se leyó del metadata del PI.
    if (creditOnly) {
      const d = await resolveDiscount(prisma, {
        code: discountCode,
        subtotal: baseTotal,      });
      if (d.error) {
        return reply.status(400).send({ error: d.error });
      }
      discountTotal = d.discountTotal;
      discountCodeId = d.discountCodeId;
    }
    // Acotar defensivamente (el metadata del PI podría no cuadrar con la base).
    discountTotal = Math.min(Math.max(0, discountTotal), baseTotal);
    const discountedBase = baseTotal - discountTotal;

    // Same-day surcharge: OWNER booking < 24h before check-in pays +20%
    const hoursUntilCheckIn = (checkIn.getTime() - Date.now()) / (60 * 60 * 1000);
    const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
    const surchargeMultiplier = sameDaySurcharge ? 1.20 : 1;

    // Servicio a domicilio — fee RE-CALCULADA server-side desde lat/lng (igual
    // que en /payments/create-intent). Costo logístico fijo: NO lleva el
    // recargo mismo-día, pero SÍ entra en la base del anticipo. En grupos
    // multi-mascota se cobra UNA sola vez (se adjunta a la primera reserva).
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    let deliveryActive = false;
    if (homeDelivery && Number.isFinite(homeDelivery.lat) && Number.isFinite(homeDelivery.lng)) {
      const quote = await quoteDelivery(prisma, homeDelivery.lat, homeDelivery.lng);
      if (quote.active) {
        deliveryActive = true;
        deliveryFee = quote.fee;
        deliveryDistanceKm = quote.distanceKm;
      }
    }

    const grandTotal = discountedBase * surchargeMultiplier + deliveryFee;

    // Credit-only path: owner's saldo covers the deposit/total and no Stripe
    // charge was created. Recompute creditApplied here so we register the
    // payment as CREDIT (not STRIPE) and decrement the user's balance.
    if (creditOnly) {
      const amountDue = paymentType === "DEPOSIT"
        ? Math.ceil(grandTotal * 0.20)
        : grandTotal;
      const ownerCredit = Number(owner.creditBalance || 0);
      creditApplied = Math.min(ownerCredit, amountDue);
    }

    // Reserva + pago + addon de baño + descuento de saldo en UNA transacción
    // interactiva: si algo falla a mitad, NADA se persiste (no quedan reservas
    // sin su registro de pago, ni saldo descontado sin reserva). Las
    // notificaciones (push) y lecturas auxiliares van DESPUÉS del commit.
    const isDeposit = paymentType === "DEPOSIT";
    const reservations = await prisma.$transaction(async (tx) => {
      const created: Prisma.ReservationGetPayload<{
        include: { pet: true; room: true };
      }>[] = [];
      // Reparto del descuento del booking entre las reservas (proporcional a la
      // base de cada una); la última fila absorbe el redondeo para que la suma
      // de discountTotal sea exactamente el descuento total.
      let allocatedDiscount = 0;

      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        const bath = bathByPet.get(a.petId);
        const medSurcharge = medicationSurchargeByPet.get(a.petId) ?? 0;
        const medNotes = medicationNotesByPet.get(a.petId) ?? null;
        // La fee de domicilio se adjunta SOLO a la primera reserva del grupo
        // (un viaje cubre a todas las mascotas del mismo dueño).
        const isFirst = i === 0;
        const deliveryForThis = isFirst && deliveryActive ? deliveryFee : 0;
        const rowBase = a.amount + (bath?.price ?? 0) + medSurcharge;
        const isLast = i === assignments.length - 1;
        const rowDiscount =
          discountTotal <= 0 || baseTotal <= 0
            ? 0
            : isLast
              ? Math.max(0, Number((discountTotal - allocatedDiscount).toFixed(2)))
              : Number(((discountTotal * rowBase) / baseTotal).toFixed(2));
        allocatedDiscount += rowDiscount;
        const reservationAmount =
          (rowBase - rowDiscount) * surchargeMultiplier + deliveryForThis;

        const res = await tx.reservation.create({
          data: {
            checkIn,
            checkOut,
            checkInTime: checkInTime ?? null,
            checkOutTime: checkOutTime ?? null,
            totalDays,
            totalAmount: new Prisma.Decimal(reservationAmount),
            ...(discountCodeId
              ? { discountCodeId, discountTotal: new Prisma.Decimal(rowDiscount) }
              : {}),
            notes,
            medicationNotes: medNotes,
            legalAccepted,
            status: "CONFIRMED",
            groupId,
            paymentType,
            // Deposit deadline = check-in day. Owner can pay the balance in
            // the app or in person at the branch on arrival.
            depositDeadline: paymentType === "DEPOSIT" ? checkIn : null,
            ownerId,
            petId: a.petId,
            roomId: a.roomId,
            // Servicio a domicilio (persistido en la primera reserva del grupo).
            ...(isFirst && deliveryActive
              ? {
                  homeDelivery: true,
                  homeDeliveryAddress: homeDelivery!.address,
                  homeDeliveryDistanceKm: deliveryDistanceKm,
                  homeDeliveryFee: new Prisma.Decimal(deliveryFee),
                }
              : {}),
          },
          include: { pet: true, room: true },
        });
        created.push(res);

        const paidAmount = isDeposit
          ? new Prisma.Decimal(Number(res.totalAmount) * 0.20)
          : res.totalAmount;
        const payment = await tx.payment.create({
          data: {
            amount: paidAmount,
            // CREDIT when no Stripe charge was created (saldo a favor cubrió todo).
            method: creditOnly ? "CREDIT" : "STRIPE",
            status: isDeposit ? "PARTIAL" : "PAID",
            stripePaymentIntentId: i === 0 && !creditOnly ? stripePaymentIntentId : null,
            paidAt: new Date(),
            notes: isDeposit
              ? (creditOnly ? "Anticipo 20% (saldo a favor)" : "Anticipo 20%")
              : (creditOnly ? "Pago con saldo a favor" : null),
            reservationId: res.id,
            userId: ownerId,
          },
        });

        // Persist bath addon attached to this reservation's payment
        if (bath) {
          await tx.reservationAddon.create({
            data: {
              reservationId: res.id,
              variantId: bath.variantId,
              unitPrice: new Prisma.Decimal(bath.price),
              paidWith: "BOOKING",
              paymentId: payment.id,
            },
          });
        }
      }

      // Deduct credit applied (if any) and write ledger entry — atómico con lo anterior.
      if (creditApplied > 0) {
        const updatedOwner = await tx.user.update({
          where: { id: ownerId },
          data: {
            creditBalance: { decrement: creditApplied },
            lastCreditEntryAt: new Date(),
          },
        });
        await tx.creditLedger.create({
          data: {
            userId: ownerId,
            type: "CREDIT_APPLIED",
            amount: -creditApplied,
            balanceAfter: Number(updatedOwner.creditBalance),
            description: `Saldo aplicado en nueva reservación`,
            reservationId: created[0]?.id ?? null,
          },
        });
      }

      // Incrementar el uso del código UNA vez por booking. Idempotente: un
      // reintento del mismo PI devuelve las reservas existentes (rama de arriba)
      // sin re-entrar a esta transacción.
      if (discountCodeId) {
        await tx.discountCode.update({
          where: { id: discountCodeId },
          data: { usesCount: { increment: 1 } },
        });
      }

      return created;
    });

    // ─── Post-commit (no crítico): notificaciones y lecturas auxiliares ───
    // Baños contratados: avisar a staff/admin (fire-and-forget).
    for (const res of reservations) {
      const bath = bathByPet.get(res.petId);
      if (!bath) continue;
      const variantRow = await prisma.serviceVariant.findUnique({
        where: { id: bath.variantId },
      });
      if (variantRow) {
        notifyBathContracted(prisma, {
          reservationId: res.id,
          petName: res.pet.name,
          assignedStaffId: res.staffId,
          deslanado: variantRow.deslanado,
          corte: variantRow.corte,
          price: bath.price,
        }).catch((err) => fastify.log.error({ err }, "notifyBathContracted falló"));
      }
    }

    // Saldo a favor aplicado: avisar al dueño (fire-and-forget).
    if (creditApplied > 0) {
      notifyUser(prisma, {
        userId: ownerId,
        type: "CREDIT_APPLIED",
        title: "Saldo a favor aplicado 💰",
        body: `Se aplicaron $${creditApplied.toLocaleString("es-MX")} de tu saldo a la nueva reservación.`,
        data: { reservationId: reservations[0]?.id, amount: creditApplied },
      }).catch((err) => fastify.log.error({ err }, "notifyUser(credit) falló"));
    }

    // Notificar a todos los staff de nueva reservación disponible
    const petNames = reservations.map((r) => r.pet?.name).filter(Boolean).join(", ");
    const staffUsers = await prisma.user.findMany({
      where: { role: "STAFF", isActive: true },
      select: { id: true },
    });
    if (staffUsers.length > 0) {
      // Fire-and-forget: notificar al staff no debe bloquear la respuesta.
      notifyUsers(prisma, staffUsers.map((s) => s.id), {
        type: "NEW_RESERVATION",
        title: "Nueva reservación creada 🐾",
        body: `Se creó una reservación para ${petNames || "una mascota"}. Revisa si necesitas asignarte.`,
        data: { reservationId: reservations[0]?.id },
      }).catch((err) => fastify.log.error({ err }, "notifyUsers(staff) falló"));
    }

    // Email de confirmación al dueño
    if (owner.email) {
      const depositAmount = paymentType === "DEPOSIT" ? grandTotal * 0.20 : grandTotal;
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
      // Fire-and-forget: el correo (Resend, ~2-5 s) no debe bloquear la
      // respuesta; sendEmail ya es tolerante a fallas internamente.
      sendEmail({ to: owner.email, ...tpl }).catch((err) =>
        fastify.log.error({ err }, "sendEmail(confirmación) falló")
      );
    }

    return reply.status(201).send({ reservations, grandTotal, discountTotal, groupId, creditApplied });
  });

  // GET /reservations/:id/checklists — reportes diarios (owner o staff/admin)
  fastify.get<{ Params: { id: string } }>(
    "/reservations/:id/checklists",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply
          .status(404)
          .send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const checklists = await prisma.dailyChecklist.findMany({
        where: { reservationId: request.params.id },
        orderBy: { date: "desc" },
        include: {
          staff: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
      return checklists;
    }
  );

  // POST /reservations/:id/cancel — cancelación total inmediata por owner
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/cancel",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CancelReservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { refundChoice } = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        select: { id: true, ownerId: true, status: true },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (reservation.status !== "CONFIRMED") {
        return reply.status(400).send({
          error: "Solo puedes cancelar reservaciones confirmadas",
        });
      }

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED" },
      });

      try {
        const result = await processRefund(prisma, {
          reservationId: reservation.id,
          refundChoice,
        });
        return reply.send({ success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error procesando reembolso";
        return reply.status(409).send({ error: message });
      }
    }
  );

  // POST /reservations/:id/issue-refund — cliente elige reembolso después de
  // que el admin canceló la reserva. La reserva ya está CANCELLED y aún no
  // tiene un Payment con status REFUNDED.
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/issue-refund",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CancelReservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { refundChoice } = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { payments: true },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (reservation.status !== "CANCELLED") {
        return reply.status(400).send({
          error: "Solo puedes elegir reembolso en reservas canceladas",
        });
      }
      if (reservation.payments.some((p) => p.status === "REFUNDED")) {
        return reply.status(409).send({
          error: "Ya se emitió un reembolso para esta reservación",
        });
      }

      try {
        const result = await processRefund(prisma, {
          reservationId: reservation.id,
          refundChoice,
        });
        return reply.send({ success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error procesando reembolso";
        return reply.status(409).send({ error: message });
      }
    }
  );
}
