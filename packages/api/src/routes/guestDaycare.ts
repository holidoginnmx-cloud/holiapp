import { FastifyInstance } from "fastify";
import {
  GuestDaycareIntentSchema,
  GuestDaycareConfirmSchema,
} from "@holidoginn/shared";
import Stripe from "stripe";
import { createOptionalAuthMiddleware } from "../middleware/auth";
import { resolveOrCreateGuestUser } from "../lib/guestUser";
import { resolveOrCreateGuestPet } from "../lib/guestPet";
import { recordRequiredAcceptances } from "../lib/legal";
import { quoteDelivery } from "../lib/delivery";
import { notifyUsers } from "../lib/notify";
import { getLodgingPricing, computeDaycareHours } from "../lib/pricing";
import {
  createDaycareGroup,
  countDaycareOccupancy,
  daycareDayRange,
} from "../lib/daycareCreate";
import {
  validateDaycareWindow,
  daycareAvailabilityPayload,
} from "./daycare";
import { isValidDateYMD } from "./baths";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// ---------------------------------------------------------------------------
// Guardería para invitados (tienda web, sin login obligatorio).
//   GET  /guest/daycare/availability?date=   cupo/tarifa del día (público)
//   POST /guest/daycare/create-intent        crea User+mascotas (PENDING) + PI
//   POST /guest/daycare/confirm              tras PI exitoso, crea el grupo
// Espejo de guestBaths.ts; la guardería NO exige cartilla aprobada.
// ---------------------------------------------------------------------------
export default async function guestDaycareRoutes(fastify: FastifyInstance) {
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

  // ── GET /guest/daycare/availability — cupo público (sin auth) ───────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/guest/daycare/availability",
    async (request, reply) => {
      const date = request.query.date;
      if (!date || !isValidDateYMD(date)) {
        return reply
          .status(400)
          .send({ error: "Parámetro date=YYYY-MM-DD requerido" });
      }
      return daycareAvailabilityPayload(prisma, date);
    }
  );

  // ── POST /guest/daycare/create-intent ────────────────────────────────────
  fastify.post(
    "/guest/daycare/create-intent",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const parsed = GuestDaycareIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const body = parsed.data;

      const windowError = validateDaycareWindow(
        body.date,
        body.checkInTime,
        body.checkOutTime
      );
      if (windowError) return reply.status(400).send({ error: windowError });

      const resolved = await resolveOrCreateGuestUser(prisma, body.guest);
      if (!resolved.ok) {
        return reply.status(resolved.status).send({ error: resolved.error });
      }
      const owner = resolved.user;

      const ipAddress =
        (request.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ||
        request.ip ||
        null;
      const userAgent =
        typeof request.headers["user-agent"] === "string"
          ? request.headers["user-agent"]
          : null;
      await recordRequiredAcceptances(prisma, owner.id, { ipAddress, userAgent });

      // Crear (o reusar) las mascotas inline. La guardería NO exige cartilla
      // aprobada (como el baño); entra PENDING y el admin la revisa después.
      const petIds: string[] = [];
      for (const guestPet of body.pets) {
        const { pet, created } = await resolveOrCreateGuestPet(
          prisma,
          owner.id,
          guestPet
        );
        if (created && pet.cartillaStatus === "PENDING") {
          await notifyAdminsNewCartilla(
            pet.id,
            pet.name,
            `${owner.firstName} ${owner.lastName}`
          );
        }
        petIds.push(pet.id);
      }
      const uniquePetIds = [...new Set(petIds)];

      const [occupancy, pricing] = await Promise.all([
        countDaycareOccupancy(prisma, body.date),
        getLodgingPricing(prisma),
      ]);
      if (occupancy.occupied + uniquePetIds.length > occupancy.maxCapacity) {
        return reply
          .status(409)
          .send({ error: "No hay cupo de guardería para ese día" });
      }

      // Una guardería por mascota por día (reuso de mascota existente).
      const range = daycareDayRange(body.date)!;
      const sameDay = await prisma.reservation.findFirst({
        where: {
          reservationType: "DAYCARE",
          status: { not: "CANCELLED" },
          petId: { in: uniquePetIds },
          appointmentAt: { gte: range.start, lt: range.end },
        },
        select: { pet: { select: { name: true } } },
      });
      if (sameDay) {
        return reply.status(409).send({
          error: `${sameDay.pet.name} ya tiene guardería ese día`,
        });
      }

      const hours = computeDaycareHours(body.checkInTime, body.checkOutTime);
      const hourPrice = pricing.daycareHourPrice;
      const subtotal = hours * hourPrice * uniquePetIds.length;

      let deliveryFee = 0;
      let deliveryDistanceKm = 0;
      let deliveryActive = false;
      if (
        body.homeDelivery &&
        Number.isFinite(body.homeDelivery.lat) &&
        Number.isFinite(body.homeDelivery.lng)
      ) {
        const quote = await quoteDelivery(
          prisma,
          body.homeDelivery.lat,
          body.homeDelivery.lng
        );
        if (quote.active) {
          deliveryActive = true;
          deliveryFee = quote.fee;
          deliveryDistanceKm = quote.distanceKm;
        }
      }
      const total = subtotal + deliveryFee;
      if (total <= 0) {
        return reply.status(400).send({ error: "El total debe ser mayor a cero" });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: "mxn",
        automatic_payment_methods: { enabled: true },
        receipt_email: owner.email,
        metadata: {
          source: "web",
          type: "daycare",
          ownerId: owner.id,
          petIds: uniquePetIds.join(","),
          date: body.date,
          checkInTime: body.checkInTime,
          checkOutTime: body.checkOutTime,
          hours: String(hours),
          creditApplied: "0",
          ...(body.notes ? { notes: body.notes } : {}),
          ...(deliveryActive
            ? {
                deliveryFee: String(deliveryFee),
                deliveryDistanceKm: String(deliveryDistanceKm),
              }
            : {}),
        },
      });

      // La dirección del cliente (PII) NO va en el metadata de Stripe.
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
        hours,
        hourPrice,
        subtotal,
        deliveryFee,
        deliveryDistanceKm,
        deliveryActive,
        total,
      });
    }
  );

  // ── POST /guest/daycare/confirm ──────────────────────────────────────────
  fastify.post(
    "/guest/daycare/confirm",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const parsed = GuestDaycareConfirmSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { paymentIntentId } = parsed.data;

      // Idempotencia: si el PI ya creó reservas, devolverlas.
      const existingPayment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        include: { reservation: { include: { pet: true } } },
      });
      if (existingPayment?.reservation) {
        const group = existingPayment.reservation.groupId
          ? await prisma.reservation.findMany({
              where: { groupId: existingPayment.reservation.groupId },
              include: { pet: true },
            })
          : [existingPayment.reservation];
        return reply.send({
          success: true,
          reservations: group,
          groupId: existingPayment.reservation.groupId,
          idempotent: true,
        });
      }

      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      if (pi.metadata?.type !== "daycare" || pi.metadata?.source !== "web") {
        return reply
          .status(400)
          .send({ error: "PaymentIntent no corresponde a una guardería web" });
      }

      const ownerId = String(pi.metadata.ownerId);
      const petIds = String(pi.metadata.petIds).split(",").filter(Boolean);
      const date = String(pi.metadata.date);
      const checkInTime = String(pi.metadata.checkInTime);
      const checkOutTime = String(pi.metadata.checkOutTime);
      const notes =
        typeof pi.metadata.notes === "string" ? pi.metadata.notes : undefined;

      let deliveryOverride: { fee: number; distanceKm: number } | null = null;
      let homeDelivery:
        | { address: string; lat: number; lng: number }
        | undefined;
      if (pi.metadata?.deliveryFee) {
        deliveryOverride = {
          fee: Number(pi.metadata.deliveryFee),
          distanceKm: Number(pi.metadata.deliveryDistanceKm || 0),
        };
        const pendingDelivery = await prisma.pendingDeliveryAddress.findUnique({
          where: { paymentIntentId: pi.id },
        });
        if (pendingDelivery) {
          homeDelivery = {
            address: pendingDelivery.address,
            lat: pendingDelivery.lat ?? 0,
            lng: pendingDelivery.lng ?? 0,
          };
        }
      }

      const [owner, pets] = await Promise.all([
        prisma.user.findUnique({ where: { id: ownerId } }),
        prisma.pet.findMany({ where: { id: { in: petIds } } }),
      ]);
      if (!owner) return reply.status(404).send({ error: "Usuario no encontrado" });
      if (pets.length !== petIds.length) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }

      const result = await createDaycareGroup(prisma, {
        owner,
        pets,
        date,
        checkInTime,
        checkOutTime,
        homeDelivery,
        stripePaymentIntentId: pi.id,
        creditApplied: 0,
        deliveryOverride,
        notes,
        legalAccepted: true,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error });
      }

      return reply.send({
        success: true,
        reservations: result.reservations,
        groupId: result.groupId,
        grandTotal: result.grandTotal,
        hours: result.hours,
      });
    }
  );
}
