import { FastifyInstance } from "fastify";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";
import { createInternalGuard } from "../lib/internalAuth";
import { PEDIDO_SIN_DESPACHAR } from "../lib/storeOrderAlerts";
import {
  CARRIERS,
  buildShipmentMessage,
  guardarGuiaPedido,
  guessCustomerPhone,
  trackingUrl,
} from "../lib/storeShipment";

// ---------------------------------------------------------------------------
// Pedidos de la tienda en línea, para el equipo (solo ADMIN) desde la app.
//   GET  /admin/store/orders                 pendientes de despachar + recientes
//   GET  /admin/store/orders/:id             detalle (con el mensaje de WhatsApp)
//   POST /admin/store/orders/:id/shipment    guarda la guía y le manda correo al cliente
//   POST /admin/store/orders/:id/delivered   marca «Entregado» (recoge / domicilio)
//   POST /internal/store/orders/:id/shipment lo mismo que /shipment, para el panel web
// ---------------------------------------------------------------------------

const DETAIL_INCLUDE = {
  items: {
    select: {
      productNameSnapshot: true,
      variantTitleSnapshot: true,
      quantity: true,
      lineTotal: true,
    },
  },
  user: { select: { firstName: true, lastName: true, phone: true } },
} as const;

export default async function adminStoreOrdersRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const preHandler = [authMiddleware, adminMiddleware];

  type OrderWithDetail = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

  function loadOrder(id: string) {
    return prisma.order.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  function serialize(o: OrderWithDetail, pending: boolean) {
    const firstName = o.user?.firstName?.trim() || null;
    const customerName =
      [o.user?.firstName, o.user?.lastName].filter((s) => s && s.trim()).join(" ") || null;
    const hasTracking = !!(o.trackingCarrier?.trim() && o.trackingNumber?.trim());
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      fulfillmentType: o.fulfillmentType,
      pending,
      total: Number(o.total),
      subtotal: Number(o.subtotal),
      shippingTotal: Number(o.shippingTotal),
      discountTotal: Number(o.discountTotal),
      paidAt: o.paidAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      email: o.email,
      customerName,
      customerPhone: guessCustomerPhone(o.phone || o.user?.phone, o.shippingAddress),
      shippingAddress: o.shippingAddress,
      notes: o.notes,
      items: o.items.map((it) => ({
        name: it.productNameSnapshot,
        variant:
          it.variantTitleSnapshot && it.variantTitleSnapshot !== "Default Title"
            ? it.variantTitleSnapshot
            : null,
        quantity: it.quantity,
        lineTotal: Number(it.lineTotal),
      })),
      trackingCarrier: o.trackingCarrier,
      trackingNumber: o.trackingNumber,
      trackingUrl: hasTracking ? trackingUrl(o.trackingCarrier!, o.trackingNumber!) : null,
      // Listo para WhatsApp en cuanto hay guía. Lo arma el servidor para que
      // diga exactamente lo mismo que el correo.
      shipmentMessage: hasTracking
        ? buildShipmentMessage({
            items: o.items.map((it) => ({ name: it.productNameSnapshot })),
            firstName,
            carrier: o.trackingCarrier!,
            trackingNumber: o.trackingNumber!,
          })
        : null,
    };
  }

  async function isPending(id: string) {
    const n = await prisma.order.count({ where: { id, ...PEDIDO_SIN_DESPACHAR } });
    return n > 0;
  }

  fastify.get("/admin/store/orders", { preHandler }, async (_request, reply) => {
    const pendientes = await prisma.order.findMany({
      where: PEDIDO_SIN_DESPACHAR,
      include: DETAIL_INCLUDE,
      orderBy: { paidAt: "asc" },
    });
    const idsPendientes = new Set(pendientes.map((o) => o.id));
    const recientes = await prisma.order.findMany({
      where: {
        channel: "ONLINE",
        status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
        id: { notIn: [...idsPendientes] },
      },
      include: DETAIL_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return reply.send({
      carriers: CARRIERS,
      pending: pendientes.map((o) => serialize(o, true)),
      recent: recientes.map((o) => serialize(o, false)),
    });
  });

  fastify.get<{ Params: { id: string } }>(
    "/admin/store/orders/:id",
    { preHandler },
    async (request, reply) => {
      const o = await loadOrder(request.params.id);
      if (!o) return reply.status(404).send({ error: "Pedido no encontrado" });
      return reply.send({
        carriers: CARRIERS,
        order: serialize(o, await isPending(o.id)),
      });
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { carrier?: string; trackingNumber?: string };
  }>("/admin/store/orders/:id/shipment", { preHandler }, async (request, reply) => {
    const r = await guardarGuiaPedido(prisma, request.params.id, request.body ?? {});
    if (!r.ok) return reply.status(r.status).send({ error: r.error });
    const o = await loadOrder(request.params.id);
    return reply.send({
      order: serialize(o!, await isPending(o!.id)),
      emailSentTo: r.emailSentTo,
      emailSkipped: r.emailSkipped,
    });
  });

  // El panel web (otra instancia de Clerk) entra con x-cron-secret. Antes
  // escribía la guía directo en Supabase y el cliente nunca recibía el correo.
  const internalGuard = createInternalGuard(prisma);
  fastify.post<{
    Params: { id: string };
    Body: { carrier?: string; trackingNumber?: string };
  }>("/internal/store/orders/:id/shipment", { preHandler: internalGuard }, async (request, reply) => {
    const r = await guardarGuiaPedido(prisma, request.params.id, request.body ?? {});
    if (!r.ok) return reply.status(r.status).send({ error: r.error });
    return reply.send({ emailSentTo: r.emailSentTo, emailSkipped: r.emailSkipped });
  });

  fastify.post<{ Params: { id: string } }>(
    "/admin/store/orders/:id/delivered",
    { preHandler },
    async (request, reply) => {
      const o = await loadOrder(request.params.id);
      if (!o) return reply.status(404).send({ error: "Pedido no encontrado" });
      if (o.status !== "PAID" && o.status !== "FULFILLED") {
        return reply.status(409).send({ error: "El pedido no está pagado" });
      }
      const updated = await prisma.order.update({
        where: { id: o.id },
        data: { status: "FULFILLED" },
        include: DETAIL_INCLUDE,
      });
      return reply.send({ order: serialize(updated, false) });
    }
  );
}
