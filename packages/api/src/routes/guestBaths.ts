import { FastifyInstance } from "fastify";
import { GuestBathIntentSchema, GuestBathConfirmSchema } from "@holidoginn/shared";
import { Prisma } from "@holidoginn/db";
import Stripe from "stripe";
import { createOptionalAuthMiddleware } from "../middleware/auth";
import { resolveOrCreateGuestUser } from "../lib/guestUser";
import { resolveOrCreateGuestPet } from "../lib/guestPet";
import { recordRequiredAcceptances } from "../lib/legal";
import { cartillaBlocks } from "../lib/cartilla";
import { sizeFromWeight, bathSizeKey } from "../lib/pricing";
import { quoteDelivery } from "../lib/delivery";
import { notifyUsers } from "../lib/notify";
import {
  BATH_DEPOSIT_AMOUNT,
  TZ_OFFSET_HOURS,
  buildSlotsForDay,
  isValidDateYMD,
  ensureConfig,
  describeBath,
  notifyBathBooked,
} from "./baths";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// ---------------------------------------------------------------------------
// Baño STANDALONE para invitados (tienda web, sin login obligatorio).
//   GET  /guest/baths/slots?date=YYYY-MM-DD  slots disponibles (público)
//   POST /guest/baths/create-intent          crea User+mascota (PENDING) + PI
//   POST /guest/baths/confirm                tras PI exitoso, crea la cita BATH
// Reutiliza los helpers de slots/config de routes/baths.ts (sin tocar móvil).
// ---------------------------------------------------------------------------
export default async function guestBathsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const optionalAuth = createOptionalAuthMiddleware(prisma);

  async function notifyAdminsNewCartilla(petId: string, petName: string, ownerName: string) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await notifyUsers(
      prisma,
      admins.map((a) => a.id),
      {
        type: "GENERAL",
        title: "Cartilla pendiente de revisión",
        body: `${ownerName} subió la cartilla de ${petName}. Revisa en Cartillas.`,
        data: { petId, kind: "CARTILLA_UPLOADED" },
      }
    );
  }

  // ── GET /guest/baths/slots — disponibilidad pública (sin auth) ──────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/guest/baths/slots",
    async (request, reply) => {
      const date = request.query.date;
      if (!date || !isValidDateYMD(date)) {
        return reply.status(400).send({ error: "Parámetro date=YYYY-MM-DD requerido" });
      }
      const cfg = await ensureConfig(prisma);
      if (!cfg.isActive) return { config: cfg, slots: [] };

      const allSlots = buildSlotsForDay(date, cfg);
      if (allSlots.length === 0) return { config: cfg, slots: [] };

      const dayStart = allSlots[0];
      const dayEnd = new Date(allSlots[allSlots.length - 1].getTime() + cfg.slotMinutes * 60000);
      const existing = await prisma.reservation.findMany({
        where: {
          reservationType: "BATH",
          status: { not: "CANCELLED" },
          appointmentAt: { gte: dayStart, lt: dayEnd },
        },
        select: { appointmentAt: true },
      });
      const countByIso = new Map<string, number>();
      for (const r of existing) {
        if (!r.appointmentAt) continue;
        const key = r.appointmentAt.toISOString();
        countByIso.set(key, (countByIso.get(key) ?? 0) + 1);
      }
      const now = Date.now();
      const slots = allSlots.map((start) => {
        const taken = countByIso.get(start.toISOString()) ?? 0;
        const remaining = Math.max(0, cfg.maxConcurrentBaths - taken);
        const inPast = start.getTime() <= now;
        return { startUtc: start.toISOString(), available: !inPast && remaining > 0, remaining, inPast };
      });
      return { config: cfg, slots };
    }
  );

  // ── POST /guest/baths/create-intent ─────────────────────────────────────
  fastify.post(
    "/guest/baths/create-intent",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const parsed = GuestBathIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const body = parsed.data;

      const resolved = await resolveOrCreateGuestUser(prisma, body.guest);
      if (!resolved.ok) return reply.status(resolved.status).send({ error: resolved.error });
      const owner = resolved.user;

      const ipAddress =
        (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
        request.ip ||
        null;
      const userAgent =
        typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null;
      await recordRequiredAcceptances(prisma, owner.id, { ipAddress, userAgent });

      // Crear (o reusar) la mascota inline (cartilla PENDING).
      const { pet, created } = await resolveOrCreateGuestPet(prisma, owner.id, body.pet);
      if (created && pet.cartillaStatus === "PENDING") {
        await notifyAdminsNewCartilla(pet.id, pet.name, `${owner.firstName} ${owner.lastName}`);
      }

      if (cartillaBlocks(pet, "web")) {
        return reply.status(400).send({ error: "La cartilla de la mascota no es válida" });
      }

      const cfg = await ensureConfig(prisma);
      if (!cfg.isActive) {
        return reply.status(400).send({ error: "Agenda de baños deshabilitada" });
      }

      const appointmentDate = new Date(body.appointmentAt);
      if (Number.isNaN(appointmentDate.getTime())) {
        return reply.status(400).send({ error: "appointmentAt inválido" });
      }
      if (appointmentDate.getTime() <= Date.now()) {
        return reply.status(400).send({ error: "El slot ya pasó" });
      }

      const ymdLocal = new Date(appointmentDate.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
      const dateYMD = `${ymdLocal.getUTCFullYear()}-${String(ymdLocal.getUTCMonth() + 1).padStart(2, "0")}-${String(ymdLocal.getUTCDate()).padStart(2, "0")}`;
      const validSlots = buildSlotsForDay(dateYMD, cfg);
      if (!validSlots.some((s) => s.getTime() === appointmentDate.getTime())) {
        return reply.status(400).send({ error: "Horario fuera de los slots configurados" });
      }

      const taken = await prisma.reservation.count({
        where: { reservationType: "BATH", status: { not: "CANCELLED" }, appointmentAt: appointmentDate },
      });
      if (taken >= cfg.maxConcurrentBaths) {
        return reply.status(409).send({ error: "Slot sin disponibilidad" });
      }

      const petSize = bathSizeKey(sizeFromWeight(pet.weight ?? 0));
      const bath = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bath) return reply.status(500).send({ error: "Servicio de baño no configurado" });
      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bath.id,
            petSize,
            deslanado: body.deslanado,
            corte: body.corte,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return reply.status(404).send({ error: "Variante de baño no encontrada" });
      }

      const price = Number(variant.price);
      let deliveryFee = 0;
      let deliveryDistanceKm = 0;
      let deliveryActive = false;
      if (
        body.homeDelivery &&
        Number.isFinite(body.homeDelivery.lat) &&
        Number.isFinite(body.homeDelivery.lng)
      ) {
        const quote = await quoteDelivery(prisma, body.homeDelivery.lat, body.homeDelivery.lng);
        if (quote.active) {
          deliveryActive = true;
          deliveryFee = quote.fee;
          deliveryDistanceKm = quote.distanceKm;
        }
      }
      const total = price + deliveryFee;
      const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
      const chargeBase = body.paymentType === "FULL" ? total : baseDeposit;
      const remainingAmount = total - chargeBase;

      if (chargeBase <= 0) {
        return reply.status(400).send({ error: "El total debe ser mayor a cero" });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(chargeBase * 100),
        currency: "mxn",
        automatic_payment_methods: { enabled: true },
        receipt_email: owner.email,
        metadata: {
          source: "web",
          ownerId: owner.id,
          petId: pet.id,
          type: "bath_appointment",
          variantId: variant.id,
          appointmentAt: appointmentDate.toISOString(),
          creditApplied: "0",
          depositAmount: String(chargeBase),
          paymentType: body.paymentType,
          ...(body.notes ? { notes: body.notes } : {}),
          ...(deliveryActive
            ? {
                deliveryFee: String(deliveryFee),
                deliveryDistanceKm: String(deliveryDistanceKm),
              }
            : {}),
        },
      });

      // La dirección del cliente (PII) NO va en el metadata de Stripe: se
      // persiste en DB asociada al PaymentIntent y se lee en el /confirm.
      if (deliveryActive && body.homeDelivery) {
        await prisma.pendingDeliveryAddress.create({
          data: {
            paymentIntentId: paymentIntent.id,
            address: body.homeDelivery.address,
            lat: body.homeDelivery.lat,
            lng: body.homeDelivery.lng,
          },
        });
      }

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        coveredByCredit: false,
        creditApplied: 0,
        price,
        depositAmount: chargeBase,
        remainingAmount,
        paymentType: body.paymentType,
        variantId: variant.id,
        deliveryFee,
        deliveryDistanceKm,
        deliveryActive,
      });
    }
  );

  // ── POST /guest/baths/confirm ───────────────────────────────────────────
  fastify.post(
    "/guest/baths/confirm",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const parsed = GuestBathConfirmSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { paymentIntentId } = parsed.data;

      // Idempotencia: si el PI ya creó la cita, devolverla.
      const existingPayment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        include: { reservation: true },
      });
      if (existingPayment?.reservation) {
        return reply
          .status(200)
          .send({ success: true, reservation: existingPayment.reservation, idempotent: true });
      }

      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      if (pi.metadata?.type !== "bath_appointment" || pi.metadata?.source !== "web") {
        return reply.status(400).send({ error: "PaymentIntent no corresponde a una cita web" });
      }

      const ownerId = String(pi.metadata.ownerId);
      const petId = String(pi.metadata.petId);
      const variantId = String(pi.metadata.variantId);
      const appointmentAtIso = String(pi.metadata.appointmentAt);
      const notes = typeof pi.metadata.notes === "string" ? pi.metadata.notes : undefined;
      const stripeAmount = pi.amount / 100;
      const chosenPaymentType: "DEPOSIT" | "FULL" =
        pi.metadata?.paymentType === "FULL" ? "FULL" : "DEPOSIT";
      let deliveryFee = 0;
      let deliveryDistanceKm = 0;
      let deliveryAddress: string | null = null;
      if (pi.metadata?.deliveryFee) {
        deliveryFee = Number(pi.metadata.deliveryFee);
        deliveryDistanceKm = Number(pi.metadata.deliveryDistanceKm || 0);
        // La dirección se lee de la DB (ya no del metadata de Stripe).
        const pendingDelivery = await prisma.pendingDeliveryAddress.findUnique({
          where: { paymentIntentId: pi.id },
        });
        deliveryAddress = pendingDelivery?.address ?? null;
      }

      const appointmentAt = new Date(appointmentAtIso);
      if (Number.isNaN(appointmentAt.getTime())) {
        return reply.status(400).send({ error: "appointmentAt inválido" });
      }

      const cfg = await ensureConfig(prisma);
      const variant = await prisma.serviceVariant.findUnique({ where: { id: variantId } });
      if (!variant) return reply.status(404).send({ error: "Variante no encontrada" });

      try {
        const result = await prisma.$transaction(async (tx) => {
          // Lock transaccional por slot (mismo namespace 42 que /baths/confirm):
          // serializa confirmaciones concurrentes del mismo horario para que el
          // count-then-create sea atómico y no se sobre-reserve el slot.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(42, hashtext(${appointmentAt.toISOString()}))`;
          const taken = await tx.reservation.count({
            where: { reservationType: "BATH", status: { not: "CANCELLED" }, appointmentAt },
          });
          if (taken >= cfg.maxConcurrentBaths) throw new Error("SLOT_TAKEN");

          const price = Number(variant.price);
          const total = price + deliveryFee;
          const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
          const paidNow = chosenPaymentType === "FULL" ? total : baseDeposit;
          const isPartial = paidNow < total;
          const reservation = await tx.reservation.create({
            data: {
              reservationType: "BATH",
              appointmentAt,
              status: "CONFIRMED",
              totalAmount: new Prisma.Decimal(total),
              notes,
              legalAccepted: true,
              paymentType: isPartial ? "DEPOSIT" : "FULL",
              depositDeadline: isPartial ? appointmentAt : null,
              ownerId,
              petId,
              ...(deliveryAddress
                ? {
                    homeDelivery: true,
                    homeDeliveryAddress: deliveryAddress,
                    homeDeliveryDistanceKm: deliveryDistanceKm,
                    homeDeliveryFee: new Prisma.Decimal(deliveryFee),
                  }
                : {}),
            },
          });

          const paymentStatus = isPartial ? "PARTIAL" : "PAID";
          const paymentLabel = isPartial
            ? `Anticipo baño — ${describeBath(variant.deslanado, variant.corte)}`
            : `Baño estandalone — ${describeBath(variant.deslanado, variant.corte)}`;

          const payment = await tx.payment.create({
            data: {
              amount: new Prisma.Decimal(stripeAmount),
              method: "STRIPE",
              status: paymentStatus,
              stripePaymentIntentId: paymentIntentId,
              paidAt: new Date(),
              notes: paymentLabel,
              reservationId: reservation.id,
              userId: ownerId,
            },
          });

          await tx.reservationAddon.create({
            data: {
              reservationId: reservation.id,
              variantId: variant.id,
              unitPrice: variant.price,
              paidWith: "BOOKING",
              paymentId: payment.id,
            },
          });

          return { reservation };
        });

        const pet = await prisma.pet.findUnique({ where: { id: petId }, select: { name: true } });
        if (pet) {
          await notifyBathBooked(prisma, {
            reservationId: result.reservation.id,
            petName: pet.name,
            appointmentAt,
            deslanado: variant.deslanado,
            corte: variant.corte,
            price: Number(variant.price),
          });
        }

        return reply.send({ success: true, reservation: result.reservation });
      } catch (err) {
        if (err instanceof Error && err.message === "SLOT_TAKEN") {
          return reply.status(409).send({ error: "El slot ya fue tomado" });
        }
        throw err;
      }
    }
  );
}
