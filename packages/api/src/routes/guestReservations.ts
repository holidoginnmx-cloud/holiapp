import { FastifyInstance } from "fastify";
import {
  GuestReservationIntentSchema,
  GuestReservationConfirmSchema,
} from "@holidoginn/shared";
import type { Pet } from "@prisma/client";
import Stripe from "stripe";
import { createOptionalAuthMiddleware } from "../middleware/auth";
import { resolveOrCreateGuestUser } from "../lib/guestUser";
import { resolveOrCreateGuestPet } from "../lib/guestPet";
import { recordRequiredAcceptances } from "../lib/legal";
import { cartillaBlocks } from "../lib/cartilla";
import { getLodgingPricing, pricePerDayForWeight, sizeFromWeight, bathSizeKey } from "../lib/pricing";
import { quoteDelivery } from "../lib/delivery";
import { createReservationGroup } from "../lib/reservationCreate";
import { notifyUsers } from "../lib/notify";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// ---------------------------------------------------------------------------
// Reservas de HOSPEDAJE para invitados (tienda web, sin login obligatorio).
//   POST /guest/reservations/create-intent  crea User+mascotas (PENDING) + PI
//   POST /guest/reservations/confirm        tras PI exitoso, crea las reservas
// La cartilla entra PENDING (revisada por admin antes del check-in). Los datos
// para confirmar viajan en el metadata del PaymentIntent (anti-tamper).
// ---------------------------------------------------------------------------
export default async function guestReservationsRoutes(fastify: FastifyInstance) {
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

  // ── POST /guest/reservations/create-intent ──────────────────────────────
  fastify.post(
    "/guest/reservations/create-intent",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      try {
        const parsed = GuestReservationIntentSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.flatten() });
        }
        const body = parsed.data;

        // 1) Resolver/crear el usuario invitado por email.
        const resolved = await resolveOrCreateGuestUser(prisma, body.guest);
        if (!resolved.ok) {
          return reply.status(resolved.status).send({ error: resolved.error });
        }
        const owner = resolved.user;

        // 2) Registrar consentimiento legal (para que el flujo respete LFPDPPP).
        const ipAddress =
          (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
          request.ip ||
          null;
        const userAgent =
          typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null;
        await recordRequiredAcceptances(prisma, owner.id, { ipAddress, userAgent });

        // 3) Validar fechas + elegibilidad de anticipo.
        const checkInDate = new Date(body.checkIn);
        const checkOutDate = new Date(body.checkOut);
        if (checkOutDate <= checkInDate) {
          return reply.status(400).send({ error: "checkOut debe ser posterior a checkIn" });
        }
        const totalDays = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / 86_400_000);
        if (body.paymentType === "DEPOSIT") {
          if (totalDays < 2) {
            return reply
              .status(400)
              .send({ error: "El anticipo no está disponible para estancias de una sola noche" });
          }
          const daysUntilCheckIn = (checkInDate.getTime() - Date.now()) / 86_400_000;
          if (daysUntilCheckIn < 3) {
            return reply.status(400).send({
              error: "El anticipo solo está disponible con 3 o más días de anticipación al check-in",
            });
          }
        }

        // 4) Crear (o reusar) las mascotas inline, ligadas al owner, cartilla PENDING.
        const createdPets: Pet[] = [];
        for (const gp of body.pets) {
          const { pet, created } = await resolveOrCreateGuestPet(prisma, owner.id, gp);
          createdPets.push(pet);
          if (created && pet.cartillaStatus === "PENDING") {
            await notifyAdminsNewCartilla(pet.id, pet.name, `${owner.firstName} ${owner.lastName}`);
          }
        }

        // 5) Gate de cartilla relajado para web (PENDING permitido; EXPIRED/REJECTED no).
        const blocked = createdPets.filter((p) => cartillaBlocks(p, "web"));
        if (blocked.length > 0) {
          return reply.status(400).send({
            error: `Cartilla no válida para: ${blocked.map((p) => p.name).join(", ")}.`,
            blockedPetIds: blocked.map((p) => p.id),
          });
        }

        // 6) Precio (mismo cálculo que /payments/create-intent).
        const pricingConfig = await getLodgingPricing(prisma);
        const breakdown = createdPets.map((pet) => {
          const pricePerDay = pricePerDayForWeight(pet.weight, pricingConfig);
          return {
            petId: pet.id,
            petName: pet.name,
            weight: pet.weight ?? 0,
            pricePerDay,
            subtotal: pricePerDay * totalDays,
          };
        });

        // Map add-ons por índice → petId real.
        const bathSelectionsByPet: Record<string, { deslanado: boolean; corte: boolean }> = {};
        const medicationByPet: Record<string, { notes: string }> = {};
        if (body.bathSelectionsByIndex) {
          for (const [idx, sel] of Object.entries(body.bathSelectionsByIndex)) {
            const pet = createdPets[Number(idx)];
            if (pet) bathSelectionsByPet[pet.id] = sel;
          }
        }
        if (body.medicationByIndex) {
          for (const [idx, sel] of Object.entries(body.medicationByIndex)) {
            const pet = createdPets[Number(idx)];
            if (pet && sel?.notes?.trim()) medicationByPet[pet.id] = { notes: sel.notes.trim() };
          }
        }

        let bathTotal = 0;
        const bathBreakdown: Array<{ petId: string; variantId: string; price: number }> = [];
        if (Object.keys(bathSelectionsByPet).length > 0) {
          const bath = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
          if (bath) {
            for (const [petId, sel] of Object.entries(bathSelectionsByPet)) {
              const pet = createdPets.find((p) => p.id === petId);
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
                return reply.status(400).send({ error: `Variante de baño no disponible para ${pet.name}` });
              }
              const price = Number(variant.price);
              bathTotal += price;
              bathBreakdown.push({ petId, variantId: variant.id, price });
            }
          }
        }

        const medicationBreakdown: Array<{ petId: string; surcharge: number }> = [];
        let medicationTotal = 0;
        for (const [petId] of Object.entries(medicationByPet)) {
          const petLodging = breakdown.find((b) => b.petId === petId);
          if (!petLodging) continue;
          const surcharge = Math.ceil(petLodging.subtotal * 0.1);
          medicationTotal += surcharge;
          medicationBreakdown.push({ petId, surcharge });
        }

        const baseTotal =
          breakdown.reduce((sum, b) => sum + b.subtotal, 0) + bathTotal + medicationTotal;
        const hoursUntilCheckIn = (checkInDate.getTime() - Date.now()) / (60 * 60 * 1000);
        const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
        const surchargeAmount = sameDaySurcharge ? Math.ceil(baseTotal * 0.2) : 0;

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

        const grandTotal = baseTotal + surchargeAmount + deliveryFee;
        const depositAmountBase =
          body.paymentType === "DEPOSIT" ? Math.ceil(grandTotal * 0.2) : grandTotal;
        const remainingAmount = grandTotal - depositAmountBase;
        const depositDeadline =
          body.paymentType === "DEPOSIT" ? checkInDate.toISOString() : null;

        if (depositAmountBase <= 0) {
          return reply.status(400).send({ error: "El total debe ser mayor a cero" });
        }

        // 7) PaymentIntent. Todos los datos para confirmar van en metadata.
        const metadata: Record<string, string> = {
          source: "web",
          kind: "stay_web",
          ownerId: owner.id,
          petIds: createdPets.map((p) => p.id).join(","),
          checkIn: body.checkIn,
          checkOut: body.checkOut,
          roomPreference: body.roomPreference,
          paymentType: body.paymentType,
          totalDays: String(totalDays),
        };
        if (Object.keys(bathSelectionsByPet).length > 0) {
          metadata.bath = JSON.stringify(bathSelectionsByPet);
        }
        // Notas de medicamento: una clave por mascota para no rebasar el límite
        // de 500 chars por valor del metadata de Stripe.
        for (const [petId, sel] of Object.entries(medicationByPet)) {
          metadata[`med_${petId}`] = sel.notes;
        }
        if (deliveryActive && body.homeDelivery) {
          metadata.delivery = JSON.stringify({
            address: body.homeDelivery.address,
            lat: body.homeDelivery.lat,
            lng: body.homeDelivery.lng,
          });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(depositAmountBase * 100),
          currency: "mxn",
          automatic_payment_methods: { enabled: true },
          receipt_email: owner.email,
          metadata,
        });

        return reply.send({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          coveredByCredit: false,
          creditApplied: 0,
          grandTotal,
          depositAmount: depositAmountBase,
          remainingAmount,
          depositDeadline,
          paymentType: body.paymentType,
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
        });
      } catch (err: unknown) {
        fastify.log.error(err);
        const message = err instanceof Error ? err.message : "Error interno del servidor";
        return reply.status(500).send({ error: message });
      }
    }
  );

  // ── POST /guest/reservations/confirm ────────────────────────────────────
  fastify.post(
    "/guest/reservations/confirm",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const parsed = GuestReservationConfirmSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { paymentIntentId } = parsed.data;

      // Idempotencia: si este PI ya generó reservación(es), devolverlas.
      const existingPayment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        include: { reservation: true },
      });
      if (existingPayment?.reservation) {
        const groupId = existingPayment.reservation.groupId;
        const reservations = groupId
          ? await prisma.reservation.findMany({ where: { groupId } })
          : [existingPayment.reservation];
        const grandTotal = reservations.reduce((s, r) => s + Number(r.totalAmount), 0);
        return reply
          .status(200)
          .send({ reservations, grandTotal, groupId: groupId ?? null, creditApplied: 0, idempotent: true });
      }

      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      if (pi.metadata?.source !== "web" || pi.metadata?.kind !== "stay_web") {
        return reply.status(400).send({ error: "PaymentIntent no corresponde a una reserva web" });
      }

      const ownerId = String(pi.metadata.ownerId);
      const petIds = String(pi.metadata.petIds || "").split(",").filter(Boolean);
      const checkIn = new Date(String(pi.metadata.checkIn));
      const checkOut = new Date(String(pi.metadata.checkOut));
      const roomPreference = (pi.metadata.roomPreference as "shared" | "separate") || "shared";
      const paymentType = (pi.metadata.paymentType as "FULL" | "DEPOSIT") || "FULL";

      const owner = await prisma.user.findUnique({ where: { id: ownerId } });
      if (!owner) return reply.status(404).send({ error: "Dueño no encontrado" });

      const pets = await prisma.pet.findMany({ where: { id: { in: petIds }, ownerId } });
      if (pets.length !== petIds.length) {
        return reply.status(400).send({ error: "Una o más mascotas no pertenecen al dueño" });
      }

      const blocked = pets.filter((p) => cartillaBlocks(p, "web"));
      if (blocked.length > 0) {
        return reply.status(400).send({
          error: `Cartilla no válida para: ${blocked.map((p) => p.name).join(", ")}.`,
          blockedPetIds: blocked.map((p) => p.id),
        });
      }

      // Solapamiento: misma mascota no puede tener dos reservas activas que se traslapen.
      const overlapping = await prisma.reservation.findMany({
        where: {
          petId: { in: petIds },
          status: { not: "CANCELLED" },
          AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
        },
        include: { pet: { select: { id: true, name: true } } },
      });
      if (overlapping.length > 0) {
        const names = Array.from(new Set(overlapping.map((r) => r.pet.name))).join(", ");
        return reply.status(409).send({
          error: `Ya existe una reserva activa para: ${names} en esas fechas.`,
          code: "RESERVATION_OVERLAP",
        });
      }

      // Reconstruir add-ons desde el metadata.
      const bathSelectionsByPet: Record<string, { deslanado: boolean; corte: boolean }> =
        pi.metadata.bath ? JSON.parse(pi.metadata.bath) : {};
      const medicationByPet: Record<string, { notes: string }> = {};
      for (const [key, value] of Object.entries(pi.metadata)) {
        if (key.startsWith("med_") && typeof value === "string") {
          medicationByPet[key.slice(4)] = { notes: value };
        }
      }
      const homeDelivery = pi.metadata.delivery ? JSON.parse(pi.metadata.delivery) : undefined;

      const result = await createReservationGroup(prisma, {
        owner,
        pets,
        checkIn,
        checkOut,
        roomPreference,
        paymentType,
        bathSelectionsByPet,
        medicationByPet,
        homeDelivery,
        stripePaymentIntentId: pi.id,
        creditApplied: 0,
        notes: null,
        legalAccepted: true,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, ...(result.extra ?? {}) });
      }

      return reply.status(201).send({
        reservations: result.reservations,
        grandTotal: result.grandTotal,
        groupId: result.groupId,
        creditApplied: result.creditApplied,
      });
    }
  );
}
