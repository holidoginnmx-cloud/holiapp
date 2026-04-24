import { FastifyInstance } from "fastify";
import {
  UpdateBathConfigSchema,
  CreateBathIntentSchema,
  ConfirmBathSchema,
} from "@holidoginn/shared";
import { Prisma, PetSize } from "@holidoginn/db";
import Stripe from "stripe";
import { createAuthMiddleware, createAdminMiddleware, createStaffMiddleware } from "../middleware/auth";
import { notifyUser, notifyUsers } from "../lib/notify";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// Hermosillo (Sonora) no observa horario de verano → UTC-7 fijo.
const TZ_OFFSET_HOURS = 7;
const BATH_CONFIG_ID = "singleton";

function sizeFromWeight(kg: number): PetSize {
  if (kg <= 5) return "S";
  if (kg <= 15) return "M";
  if (kg <= 24) return "L";
  return "XL";
}

function bathSizeKey(size: PetSize): PetSize {
  return size === "XS" ? "S" : size;
}

function describeBath(deslanado: boolean, corte: boolean): string {
  const extras: string[] = [];
  if (deslanado) extras.push("Deslanado");
  if (corte) extras.push("Corte");
  return extras.length > 0 ? `Baño + ${extras.join(" + ")}` : "Baño";
}

type BathConfigRow = {
  id: string;
  openHour: number;
  closeHour: number;
  slotMinutes: number;
  maxConcurrentBaths: number;
  isActive: boolean;
  updatedAt: Date;
};

function buildSlotsForDay(
  dateYMD: string,
  cfg: Pick<BathConfigRow, "openHour" | "closeHour" | "slotMinutes">
): Date[] {
  const [y, m, d] = dateYMD.split("-").map(Number);
  if (!y || !m || !d) return [];
  const startMin = cfg.openHour * 60;
  const endMin = cfg.closeHour * 60;
  const slots: Date[] = [];
  for (let min = startMin; min + cfg.slotMinutes <= endMin; min += cfg.slotMinutes) {
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    // Local (Hermosillo) → UTC: sumamos el offset
    slots.push(new Date(Date.UTC(y, m - 1, d, hh + TZ_OFFSET_HOURS, mm)));
  }
  return slots;
}

function isValidDateYMD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function sameYMDLocal(a: Date, b: Date): boolean {
  // Comparar "mismo día" en hora local (Hermosillo)
  const shift = TZ_OFFSET_HOURS * 3600 * 1000;
  const aL = new Date(a.getTime() - shift);
  const bL = new Date(b.getTime() - shift);
  return (
    aL.getUTCFullYear() === bL.getUTCFullYear() &&
    aL.getUTCMonth() === bL.getUTCMonth() &&
    aL.getUTCDate() === bL.getUTCDate()
  );
}

async function ensureConfig(prisma: FastifyInstance["prisma"]): Promise<BathConfigRow> {
  const existing = await prisma.bathConfig.findUnique({ where: { id: BATH_CONFIG_ID } });
  if (existing) return existing;
  return prisma.bathConfig.create({
    data: {
      id: BATH_CONFIG_ID,
      openHour: 9,
      closeHour: 18,
      slotMinutes: 60,
      maxConcurrentBaths: 1,
      isActive: true,
    },
  });
}

