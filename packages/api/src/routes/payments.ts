import { FastifyInstance } from "fastify";
import { CreatePaymentSchema } from "@holidoginn/shared";
import Stripe from "stripe";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { paymentReceivedTemplate, sendEmail } from "../lib/email";
import { notifyUser } from "../lib/notify";
import { LEGAL_DOC_VERSIONS, REQUIRED_FOR_BOOKING } from "../lib/legal";
import {
  getLodgingPricing,
  pricePerDayForWeight,
  sizeFromWeight,
  bathSizeKey,
} from "../lib/pricing";
import { quoteDelivery } from "../lib/delivery";
import { resolveDiscount } from "../lib/discounts";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

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

      // Checks de existencia en paralelo (antes eran 2 round-trips seriales).
      const [reservation, user] = await Promise.all([
        prisma.reservation.findUnique({
          where: { id: parsed.data.reservationId },
        }),
        prisma.user.findUnique({
          where: { id: parsed.data.userId },
        }),
      ]);
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
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
      homeDelivery?: { address: string; lat: number; lng: number; placeId?: string };
      discountCode?: string;
    };

    const { petIds, checkIn, checkOut, ownerId, roomPreference, paymentType = "FULL", bathSelectionsByPet, medicationByPet, homeDelivery, discountCode } = body;

    if (!petIds?.length || !checkIn || !checkOut || !ownerId) {
      return reply.status(400).send({ error: "Faltan campos requeridos" });
    }

    // OWNER solo puede crear intent para sí mismo
    if (!isStaffOrAdmin(request.userRole) && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes crear pagos para tu propia cuenta" });
    }

    // Todas las consultas independientes en paralelo — en serie sumaban ~1s de
    // latencia acumulada contra DB/Google antes de siquiera llamar a Stripe.
    const wantsBath =
      !!bathSelectionsByPet && Object.keys(bathSelectionsByPet).length > 0;
    const wantsDelivery =
      !!homeDelivery &&
      Number.isFinite(homeDelivery.lat) &&
      Number.isFinite(homeDelivery.lng);
    const [owner, acceptances, pets, pricingConfig, bathService, deliveryQuote] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: ownerId } }),
        prisma.legalAcceptance.findMany({
          where: { userId: ownerId },
          select: { documentType: true, version: true },
        }),
        prisma.pet.findMany({ where: { id: { in: petIds }, ownerId } }),
        getLodgingPricing(prisma),
        wantsBath
          ? prisma.serviceType.findUnique({ where: { code: "BATH" } })
          : null,
        wantsDelivery
          ? quoteDelivery(prisma, homeDelivery!.lat, homeDelivery!.lng)
          : null,
      ]);

    if (!owner) return reply.status(404).send({ error: "Dueño no encontrado" });

    // Gate legal — bloquear ANTES de crear el PaymentIntent para no cobrar y
    // luego no poder crear la reserva.
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
      const pricePerDay = pricePerDayForWeight(pet.weight, pricingConfig);
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
    if (wantsBath && bathService) {
      // Lookups de variantes en paralelo (antes: un query por mascota en serie).
      const entries = Object.entries(bathSelectionsByPet!).filter(([petId]) =>
        pets.some((p) => p.id === petId)
      );
      const variants = await Promise.all(
        entries.map(([petId, sel]) => {
          const pet = pets.find((p) => p.id === petId)!;
          const size = bathSizeKey(sizeFromWeight(pet.weight ?? 0));
          return prisma.serviceVariant.findUnique({
            where: {
              serviceTypeId_petSize_deslanado_corte: {
                serviceTypeId: bathService.id,
                petSize: size,
                deslanado: sel.deslanado,
                corte: sel.corte,
              },
            },
          });
        })
      );
      for (let i = 0; i < entries.length; i++) {
        const [petId] = entries[i];
        const variant = variants[i];
        if (!variant || !variant.isActive) {
          const pet = pets.find((p) => p.id === petId)!;
          return reply.status(400).send({
            error: `Variante de baño no disponible para ${pet.name}`,
          });
        }
        const price = Number(variant.price);
        bathTotal += price;
        bathBreakdown.push({ petId, variantId: variant.id, price });
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

    // Código de descuento (alcance reservas). Aplica sobre el subtotal del
    // servicio (hospedaje + baño + medicación); NO sobre el envío a domicilio.
    // El monto es autoritativo (server-side) y viaja en el metadata del PI para
    // que /reservations/multi lo persista al confirmar.
    const discount = await resolveDiscount(prisma, {
      code: discountCode,
      subtotal: baseTotal,    });
    if (discount.error) {
      return reply.status(400).send({ error: discount.error });
    }
    const discountTotal = discount.discountTotal;
    const discountedBase = baseTotal - discountTotal;

    // Same-day surcharge: OWNER booking < 24h before check-in pays +20%
    // (sobre la base YA descontada, para que cuadre con el cargo de Stripe).
    const hoursUntilCheckIn = (checkInDate.getTime() - Date.now()) / (60 * 60 * 1000);
    const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
    const surchargeAmount = sameDaySurcharge ? Math.ceil(discountedBase * 0.20) : 0;

    // Servicio a domicilio — fee RE-CALCULADA server-side desde lat/lng (no se
    // confía en el cliente). Es un costo logístico fijo: NO aplica el recargo
    // mismo-día (+20%), pero SÍ entra en la base del anticipo (20% del total).
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    let deliveryActive = false;
    if (deliveryQuote?.active) {
      deliveryActive = true;
      deliveryFee = deliveryQuote.fee;
      deliveryDistanceKm = deliveryQuote.distanceKm;
    }

    const grandTotal = discountedBase + surchargeAmount + deliveryFee;
    const depositAmountBase = paymentType === "DEPOSIT" ? Math.ceil(grandTotal * 0.20) : grandTotal;

    // Apply credit balance before Stripe charge
    const ownerCredit = Number(owner.creditBalance || 0);
    const creditApplied = Math.min(ownerCredit, depositAmountBase);
    const chargeAmount = depositAmountBase - creditApplied;

    const remainingAmount = grandTotal - depositAmountBase;
    // Deposit deadline = check-in day. Owner can pay the balance in the app or
    // in person at the branch on arrival.
    const depositDeadline = paymentType === "DEPOSIT"
      ? checkInDate.toISOString()
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
        deliveryFee,
        deliveryDistanceKm,
        deliveryActive,
        discountTotal,
        discountCode: discount.dc?.code ?? null,
      });
    }

    // Guard against amounts Stripe will reject. MXN minimum charge is $0.50;
    // a non-finite or sub-minimum chargeAmount (e.g. credit leaves $0.30) would
    // otherwise fail at PaymentIntent confirmation with a generic 500.
    if (!Number.isFinite(chargeAmount) || chargeAmount < 0.5) {
      return reply.status(400).send({
        error: "El monto a cobrar es inválido o menor al mínimo permitido ($0.50 MXN).",
      });
    }

    // Create Stripe PaymentIntent (amount in centavos)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(chargeAmount * 100),
      currency: "mxn",
      automatic_payment_methods: { enabled: true },
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
        deliveryFee: deliveryActive ? String(deliveryFee) : "",
        discountCode: discount.dc?.code ?? "",
        discountCodeId: discount.discountCodeId ?? "",
        discountTotal: String(discountTotal),
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
      deliveryFee,
      deliveryDistanceKm,
      deliveryActive,
      discountTotal,
      discountCode: discount.dc?.code ?? null,
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

    // Count both PAID (full) and PARTIAL (deposit) payments — both represent
    // money the owner has already paid. Excluding PARTIAL would double-charge
    // the deposit when the balance is settled.
    const totalPaid = reservation.payments
      .filter((p) => p.status === "PAID" || p.status === "PARTIAL")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Number(reservation.totalAmount) - totalPaid;

    if (remaining <= 0) {
      return reply.status(400).send({ error: "No hay saldo pendiente" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(remaining * 100),
      currency: "mxn",
      automatic_payment_methods: { enabled: true },
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

    // Email "pago recibido" — lookups en paralelo (antes 2 seriales).
    const [owner, pet] = await Promise.all([
      prisma.user.findUnique({
        where: { id: reservation.ownerId },
        select: { email: true, firstName: true },
      }),
      prisma.pet.findUnique({
        where: { id: reservation.petId },
        select: { name: true },
      }),
    ]);
    if (owner?.email && pet) {
      const tpl = paymentReceivedTemplate({
        ownerFirstName: owner.firstName,
        amount: paymentIntent.amount / 100,
        petName: pet.name,
        method: "CARD",
        reservationStatus: "CONFIRMED",
      });
      // Fire-and-forget: el correo no debe bloquear la respuesta.
      sendEmail({ to: owner.email, ...tpl }).catch((err) =>
        fastify.log.error({ err }, "sendEmail(pago saldo) falló")
      );
    }

    // Notificación + push in-app (fire-and-forget)
    if (pet) {
      notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "PAYMENT_RECEIVED",
        title: "Pago recibido ✅",
        body: `Se registró tu pago de $${(paymentIntent.amount / 100).toLocaleString("es-MX")} para la estancia de ${pet.name}.`,
        data: { reservationId, amount: paymentIntent.amount / 100 },
      }).catch((err) => fastify.log.error({ err }, "notifyUser(pago saldo) falló"));
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

      return reply.status(201).send(payment);
    }
  );
}
