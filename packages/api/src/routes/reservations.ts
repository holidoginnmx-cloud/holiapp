import { FastifyInstance } from "fastify";
import {
  CreateReservationSchema,
  CreateMultiReservationSchema,
  UpdateReservationStatusSchema,
  ReservationStatus,
  CancelReservationSchema,
} from "@holidoginn/shared";
import { Prisma, PetSize, ReservationStatus as PrismaResStatus } from "@holidoginn/db";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { notifyBathContracted } from "./services";
import { createAuthMiddleware } from "../middleware/auth";
import {
  reservationConfirmedTemplate,
  refundIssuedTemplate,
  sendEmail,
} from "../lib/email";
import { notifyUser, notifyUsers } from "../lib/notify";
import { LEGAL_DOC_VERSIONS, REQUIRED_FOR_BOOKING } from "../lib/legal";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

export default async function reservationsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // Auto-cancel overdue deposit reservations
  async function cancelOverdueDeposits() {
    const overdue = await prisma.reservation.findMany({
      where: {
        paymentType: "DEPOSIT",
        depositDeadline: { lt: new Date() },
        status: "CONFIRMED",
      },
      include: { payments: true },
    });
    for (const res of overdue) {
      const totalPaid = res.payments
        .filter((p) => p.status === "PAID")
        .reduce((sum, p) => sum + Number(p.amount), 0);
      if (totalPaid < Number(res.totalAmount)) {
        await prisma.reservation.update({
          where: { id: res.id },
          data: { status: "CANCELLED" },
        });
      }
    }
  }

  // GET /reservations — listar (acepta query ?ownerId= y ?status=)
  // OWNER siempre queda filtrado a sus propias reservas; STAFF/ADMIN pueden filtrar libremente.
  fastify.get<{
    Querystring: { ownerId?: string; status?: ReservationStatus };
  }>("/reservations", { preHandler: [authMiddleware] }, async (request) => {
    await cancelOverdueDeposits();
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
          select: { id: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return reservations.map(({ changeRequests, updates, review, ...r }) => ({
      ...r,
      hasPendingChangeRequest: (changeRequests?.length ?? 0) > 0,
      lastUpdateAt: updates?.[0]?.createdAt ?? null,
      hasReview: !!review,
    }));
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
          updates: { orderBy: { createdAt: "desc" } },
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

    const { checkIn, checkOut, ownerId, petId, roomId, notes, legalAccepted } = parsed.data;

    // OWNER solo puede reservar para sí mismo; STAFF/ADMIN pueden reservar en nombre de cualquiera.
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    if (!isStaffOrAdmin && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes reservar para tu propia cuenta" });
    }

    if (checkOut <= checkIn) {
      return reply
        .status(400)
        .send({ error: "checkOut debe ser posterior a checkIn" });
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

    // Verify room exists
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return reply.status(404).send({ error: "Cuarto no encontrado" });
    }

    // Calculate totalDays and totalAmount (weight-based pricing)
    const diffMs = checkOut.getTime() - checkIn.getTime();
    const totalDays = Math.ceil(diffMs / 86_400_000);
    const pricePerDay = pet.weight && pet.weight >= 20 ? 450 : 350;
    const totalAmount = new Prisma.Decimal(pricePerDay).mul(totalDays);

    const reservation = await prisma.reservation.create({
      data: {
        checkIn,
        checkOut,
        totalDays,
        totalAmount,
        notes,
        legalAccepted,
        status: "PENDING",
        ownerId,
        petId,
        roomId,
      },
      include: { pet: true, room: true },
    });
    return reply.status(201).send(reservation);
  });

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

  // ── Helper: find available room for a pet size + dates ──
  async function findAvailableRoom(petSize: PetSize, checkIn: Date, checkOut: Date) {
    const rooms = await prisma.room.findMany({
      where: {
        isActive: true,
        sizeAllowed: { has: petSize },
        reservations: {
          none: {
            status: { notIn: ["CANCELLED", "CHECKED_OUT"] as PrismaResStatus[] },
            AND: [
              { checkIn: { lt: checkOut } },
              { checkOut: { gt: checkIn } },
            ],
          },
        },
      },
      orderBy: { pricePerDay: "asc" },
    });
    return rooms[0] ?? null;
  }

  function sizeFromWeight(kg: number): PetSize {
    if (kg <= 5) return "S";
    if (kg <= 15) return "M";
    if (kg <= 24) return "L";
    return "XL";
  }

  // POST /reservations/multi — crear reservaciones para múltiples mascotas
  fastify.post("/reservations/multi", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = CreateMultiReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { checkIn, checkOut, ownerId, petIds, notes, legalAccepted, roomPreference, stripePaymentIntentId, paymentType, bathSelectionsByPet, medicationByPet } = parsed.data;

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
    if (stripePaymentIntentId) {
      paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      creditApplied = Number(paymentIntent.metadata?.creditApplied ?? 0);
    }

    // Verify owner
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) return reply.status(404).send({ error: "Dueño no encontrado" });

    // Verify all pets belong to owner
    const pets = await prisma.pet.findMany({ where: { id: { in: petIds }, ownerId } });
    if (pets.length !== petIds.length) {
      return reply.status(400).send({ error: "Una o más mascotas no pertenecen al dueño" });
    }

    // Cartilla guard: block pets without APPROVED cartilla
    const blocked = pets.filter((p) => p.cartillaStatus !== "APPROVED");
    if (blocked.length > 0) {
      const names = blocked.map((p) => p.name).join(", ");
      return reply.status(400).send({
        error: `Cartilla pendiente de aprobación: ${names}. Sube la cartilla y espera el visto bueno del equipo HDI.`,
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

    // Determine sizes
    const petSizes = pets.map((p) => ({
      pet: p,
      size: sizeFromWeight(p.weight ?? 0),
      pricePerDay: p.weight && p.weight >= 20 ? 450 : 350,
    }));

    // Find rooms
    const assignments: { petId: string; roomId: string | null; amount: number }[] = [];

    if (roomPreference === "shared") {
      // Find room for the largest pet size
      const sizeOrder: PetSize[] = ["XS", "S", "M", "L", "XL"];
      const largestSize = petSizes.reduce((max, ps) =>
        sizeOrder.indexOf(ps.size) > sizeOrder.indexOf(max) ? ps.size : max,
        petSizes[0].size
      );
      const room = await findAvailableRoom(largestSize, checkIn, checkOut);
      if (!room) {
        return reply.status(400).send({
          error: `No hay cuartos disponibles para tamaño ${largestSize} en las fechas seleccionadas`,
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
      // Separate: find a room per pet
      for (const ps of petSizes) {
        const room = await findAvailableRoom(ps.size, checkIn, checkOut);
        if (!room) {
          return reply.status(400).send({
            error: `No hay cuartos disponibles para ${ps.pet.name} (tamaño ${ps.size}) en las fechas seleccionadas`,
          });
        }
        assignments.push({
          petId: ps.pet.id,
          roomId: room.id,
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

    // Same-day surcharge: OWNER booking < 24h before check-in pays +20%
    const hoursUntilCheckIn = (checkIn.getTime() - Date.now()) / (60 * 60 * 1000);
    const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
    const surchargeMultiplier = sameDaySurcharge ? 1.20 : 1;
    const grandTotal = baseTotal * surchargeMultiplier;

    const operations = [];
    for (const a of assignments) {
      const bath = bathByPet.get(a.petId);
      const medSurcharge = medicationSurchargeByPet.get(a.petId) ?? 0;
      const medNotes = medicationNotesByPet.get(a.petId) ?? null;
      const reservationAmount = (a.amount + (bath?.price ?? 0) + medSurcharge) * surchargeMultiplier;
      operations.push(
        prisma.reservation.create({
          data: {
            checkIn,
            checkOut,
            totalDays,
            totalAmount: new Prisma.Decimal(reservationAmount),
            notes,
            medicationNotes: medNotes,
            legalAccepted,
            status: paymentType === "DEPOSIT" ? "PENDING" : "CONFIRMED",
            groupId,
            paymentType,
            depositDeadline: paymentType === "DEPOSIT"
              ? new Date(checkIn.getTime() - 48 * 60 * 60 * 1000)
              : null,
            ownerId,
            petId: a.petId,
            roomId: a.roomId,
          },
          include: { pet: true, room: true },
        })
      );
    }

    const reservations = await prisma.$transaction(operations);

    // Register payment for each reservation
    const isDeposit = paymentType === "DEPOSIT";
    for (let i = 0; i < reservations.length; i++) {
      const res = reservations[i];
      const paidAmount = isDeposit
        ? new Prisma.Decimal(Number(res.totalAmount) * 0.20)
        : res.totalAmount;
      const payment = await prisma.payment.create({
        data: {
          amount: paidAmount,
          method: "STRIPE",
          status: isDeposit ? "PARTIAL" : "PAID",
          stripePaymentIntentId: i === 0 ? stripePaymentIntentId : null,
          paidAt: new Date(),
          notes: isDeposit ? "Anticipo 20%" : null,
          reservationId: res.id,
          userId: ownerId,
        },
      });

      // Persist bath addon attached to this reservation's payment
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
        // Notify staff (unassigned at this point, so only admins) + assigned staff if any
        const variantRow = await prisma.serviceVariant.findUnique({
          where: { id: bath.variantId },
        });
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

    // Deduct credit applied (if any) and write ledger entry
    if (creditApplied > 0) {
      const updatedOwner = await prisma.user.update({
        where: { id: ownerId },
        data: { creditBalance: { decrement: creditApplied } },
      });
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

    // Notificar a todos los staff de nueva reservación disponible
    const petNames = reservations.map((r: any) => r.pet?.name).filter(Boolean).join(", ");
    const staffUsers = await prisma.user.findMany({
      where: { role: "STAFF", isActive: true },
      select: { id: true },
    });
    if (staffUsers.length > 0) {
      await notifyUsers(prisma, staffUsers.map((s) => s.id), {
        type: "NEW_RESERVATION" as any,
        title: "Nueva reservación creada 🐾",
        body: `Se creó una reservación para ${petNames || "una mascota"}. Revisa si necesitas asignarte.`,
        data: { reservationId: reservations[0]?.id },
      });
    }

    // Email de confirmación al dueño
    if (owner.email) {
      const depositAmount = paymentType === "DEPOSIT" ? grandTotal * 0.20 : grandTotal;
      const remainingAmount = grandTotal - depositAmount;
      const roomNames = [...new Set(reservations.map((r: any) => r.room?.name).filter(Boolean))];
      const tpl = reservationConfirmedTemplate({
        ownerFirstName: owner.firstName,
        petNames: reservations.map((r: any) => r.pet.name),
        checkIn,
        checkOut,
        roomName: roomNames.length === 1 ? (roomNames[0] as string) : null,
        totalAmount: grandTotal,
        paymentType: paymentType as "FULL" | "DEPOSIT",
        remainingAmount,
      });
      await sendEmail({ to: owner.email, ...tpl });
    }

    return reply.status(201).send({ reservations, grandTotal, groupId, creditApplied });
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
        include: { payments: true, pet: true },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (!["PENDING", "CONFIRMED"].includes(reservation.status)) {
        return reply.status(400).send({
          error: "Solo puedes cancelar reservaciones pendientes o confirmadas",
        });
      }

      const paidPayments = reservation.payments.filter((p) => p.status === "PAID");
      const refundAmount = paidPayments.reduce((s, p) => s + Number(p.amount), 0);
      const lastStripePayment = paidPayments
        .filter((p) => p.stripePaymentIntentId)
        .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0];

      if (refundChoice === "STRIPE_REFUND" && !lastStripePayment) {
        return reply.status(409).send({
          error: "El pago original no fue con tarjeta; elige saldo a favor",
        });
      }

      // Cargar email del dueño (para notificación post-transacción)
      const ownerForEmail = await prisma.user.findUnique({
        where: { id: reservation.ownerId },
        select: { email: true, firstName: true },
      });

      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: "CANCELLED" },
        });

        if (refundAmount > 0) {
          if (refundChoice === "STRIPE_REFUND" && lastStripePayment?.stripePaymentIntentId) {
            const refund = await stripe.refunds.create({
              payment_intent: lastStripePayment.stripePaymentIntentId,
              amount: Math.round(refundAmount * 100),
            });
            await tx.payment.create({
              data: {
                amount: refundAmount,
                method: "STRIPE",
                status: "REFUNDED",
                stripePaymentIntentId: refund.id,
                paidAt: new Date(),
                reservationId: reservation.id,
                userId: reservation.ownerId,
                notes: `Reembolso por cancelación de reservación`,
              },
            });
            // Notificación se hace fuera del $transaction (side-effect con push)
          } else {
            const updatedUser = await tx.user.update({
              where: { id: reservation.ownerId },
              data: { creditBalance: { increment: refundAmount } },
            });
            await tx.creditLedger.create({
              data: {
                userId: reservation.ownerId,
                type: "CREDIT_ADDED",
                amount: refundAmount,
                balanceAfter: Number(updatedUser.creditBalance),
                description: `Saldo por cancelación de reservación de ${reservation.pet.name}`,
                reservationId: reservation.id,
              },
            });
            // Notificación se hace fuera del $transaction (side-effect con push)
          }
        }
      });

      // Notificación + push post-commit
      if (refundAmount > 0) {
        if (refundChoice === "STRIPE_REFUND" && lastStripePayment?.stripePaymentIntentId) {
          await notifyUser(prisma, {
            userId: reservation.ownerId,
            type: "REFUND_ISSUED",
            title: "Reembolso procesado 💳",
            body: `Te reembolsamos $${refundAmount.toLocaleString("es-MX")} por la cancelación de ${reservation.pet.name}.`,
            data: { reservationId: reservation.id, amount: refundAmount },
          });
        } else {
          await notifyUser(prisma, {
            userId: reservation.ownerId,
            type: "CREDIT_ADDED",
            title: "Saldo a favor acreditado 💰",
            body: `Se acreditaron $${refundAmount.toLocaleString("es-MX")} a tu saldo por la cancelación de ${reservation.pet.name}.`,
            data: { reservationId: reservation.id, amount: refundAmount },
          });
        }
      }

      // Email post-cancelación
      if (refundAmount > 0 && ownerForEmail?.email) {
        const tpl = refundIssuedTemplate({
          ownerFirstName: ownerForEmail.firstName,
          amount: refundAmount,
          petName: reservation.pet.name,
          channel: refundChoice === "STRIPE_REFUND" ? "STRIPE" : "CREDIT",
        });
        await sendEmail({ to: ownerForEmail.email, ...tpl });
      }

      return reply.send({ success: true, refundAmount, refundChoice });
    }
  );
}
