import { FastifyInstance } from "fastify";
import { CreatePaymentSchema } from "@holidoginn/shared";
import { PetSize } from "@holidoginn/db";
import Stripe from "stripe";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { paymentReceivedTemplate, sendEmail } from "../lib/email";
import { notifyUser } from "../lib/notify";
import { LEGAL_DOC_VERSIONS, REQUIRED_FOR_BOOKING } from "../lib/legal";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

function sizeFromWeight(kg: number): PetSize {
  if (kg <= 5) return "S";
  if (kg <= 15) return "M";
  if (kg <= 24) return "L";
  return "XL";
}

function bathSizeKey(size: PetSize): PetSize {
  return size === "XS" ? "S" : size;
}

export default async function paymentsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();

  const isStaffOrAdmin = (role?: string) =>
    role === "ADMIN" || role === "STAFF";
  const isAdmin = (role?: string) => role === "ADMIN";

  // GET /payments/:reservationId — pagos de una reservación (owner o staff/admin)
  fastify.get<{ Params: { reservationId: string } }>(
    "/payments/:reservationId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.reservationId },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (!isStaffOrAdmin(request.userRole) && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const payments = await prisma.payment.findMany({
        where: { reservationId: request.params.reservationId },
        orderBy: { createdAt: "desc" },
      });
      return payments;
    }
  );

  // POST /payments — registrar pago (solo admin)
  fastify.post(
    "/payments",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const parsed = CreatePaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: parsed.data.reservationId },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const user = await prisma.user.findUnique({
        where: { id: parsed.data.userId },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      const payment = await prisma.payment.create({
        data: parsed.data,
      });
      return reply.status(201).send(payment);
    }
  );

  // POST /payments/create-intent — crear Stripe PaymentIntent
  fastify.post("/payments/create-intent", { preHandler: [authMiddleware] }, async (request, reply) => { try {
    const body = request.body as {
      petIds: string[];
      checkIn: string;
      checkOut: string;
      ownerId: string;
      roomPreference: "shared" | "separate";
      paymentType?: "FULL" | "DEPOSIT";
      bathSelectionsByPet?: Record<string, { deslanado: boolean; corte: boolean }>;
      medicationByPet?: Record<string, { notes: string }>;
    };

    const { petIds, checkIn, checkOut, ownerId, roomPreference, paymentType = "FULL", bathSelectionsByPet, medicationByPet } = body;

    if (!petIds?.length || !checkIn || !checkOut || !ownerId) {
      return reply.status(400).send({ error: "Faltan campos requeridos" });
    }

    // OWNER solo puede crear intent para sí mismo
    if (!isStaffOrAdmin(request.userRole) && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes crear pagos para tu propia cuenta" });
    }

    // Verify owner
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) return reply.status(404).send({ error: "Dueño no encontrado" });

    // Gate legal — bloquear ANTES de crear el PaymentIntent para no cobrar y
    // luego no poder crear la reserva.
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

    // Verify pets belong to owner
    const pets = await prisma.pet.findMany({
      where: { id: { in: petIds }, ownerId },
    });
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

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    if (checkOutDate <= checkInDate) {
      return reply.status(400).send({ error: "checkOut debe ser posterior a checkIn" });
    }

    const totalDays = Math.ceil(
      (checkOutDate.getTime() - checkInDate.getTime()) / 86_400_000
    );

    // Deposit requires at least 3 days before check-in AND a stay of 2+ nights
    if (paymentType === "DEPOSIT") {
      if (totalDays < 2) {
        return reply.status(400).send({
          error: "El anticipo no está disponible para estancias de una sola noche",
        });
      }
      const daysUntilCheckIn = (checkInDate.getTime() - Date.now()) / 86_400_000;
      if (daysUntilCheckIn < 3) {
        return reply.status(400).send({
          error: "El anticipo solo está disponible con 3 o más días de anticipación al check-in",
        });
      }
    }

    // Calculate total — lodging
    const breakdown = pets.map((pet) => {
      const pricePerDay = pet.weight && pet.weight >= 20 ? 450 : 350;
      return {
        petId: pet.id,
        petName: pet.name,
        weight: pet.weight ?? 0,
        pricePerDay,
        subtotal: pricePerDay * totalDays,
      };
    });

    // Add bath addons to total (if any)
    let bathTotal = 0;
    const bathBreakdown: Array<{ petId: string; variantId: string; price: number }> = [];
    if (bathSelectionsByPet && Object.keys(bathSelectionsByPet).length > 0) {
      const bath = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (bath) {
        for (const [petId, sel] of Object.entries(bathSelectionsByPet)) {
          const pet = pets.find((p) => p.id === petId);
          if (!pet) continue;
          const size = bathSizeKey(sizeFromWeight(pet.weight ?? 0));
          const variant = await prisma.serviceVariant.findUnique({
            where: {
              serviceTypeId_petSize_deslanado_corte: {
                serviceTypeId: bath.id,
                petSize: size,
                deslanado: sel.deslanado,
                corte: sel.corte,
              },
            },
          });
          if (!variant || !variant.isActive) {
            return reply.status(400).send({
              error: `Variante de baño no disponible para ${pet.name}`,
            });
          }
          const price = Number(variant.price);
          bathTotal += price;
          bathBreakdown.push({ petId, variantId: variant.id, price });
        }
      }
    }

    // Medication surcharge: +10% on lodging for each pet on medication (notes required)
    const medicationBreakdown: Array<{ petId: string; surcharge: number }> = [];
    let medicationTotal = 0;
    if (medicationByPet && Object.keys(medicationByPet).length > 0) {
      for (const [petId, sel] of Object.entries(medicationByPet)) {
        if (!sel?.notes || sel.notes.trim().length === 0) {
          return reply.status(400).send({
            error: "Las instrucciones de administración del medicamento son obligatorias",
          });
        }
        const petLodging = breakdown.find((b) => b.petId === petId);
        if (!petLodging) continue;
        const surcharge = Math.ceil(petLodging.subtotal * 0.10);
        medicationTotal += surcharge;
        medicationBreakdown.push({ petId, surcharge });
      }
    }

    const baseTotal = breakdown.reduce((sum, b) => sum + b.subtotal, 0) + bathTotal + medicationTotal;

    // Same-day surcharge: OWNER booking < 24h before check-in pays +20%
    const hoursUntilCheckIn = (checkInDate.getTime() - Date.now()) / (60 * 60 * 1000);
    const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
    const surchargeAmount = sameDaySurcharge ? Math.ceil(baseTotal * 0.20) : 0;

    const grandTotal = baseTotal + surchargeAmount;
    const depositAmountBase = paymentType === "DEPOSIT" ? Math.ceil(grandTotal * 0.20) : grandTotal;

    // Apply credit balance before Stripe charge
    const ownerCredit = Number(owner.creditBalance || 0);
    const creditApplied = Math.min(ownerCredit, depositAmountBase);
    const chargeAmount = depositAmountBase - creditApplied;

    const remainingAmount = grandTotal - depositAmountBase;
    const depositDeadline = paymentType === "DEPOSIT"
      ? new Date(checkInDate.getTime() - 48 * 60 * 60 * 1000).toISOString()
      : null;

    // If credit covers full amount, skip Stripe
    if (chargeAmount === 0) {
      return reply.send({
        clientSecret: null,
        paymentIntentId: null,
        coveredByCredit: true,
        creditApplied,
        grandTotal,
        depositAmount: depositAmountBase,
        remainingAmount,
        depositDeadline,
        paymentType,
        breakdown,
        bathBreakdown,
        bathTotal,
        totalDays,
        sameDaySurcharge,
        surchargeAmount,
        medicationBreakdown,
        medicationTotal,
      });
    }

    // Create Stripe PaymentIntent (amount in centavos)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(chargeAmount * 100),
      currency: "mxn",
      metadata: {
        ownerId,
        petIds: petIds.join(","),
        checkIn,
        checkOut,
        roomPreference,
        totalDays: String(totalDays),
        paymentType,
        bathBreakdown: bathBreakdown.length > 0 ? JSON.stringify(bathBreakdown) : "",
        sameDaySurcharge: sameDaySurcharge ? "1" : "0",
        creditApplied: String(creditApplied),
      },
    });

    return reply.send({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      coveredByCredit: false,
      creditApplied,
      grandTotal,
      depositAmount: depositAmountBase,
      remainingAmount,
      depositDeadline,
      paymentType,
      breakdown,
      bathBreakdown,
      bathTotal,
      totalDays,
      sameDaySurcharge,
      surchargeAmount,
      medicationBreakdown,
      medicationTotal,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: err?.message || "Error interno del servidor" });
  }
  });

  // POST /payments/pay-balance — crear intent para liquidar saldo pendiente
  fastify.post("/payments/pay-balance", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { reservationId } = request.body as { reservationId: string };

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { payments: true, pet: true },
    });

    if (!reservation) {
      return reply.status(404).send({ error: "Reservación no encontrada" });
    }
    if (!isStaffOrAdmin(request.userRole) && reservation.ownerId !== request.userId) {
      return reply.status(403).send({ error: "No autorizado" });
    }
    if (reservation.status === "CANCELLED") {
      return reply.status(400).send({ error: "Esta reservación fue cancelada" });
    }

    const totalPaid = reservation.payments
      .filter((p) => p.status === "PAID")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Number(reservation.totalAmount) - totalPaid;

    if (remaining <= 0) {
      return reply.status(400).send({ error: "No hay saldo pendiente" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(remaining * 100),
      currency: "mxn",
      metadata: {
        reservationId,
        type: "balance",
      },
    });

    return reply.send({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      remaining,
    });
  });

  // POST /payments/confirm-balance — confirmar pago del saldo
  fastify.post("/payments/confirm-balance", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { reservationId, stripePaymentIntentId } = request.body as {
      reservationId: string;
      stripePaymentIntentId: string;
    };

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation) {
      return reply.status(404).send({ error: "Reservación no encontrada" });
    }
    if (!isStaffOrAdmin(request.userRole) && reservation.ownerId !== request.userId) {
      return reply.status(403).send({ error: "No autorizado" });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
    if (paymentIntent.status !== "succeeded") {
      return reply.status(400).send({ error: "El pago no fue completado" });
    }

    await prisma.payment.create({
      data: {
        amount: paymentIntent.amount / 100,
        method: "STRIPE",
        status: "PAID",
        stripePaymentIntentId,
        paidAt: new Date(),
        reservationId,
        userId: reservation.ownerId,
      },
    });

    // Balance paid — change status from PENDING to CONFIRMED
    if (reservation.status === "PENDING") {
      await prisma.reservation.update({
        where: { id: reservationId },
        data: { status: "CONFIRMED" },
      });
    }

    // Email "pago recibido"
    const owner = await prisma.user.findUnique({
      where: { id: reservation.ownerId },
      select: { email: true, firstName: true },
    });
    const pet = await prisma.pet.findUnique({
      where: { id: reservation.petId },
      select: { name: true },
    });
    if (owner?.email && pet) {
      const tpl = paymentReceivedTemplate({
        ownerFirstName: owner.firstName,
        amount: paymentIntent.amount / 100,
        petName: pet.name,
        method: "CARD",
        reservationStatus: "CONFIRMED",
      });
      await sendEmail({ to: owner.email, ...tpl });
    }

    // Notificación + push in-app
    if (pet) {
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "PAYMENT_RECEIVED",
        title: "Pago recibido ✅",
        body: `Se registró tu pago de $${(paymentIntent.amount / 100).toLocaleString("es-MX")} para la estancia de ${pet.name}.`,
        data: { reservationId, amount: paymentIntent.amount / 100 },
      });
    }

    return reply.send({ success: true });
  });

  // ─── POST /admin/payments/manual — registro de pago manual ────
  fastify.post<{
    Body: {
      reservationId: string;
      amount: number;
      method: "CASH" | "TRANSFER";
      notes?: string;
    };
  }>(
    "/admin/payments/manual",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, reply) => {
      const { reservationId, amount, method, notes } = request.body;

      if (!reservationId || !amount || !method) {
        return reply.status(400).send({ error: "Faltan campos requeridos" });
      }
      if (amount <= 0) {
        return reply.status(400).send({ error: "El monto debe ser positivo" });
      }
      if (!["CASH", "TRANSFER"].includes(method)) {
        return reply.status(400).send({ error: "Método inválido" });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { payments: true, pet: { select: { name: true } } },
      });

      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const payment = await prisma.payment.create({
        data: {
          amount,
          method,
          status: "PAID",
          paidAt: new Date(),
          reservationId,
          userId: reservation.ownerId,
          notes: notes || `Pago manual registrado por admin (${method})`,
        },
      });

      // Check if reservation is now fully paid and update status if needed
      const totalPaid = reservation.payments
        .filter((p) => p.status === "PAID")
        .reduce((sum, p) => sum + Number(p.amount), 0) + amount;

      if (
        totalPaid >= Number(reservation.totalAmount) - 0.01 &&
        reservation.status === "PENDING"
      ) {
        await prisma.reservation.update({
          where: { id: reservationId },
          data: { status: "CONFIRMED" },
        });
      }

      // Notificar al owner (in-app + push)
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "PAYMENT_RECEIVED" as any,
        title: "Pago registrado",
        body: `Se registró un pago de $${amount.toLocaleString("es-MX")} (${method === "CASH" ? "efectivo" : "transferencia"}) para la estancia de ${reservation.pet.name}.`,
        data: { reservationId, paymentId: payment.id },
      });

      return reply.status(201).send(payment);
    }
  );
}
