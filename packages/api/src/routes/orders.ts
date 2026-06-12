import { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { Prisma } from "@holidoginn/db";
import { createAuthMiddleware, createOptionalAuthMiddleware } from "../middleware/auth";
import { getCartToken, loadCartDetail, resolveActiveCart } from "../lib/store";

// ---------------------------------------------------------------------------
// Tienda en línea — pedidos y checkout.
//   POST /store/orders/create-intent   crea orden PENDING + PaymentIntent
//   GET  /store/orders/by-pi/:pi       estado de la orden (página de confirmación)
//   GET  /store/orders                 historial del usuario (requiere sesión)
// El pago se CONFIRMA en el webhook (source="store"), nunca en el cliente.
// ---------------------------------------------------------------------------

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FULFILLMENTS = ["PICKUP", "LOCAL_DELIVERY", "NATIONAL_SHIPPING"] as const;
type Fulfillment = (typeof FULFILLMENTS)[number];

export default async function ordersRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const optionalAuth = createOptionalAuthMiddleware(prisma);

  fastify.post<{
    Body: {
      email?: string;
      fulfillmentType?: string;
      discountCode?: string;
      notes?: string;
    };
  }>(
    "/store/orders/create-intent",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const body = request.body ?? {};
      const userId = request.userId ?? null;
      const token = getCartToken(request);

      // Email: del usuario logueado o del invitado (validado).
      const email = userId ? request.dbUser?.email ?? "" : (body.email ?? "").trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email)) {
        return reply.status(400).send({ error: "Email válido requerido" });
      }

      const fulfillmentType: Fulfillment = FULFILLMENTS.includes(
        body.fulfillmentType as Fulfillment
      )
        ? (body.fulfillmentType as Fulfillment)
        : "PICKUP";

      // Cargar carrito y revalidar stock + recalcular precios server-side.
      const cart = await resolveActiveCart(prisma, userId, token, false);
      if (!cart) return reply.status(400).send({ error: "Carrito vacío" });
      const detail = await loadCartDetail(prisma, cart.id);
      if (detail.items.length === 0) {
        return reply.status(400).send({ error: "Carrito vacío" });
      }
      const sinStock = detail.items.filter(
        (i) => !i.inStock || (i.maxQuantity !== null && i.quantity > i.maxQuantity)
      );
      if (sinStock.length > 0) {
        return reply.status(409).send({
          error: "Algunos productos no tienen existencias suficientes",
          items: sinStock.map((i) => ({ variantId: i.variantId, name: i.name })),
        });
      }

      const subtotal = detail.subtotal;

      // Validar y aplicar código de descuento.
      let discountTotal = 0;
      let discountCodeId: string | null = null;
      if (body.discountCode?.trim()) {
        const code = body.discountCode.trim().toUpperCase();
        const dc = await prisma.discountCode.findUnique({ where: { code } });
        const now = new Date();
        const valido =
          dc &&
          dc.isActive &&
          (!dc.startsAt || dc.startsAt <= now) &&
          (!dc.endsAt || dc.endsAt >= now) &&
          (dc.maxUses === null || dc.usesCount < dc.maxUses) &&
          (!dc.minSubtotal || subtotal >= Number(dc.minSubtotal));

        if (!dc || !valido) {
          return reply.status(400).send({ error: "Código de descuento inválido" });
        }
        // "Primera compra": para logueados se verifica por userId; para invitados
        // por email. No es a prueba de balas (un invitado puede usar otro email),
        // pero cierra la reutilización trivial con el mismo correo.
        if (dc.firstOrderOnly) {
          const prev = await prisma.order.count({
            where: {
              status: { in: ["PAID", "FULFILLED"] },
              ...(userId ? { userId } : { email }),
            },
          });
          if (prev > 0) {
            return reply.status(400).send({ error: "Este código es solo para tu primera compra" });
          }
        }
        // value siempre >= 0 (defensa por si se insertó un código inválido en BD).
        const value = Math.max(0, Number(dc.value));
        discountTotal =
          dc.type === "PERCENT"
            ? Number(((subtotal * value) / 100).toFixed(2))
            : Math.min(value, subtotal);
        discountTotal = Math.min(Math.max(0, discountTotal), subtotal);
        discountCodeId = dc.id;
      }

      const shippingTotal = 0; // Fase 1: solo recoger en hotel.
      const total = Number((subtotal - discountTotal + shippingTotal).toFixed(2));
      if (total <= 0) {
        return reply.status(400).send({ error: "El total debe ser mayor a cero" });
      }

      // Crear orden + items (snapshot inmutable) en transacción.
      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            email,
            userId,
            status: "PENDING",
            fulfillmentType,
            subtotal: new Prisma.Decimal(subtotal),
            discountTotal: new Prisma.Decimal(discountTotal),
            shippingTotal: new Prisma.Decimal(shippingTotal),
            total: new Prisma.Decimal(total),
            discountCodeId,
            notes: body.notes?.trim() || null,
          },
        });
        await tx.orderItem.createMany({
          data: detail.items.map((i) => ({
            orderId: created.id,
            variantId: i.variantId,
            productNameSnapshot: i.name,
            variantTitleSnapshot: i.variantTitle,
            unitPrice: new Prisma.Decimal(i.unitPrice),
            quantity: i.quantity,
            lineTotal: new Prisma.Decimal(i.lineTotal),
          })),
        });
        return created;
      });

      // PaymentIntent. El webhook (source="store") confirma y descuenta stock.
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: "mxn",
        receipt_email: email,
        metadata: {
          source: "store",
          orderId: order.id,
          cartId: cart.id,
          orderNumber: String(order.orderNumber),
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: paymentIntent.id },
      });

      return reply.send({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        subtotal,
        discountTotal,
        shippingTotal,
        total,
        email,
      });
    }
  );

  // Estado de una orden por PaymentIntent (página de confirmación). Para no
  // exponer PII solo con el PI id, exige el client_secret y lo verifica contra
  // Stripe (el client_secret solo lo conoce quien inició el pago).
  fastify.get<{ Params: { pi: string }; Querystring: { client_secret?: string } }>(
    "/store/orders/by-pi/:pi",
    async (request, reply) => {
      const clientSecret = request.query.client_secret;
      if (!clientSecret || !clientSecret.startsWith(`${request.params.pi}_secret_`)) {
        return reply.status(401).send({ error: "client_secret requerido" });
      }
      try {
        const piObj = await stripe.paymentIntents.retrieve(request.params.pi);
        if (piObj.client_secret !== clientSecret) {
          return reply.status(401).send({ error: "client_secret inválido" });
        }
      } catch {
        return reply.status(404).send({ error: "Pago no encontrado" });
      }

      const order = await prisma.order.findUnique({
        where: { stripePaymentIntentId: request.params.pi },
        include: { items: true },
      });
      if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        email: order.email,
        fulfillmentType: order.fulfillmentType,
        subtotal: Number(order.subtotal),
        discountTotal: Number(order.discountTotal),
        total: Number(order.total),
        items: order.items.map((it) => ({
          name: it.productNameSnapshot,
          variantTitle: it.variantTitleSnapshot,
          quantity: it.quantity,
          unitPrice: Number(it.unitPrice),
          lineTotal: Number(it.lineTotal),
        })),
      };
    }
  );

  // Historial de pedidos del usuario logueado.
  fastify.get("/store/orders", { preHandler: [authMiddleware] }, async (request) => {
    const orders = await prisma.order.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });
    return {
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: Number(o.total),
        fulfillmentType: o.fulfillmentType,
        createdAt: o.createdAt,
        itemCount: o.items.reduce((n, it) => n + it.quantity, 0),
      })),
    };
  });
}