async function notifyBathBooked(
  prisma: FastifyInstance["prisma"],
  params: {
    reservationId: string;
    petName: string;
    appointmentAt: Date;
    deslanado: boolean;
    corte: boolean;
    price: number;
  }
) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const when = params.appointmentAt.toLocaleString("es-MX", {
    timeZone: "America/Hermosillo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const title = `Cita de baño: ${params.petName}`;
  const body = `${describeBath(params.deslanado, params.corte)} — ${when} — $${params.price.toLocaleString("es-MX")}`;

  await notifyUsers(prisma, admins.map((a) => a.id), {
    type: "GENERAL",
    title,
    body,
    data: {
      reservationId: params.reservationId,
      kind: "BATH_BOOKED",
      appointmentAt: params.appointmentAt.toISOString(),
    },
  });
}

export default async function bathsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const staffMiddleware = createStaffMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];
  const staffAuth = [authMiddleware, staffMiddleware];

  // ────────────────────────────────────────────────────────────
  //  GET /baths/config — configuración actual (público autenticado)
  // ────────────────────────────────────────────────────────────
  fastify.get("/baths/config", { preHandler: [authMiddleware] }, async () => {
    const cfg = await ensureConfig(prisma);
    return cfg;
  });

  // ────────────────────────────────────────────────────────────
  //  PATCH /admin/baths/config — editar horario/capacidad (admin)
  // ────────────────────────────────────────────────────────────
  fastify.patch(
    "/admin/baths/config",
    { preHandler: adminAuth },
    async (request, reply) => {
      const parsed = UpdateBathConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const current = await ensureConfig(prisma);
      const next = { ...current, ...parsed.data };
      if (next.closeHour <= next.openHour) {
        return reply
          .status(400)
          .send({ error: "closeHour debe ser mayor que openHour" });
      }
      if ((next.closeHour - next.openHour) * 60 < next.slotMinutes) {
        return reply
          .status(400)
          .send({ error: "La ventana horaria no alcanza para un slot" });
      }
      const updated = await prisma.bathConfig.update({
        where: { id: BATH_CONFIG_ID },
        data: parsed.data,
      });
      return updated;
    }
  );

  // ────────────────────────────────────────────────────────────
  //  GET /baths/slots?date=YYYY-MM-DD — slots disponibles del día
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/baths/slots",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const date = request.query.date;
      if (!date || !isValidDateYMD(date)) {
        return reply.status(400).send({ error: "Parámetro date=YYYY-MM-DD requerido" });
      }
      const cfg = await ensureConfig(prisma);
      if (!cfg.isActive) {
        return { config: cfg, slots: [] };
      }

      const allSlots = buildSlotsForDay(date, cfg);
      if (allSlots.length === 0) return { config: cfg, slots: [] };

      const dayStart = allSlots[0];
      const dayEnd = new Date(
        allSlots[allSlots.length - 1].getTime() + cfg.slotMinutes * 60000
      );

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
        return {
          startUtc: start.toISOString(),
          available: !inPast && remaining > 0,
          remaining,
          inPast,
        };
      });

      return { config: cfg, slots };
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /baths/create-intent — crea PaymentIntent para una cita
  //  Valida: slot válido, capacidad, misma mascota mismo día.
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/baths/create-intent",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateBathIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { petId, deslanado, corte, appointmentAt, notes } = parsed.data;

      const pet = await prisma.pet.findUnique({ where: { id: petId } });
      if (!pet) return reply.status(404).send({ error: "Mascota no encontrada" });

      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && pet.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      if (pet.cartillaStatus !== "APPROVED") {
        return reply
          .status(400)
          .send({ error: "La cartilla de la mascota debe estar aprobada" });
      }

      const cfg = await ensureConfig(prisma);
      if (!cfg.isActive) {
        return reply.status(400).send({ error: "Agenda de baños deshabilitada" });
      }

      const appointmentDate = new Date(appointmentAt);
      if (Number.isNaN(appointmentDate.getTime())) {
        return reply.status(400).send({ error: "appointmentAt inválido" });
      }
      if (appointmentDate.getTime() <= Date.now()) {
        return reply.status(400).send({ error: "El slot ya pasó" });
      }

      // Validar que appointmentAt sea exactamente un slot configurado
      const ymdLocal = new Date(
        appointmentDate.getTime() - TZ_OFFSET_HOURS * 3600 * 1000
      );
      const dateYMD = `${ymdLocal.getUTCFullYear()}-${String(
        ymdLocal.getUTCMonth() + 1
      ).padStart(2, "0")}-${String(ymdLocal.getUTCDate()).padStart(2, "0")}`;
      const validSlots = buildSlotsForDay(dateYMD, cfg);
      const isValidSlot = validSlots.some(
        (s) => s.getTime() === appointmentDate.getTime()
      );
      if (!isValidSlot) {
        return reply.status(400).send({ error: "Horario fuera de los slots configurados" });
      }

      // Capacidad del slot
      const taken = await prisma.reservation.count({
        where: {
          reservationType: "BATH",
          status: { not: "CANCELLED" },
          appointmentAt: appointmentDate,
        },
      });
      if (taken >= cfg.maxConcurrentBaths) {
        return reply.status(409).send({ error: "Slot sin disponibilidad" });
      }

      // Regla: misma mascota, mismo día — no permitido (excepto cancelados)
      const dayStart = validSlots[0];
      const dayEnd = new Date(
        validSlots[validSlots.length - 1].getTime() + cfg.slotMinutes * 60000
      );
      const sameDay = await prisma.reservation.findFirst({
        where: {
          petId,
          reservationType: "BATH",
          status: { not: "CANCELLED" },
          appointmentAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true },
      });
      if (sameDay) {
        return reply
          .status(409)
          .send({ error: "Ya existe una cita de baño para esta mascota ese día" });
      }

      // Precio y variante
      const petSize = bathSizeKey(sizeFromWeight(pet.weight ?? 0));
      const bath = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bath) return reply.status(500).send({ error: "Servicio de baño no configurado" });

      const variant = await prisma.serviceVariant.findUnique({
        where: {
          serviceTypeId_petSize_deslanado_corte: {
            serviceTypeId: bath.id,
            petSize,
            deslanado,
            corte,
          },
        },
      });
      if (!variant || !variant.isActive) {
        return reply.status(404).send({ error: "Variante de baño no encontrada" });
      }

      const owner = await prisma.user.findUnique({
        where: { id: pet.ownerId },
        select: { creditBalance: true },
      });
      const ownerCredit = Number(owner?.creditBalance ?? 0);
      const price = Number(variant.price);
      const creditApplied = Math.min(ownerCredit, price);
      const chargeAmount = price - creditApplied;

      if (chargeAmount === 0) {
        return reply.send({
          clientSecret: null,
          paymentIntentId: null,
          coveredByCredit: true,
          creditApplied,
          price,
          variantId: variant.id,
        });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(chargeAmount * 100),
        currency: "mxn",
        metadata: {
          ownerId: pet.ownerId,
          petId: pet.id,
          type: "bath_appointment",
          variantId: variant.id,
          appointmentAt: appointmentDate.toISOString(),
          creditApplied: String(creditApplied),
          ...(notes ? { notes } : {}),
        },
      });

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        coveredByCredit: false,
        creditApplied,
        price,
        variantId: variant.id,
      });
    }
  );

  // ────────────────────────────────────────────────────────────
  //  GET /staff/baths?date=YYYY-MM-DD — citas de baño del día
  //  Default: hoy (hora Hermosillo). Incluye todas, no filtradas por staff.
  // ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { date?: string } }>(
    "/staff/baths",
    { preHandler: staffAuth },
    async (request, reply) => {
      const cfg = await ensureConfig(prisma);

      let dateYMD = request.query.date;
      if (!dateYMD) {
        // Hoy en hora local Hermosillo
        const now = new Date();
        const local = new Date(now.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
        dateYMD = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
      } else if (!isValidDateYMD(dateYMD)) {
        return reply.status(400).send({ error: "date debe ser YYYY-MM-DD" });
      }

      const slots = buildSlotsForDay(dateYMD, cfg);
      if (slots.length === 0) return { date: dateYMD, baths: [] };

      const dayStart = slots[0];
      const dayEnd = new Date(
        slots[slots.length - 1].getTime() + cfg.slotMinutes * 60000,
      );

      const baths = await prisma.reservation.findMany({
        where: {
          reservationType: "BATH",
          status: { not: "CANCELLED" },
          appointmentAt: { gte: dayStart, lt: dayEnd },
        },
        include: {
          pet: {
            select: {
              id: true,
              name: true,
              breed: true,
              weight: true,
              photoUrl: true,
              size: true,
              notes: true,
            },
          },
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          addons: {
            include: {
              variant: { include: { serviceType: true } },
            },
          },
        },
        orderBy: { appointmentAt: "asc" },
      });

      return { date: dateYMD, baths };
    },
  );

  // ────────────────────────────────────────────────────────────
  //  POST /staff/baths/:id/complete — marcar cita como finalizada
  //  Setea status=CHECKED_OUT y addon.completedAt=now.
  //  Notifica al dueño.
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/staff/baths/:id/complete",
    { preHandler: staffAuth },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { name: true } },
          addons: true,
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Cita no encontrada" });
      }
      if (reservation.reservationType !== "BATH") {
        return reply.status(400).send({ error: "La reservación no es una cita de baño" });
      }
      if (reservation.status === "CHECKED_OUT") {
        return reply.status(409).send({ error: "La cita ya fue completada" });
      }
      if (reservation.status === "CANCELLED") {
        return reply.status(400).send({ error: "La cita está cancelada" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: "CHECKED_OUT" },
        });
        await tx.reservationAddon.updateMany({
          where: { reservationId: reservation.id, completedAt: null },
          data: { completedAt: new Date() },
        });
      });

      // Notificar al dueño
      await notifyUser(prisma, {
        userId: reservation.ownerId,
        type: "CHECK_OUT",
        title: "¡Baño listo! 🛁",
        body: `${reservation.pet.name} ya está listo. Puedes pasar a recogerlo.`,
        data: { reservationId: reservation.id, kind: "BATH_COMPLETED" },
      });

      return reply.send({ success: true });
    },
  );

  // ────────────────────────────────────────────────────────────
  //  POST /internal/bath-reminders — cron endpoint
  //  Envía recordatorio 24h antes de cada cita de baño pendiente.
  //  Protegido por header x-cron-secret (si CRON_SECRET está configurado).
  //  Idempotente: no reenvía si ya hay una notificación RESERVATION_REMINDER
  //  para la misma reservación.
  // ────────────────────────────────────────────────────────────
  fastify.post("/internal/bath-reminders", async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (secret && request.headers["x-cron-secret"] !== secret) {
      return reply.status(401).send({ error: "No autorizado" });
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 3600 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 3600 * 1000);

    const upcoming = await prisma.reservation.findMany({
      where: {
        reservationType: "BATH",
        status: { not: "CANCELLED" },
        appointmentAt: { gte: windowStart, lt: windowEnd },
      },
      include: {
        pet: { select: { name: true } },
      },
    });

    let sent = 0;
    for (const res of upcoming) {
      if (!res.appointmentAt) continue;

      const alreadyReminded = await prisma.notification.findFirst({
        where: {
          userId: res.ownerId,
          type: "RESERVATION_REMINDER",
          data: { path: ["reservationId"], equals: res.id },
        },
      });
      if (alreadyReminded) continue;

      const when = res.appointmentAt.toLocaleString("es-MX", {
        timeZone: "America/Hermosillo",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

      await notifyUser(prisma, {
        userId: res.ownerId,
        type: "RESERVATION_REMINDER",
        title: "Recordatorio: cita de baño mañana 🛁",
        body: `${res.pet.name} tiene baño el ${when}. ¡Te esperamos!`,
        data: { reservationId: res.id, kind: "BATH_REMINDER" },
      });
      sent++;
    }

    return reply.send({ sent, checked: upcoming.length });
  });

  // ────────────────────────────────────────────────────────────
  //  POST /baths/confirm — tras PI exitoso, crea la Reservation BATH
  //  Soporta también pagos 100% con crédito (paymentIntentId opcional).
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/baths/confirm",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const body = request.body as {
        paymentIntentId?: string;
        petId?: string;
        variantId?: string;
        appointmentAt?: string;
        notes?: string;
      };

      let ownerId: string;
      let petId: string;
      let variantId: string;
      let appointmentAtIso: string;
      let notes: string | undefined;
      let creditApplied = 0;
      let stripeAmount = 0;
      let paymentIntentId: string | null = null;

      if (body.paymentIntentId) {
        const parsed = ConfirmBathSchema.safeParse(body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.flatten() });
        }
        const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
        if (pi.status !== "succeeded") {
          return reply.status(400).send({ error: "El pago no fue completado" });
        }
        if (pi.metadata?.type !== "bath_appointment") {
          return reply.status(400).send({ error: "PaymentIntent no es de cita de baño" });
        }
        ownerId = String(pi.metadata.ownerId);
        petId = String(pi.metadata.petId);
        variantId = String(pi.metadata.variantId);
        appointmentAtIso = String(pi.metadata.appointmentAt);
        notes = typeof pi.metadata.notes === "string" ? pi.metadata.notes : undefined;
        creditApplied = Number(pi.metadata.creditApplied || 0);
        stripeAmount = pi.amount / 100;
        paymentIntentId = pi.id;
      } else {
        // Flujo 100% con crédito — el servidor recibe los datos directamente.
        if (!body.petId || !body.variantId || !body.appointmentAt) {
          return reply
            .status(400)
            .send({ error: "petId, variantId y appointmentAt son requeridos sin paymentIntent" });
        }
        const pet = await prisma.pet.findUnique({ where: { id: body.petId } });
        if (!pet) return reply.status(404).send({ error: "Mascota no encontrada" });
        if (pet.ownerId !== request.userId) {
          return reply.status(403).send({ error: "No autorizado" });
        }
        ownerId = pet.ownerId;
        petId = body.petId;
        variantId = body.variantId;
        appointmentAtIso = body.appointmentAt;
        notes = body.notes;
      }

      const appointmentAt = new Date(appointmentAtIso);
      if (Number.isNaN(appointmentAt.getTime())) {
        return reply.status(400).send({ error: "appointmentAt inválido" });
      }

      // Revalidar capacidad dentro de transacción para evitar race condition.
      const cfg = await ensureConfig(prisma);
      const variant = await prisma.serviceVariant.findUnique({ where: { id: variantId } });
      if (!variant) return reply.status(404).send({ error: "Variante no encontrada" });

      try {
        const result = await prisma.$transaction(async (tx) => {
          const taken = await tx.reservation.count({
            where: {
              reservationType: "BATH",
              status: { not: "CANCELLED" },
              appointmentAt,
            },
          });
          if (taken >= cfg.maxConcurrentBaths) {
            throw new Error("SLOT_TAKEN");
          }

          const price = Number(variant.price);
          const reservation = await tx.reservation.create({
            data: {
              reservationType: "BATH",
              appointmentAt,
              status: "CONFIRMED",
              totalAmount: new Prisma.Decimal(price),
              notes,
              legalAccepted: true,
              paymentType: "FULL",
              ownerId,
              petId,
            },
          });

          // Registrar pago Stripe (si aplica)
          let payment = null;
          if (paymentIntentId) {
            payment = await tx.payment.create({
              data: {
                amount: new Prisma.Decimal(stripeAmount),
                method: "STRIPE",
                status: "PAID",
                stripePaymentIntentId: paymentIntentId,
                paidAt: new Date(),
                notes: `Baño estandalone — ${describeBath(variant.deslanado, variant.corte)}`,
                reservationId: reservation.id,
                userId: ownerId,
              },
            });
          }

          // Aplicar crédito si hubo
          if (creditApplied > 0) {
            await tx.user.update({
              where: { id: ownerId },
              data: { creditBalance: { decrement: creditApplied } },
            });
            const user = await tx.user.findUnique({
              where: { id: ownerId },
              select: { creditBalance: true },
            });
            await tx.creditLedger.create({
              data: {
                type: "CREDIT_APPLIED",
                amount: new Prisma.Decimal(-creditApplied),
                balanceAfter: user?.creditBalance ?? new Prisma.Decimal(0),
                description: `Aplicado a cita de baño ${reservation.id}`,
                userId: ownerId,
                reservationId: reservation.id,
              },
            });
            await tx.payment.create({
              data: {
                amount: new Prisma.Decimal(creditApplied),
                method: "CREDIT",
                status: "PAID",
                paidAt: new Date(),
                notes: "Pago con saldo a favor",
                reservationId: reservation.id,
                userId: ownerId,
              },
            });
          }

          // Registrar addon para rastrear la variante contratada
          await tx.reservationAddon.create({
            data: {
              reservationId: reservation.id,
              variantId: variant.id,
              unitPrice: variant.price,
              paidWith: "BOOKING",
              paymentId: payment?.id,
            },
          });

          return { reservation, payment };
        });

        // Notificar a admins
        const pet = await prisma.pet.findUnique({
          where: { id: petId },
          select: { name: true },
        });
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
