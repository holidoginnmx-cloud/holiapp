import { FastifyInstance } from "fastify";
import { CreateBathAddonSchema, ConfirmBathAddonSchema } from "@holidoginn/shared";
import { Prisma, PetSize, PrismaClient } from "@holidoginn/db";
import Stripe from "stripe";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

function sizeFromWeight(kg: number): PetSize {
  if (kg <= 5) return "S";
  if (kg <= 15) return "M";
  if (kg <= 24) return "L";
  return "XL";
}

// XS pets bill at S price — the business does not price them differently
function bathSizeKey(size: PetSize): PetSize {
  return size === "XS" ? "S" : size;
}

function describeBath(deslanado: boolean, corte: boolean): string {
  const extras: string[] = [];
  if (deslanado) extras.push("Deslanado");
  if (corte) extras.push("Corte");
  return extras.length > 0 ? `Baño + ${extras.join(" + ")}` : "Baño";
}

export async function notifyBathContracted(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    petName: string;
    assignedStaffId: string | null;
    deslanado: boolean;
    corte: boolean;
    price: number;
  }
) {
  const { reservationId, petName, assignedStaffId, deslanado, corte, price } = params;

  const title = `Baño contratado: ${petName}`;
  const body = `${describeBath(deslanado, corte)} — $${price.toLocaleString("es-MX")}. Se debe entregar bañado al check-out.`;

  const targets = new Set<string>();
  if (assignedStaffId) targets.add(assignedStaffId);

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  for (const a of admins) targets.add(a.id);

  if (targets.size === 0) return;

  await prisma.notification.createMany({
    data: Array.from(targets).map((userId) => ({
      userId,
      type: "GENERAL" as const,
      title,
      body,
      data: { reservationId, kind: "BATH_CONTRACTED" },
    })),
  });
}

export default async function servicesRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];

  // GET /services/bath/variants — matriz completa de precios de baño
  fastify.get(
    "/services/bath/variants",
    { preHandler: [authMiddleware] },
    async () => {
    const bath = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
    if (!bath) return [];
    const variants = await prisma.serviceVariant.findMany({
      where: { serviceTypeId: bath.id, isActive: true },
      orderBy: [{ petSize: "asc" }, { deslanado: "asc" }, { corte: "asc" }],
    });
    return variants.map((v) => ({
      id: v.id,
      serviceTypeId: v.serviceTypeId,
      petSize: v.petSize,
      deslanado: v.deslanado,
      corte: v.corte,
      price: Number(v.price),
      isActive: v.isActive,
    }));
  });

  // POST /reservations/:id/addons/bath — crear intent de pago para baño post-booking
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/addons/bath",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateBathAddonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { petId, deslanado, corte } = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { pet: true, addons: { include: { variant: { include: { serviceType: true } } } } },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (reservation.petId !== petId) {
        return reply.status(400).send({ error: "La mascota no corresponde a esta reservación" });
      }
      if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
        return reply.status(400).send({
          error: "Solo se puede agregar un baño entre confirmación y check-in",
        });
      }
      const hasBath = reservation.addons.some((a) => a.variant.serviceType.code === "BATH");
      if (hasBath) {
        return reply.status(409).send({ error: "Esta reservación ya tiene un baño contratado" });
      }

      const petSize = bathSizeKey(sizeFromWeight(reservation.pet.weight ?? 0));
      const bath = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bath) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }
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

      const amount = Number(variant.price);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: "mxn",
        metadata: {
          reservationId: reservation.id,
          type: "bath_addon",
          variantId: variant.id,
        },
      });

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount,
        variantId: variant.id,
      });
    }
  );

  // POST /reservations/:id/addons/bath/confirm — confirmar pago y registrar addon
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/addons/bath/confirm",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = ConfirmBathAddonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { paymentIntentId } = parsed.data;

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      if (paymentIntent.metadata.reservationId !== request.params.id) {
        return reply.status(400).send({ error: "El pago no corresponde a esta reservación" });
      }
      const variantId = paymentIntent.metadata.variantId;
      if (!variantId) {
        return reply.status(400).send({ error: "PaymentIntent sin variante asociada" });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { addons: { include: { variant: { include: { serviceType: true } } } } },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      const alreadyBath = reservation.addons.some(
        (a) => a.variant.serviceType.code === "BATH"
      );
      if (alreadyBath) {
        return reply.status(409).send({ error: "Esta reservación ya tiene un baño contratado" });
      }

      const variant = await prisma.serviceVariant.findUnique({ where: { id: variantId } });
      if (!variant) {
        return reply.status(404).send({ error: "Variante no encontrada" });
      }

      const [payment, addon] = await prisma.$transaction(async (tx) => {
        const pay = await tx.payment.create({
          data: {
            amount: new Prisma.Decimal(paymentIntent.amount / 100),
            method: "STRIPE",
            status: "PAID",
            stripePaymentIntentId: paymentIntentId,
            paidAt: new Date(),
            notes: "Baño (addon)",
            reservationId: reservation.id,
            userId: reservation.ownerId,
          },
        });
        const add = await tx.reservationAddon.create({
          data: {
            reservationId: reservation.id,
            variantId: variant.id,
            unitPrice: variant.price,
            paidWith: "STANDALONE",
            paymentId: pay.id,
          },
          include: { variant: { include: { serviceType: true } } },
        });
        return [pay, add] as const;
      });

      // Notify assigned staff + admins
      const fullReservation = await prisma.reservation.findUnique({
        where: { id: reservation.id },
        include: { pet: { select: { name: true } } },
      });
      if (fullReservation) {
        await notifyBathContracted(prisma, {
          reservationId: reservation.id,
          petName: fullReservation.pet.name,
          assignedStaffId: fullReservation.staffId,
          deslanado: variant.deslanado,
          corte: variant.corte,
          price: Number(variant.price),
        });
      }

      return reply.send({ success: true, addon, payment });
    }
  );

  // ═══════════════════════════════════════════════════════════
  //  ADMIN — gestión de servicios y precios
  // ═══════════════════════════════════════════════════════════

  // GET /admin/services — listar todos los tipos de servicio con variantes
  fastify.get("/admin/services", { preHandler: adminAuth }, async () => {
    const types = await prisma.serviceType.findMany({
      include: {
        variants: { orderBy: [{ petSize: "asc" }, { deslanado: "asc" }, { corte: "asc" }] },
      },
      orderBy: { name: "asc" },
    });
    return types.map((t) => ({
      ...t,
      variants: t.variants.map((v) => ({
        ...v,
        price: Number(v.price),
      })),
    }));
  });

  // POST /admin/services — crear tipo de servicio
  fastify.post<{ Body: { code: string; name: string } }>(
    "/admin/services",
    { preHandler: adminAuth },
    async (request, reply) => {
      const { code, name } = request.body as { code: string; name: string };
      if (!code || !name) return reply.status(400).send({ error: "code y name requeridos" });

      const existing = await prisma.serviceType.findUnique({ where: { code } });
      if (existing) return reply.status(409).send({ error: "Ya existe un servicio con ese código" });

      const serviceType = await prisma.serviceType.create({
        data: { code: code.toUpperCase(), name },
      });
      return reply.status(201).send(serviceType);
    }
  );

  // PATCH /admin/services/:id — actualizar tipo de servicio
  fastify.patch<{ Params: { id: string } }>(
    "/admin/services/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const { name, isActive } = request.body as { name?: string; isActive?: boolean };
      const serviceType = await prisma.serviceType.findUnique({ where: { id: request.params.id } });
      if (!serviceType) return reply.status(404).send({ error: "Servicio no encontrado" });

      const updated = await prisma.serviceType.update({
        where: { id: request.params.id },
        data: { ...(name !== undefined ? { name } : {}), ...(isActive !== undefined ? { isActive } : {}) },
      });
      return updated;
    }
  );

  // PATCH /admin/services/variants/:id — actualizar precio o estado de variante
  fastify.patch<{ Params: { id: string } }>(
    "/admin/services/variants/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const { price, isActive } = request.body as { price?: number; isActive?: boolean };
      const variant = await prisma.serviceVariant.findUnique({ where: { id: request.params.id } });
      if (!variant) return reply.status(404).send({ error: "Variante no encontrada" });

      const updated = await prisma.serviceVariant.update({
        where: { id: request.params.id },
        data: {
          ...(price !== undefined ? { price: new Prisma.Decimal(price) } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });
      return { ...updated, price: Number(updated.price) };
    }
  );

  // POST /admin/services/variants — crear nueva variante
  fastify.post(
    "/admin/services/variants",
    { preHandler: adminAuth },
    async (request, reply) => {
      const { serviceTypeId, petSize, deslanado, corte, price } = request.body as {
        serviceTypeId: string;
        petSize: PetSize;
        deslanado: boolean;
        corte: boolean;
        price: number;
      };
      if (!serviceTypeId || !petSize || price === undefined) {
        return reply.status(400).send({ error: "Campos requeridos: serviceTypeId, petSize, price" });
      }

      const variant = await prisma.serviceVariant.create({
        data: {
          serviceTypeId,
          petSize,
          deslanado: deslanado ?? false,
          corte: corte ?? false,
          price: new Prisma.Decimal(price),
        },
      });
      return reply.status(201).send({ ...variant, price: Number(variant.price) });
    }
  );
}
