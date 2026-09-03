import { FastifyInstance, FastifyRequest } from "fastify";
import Stripe from "stripe";
import {
  paymentReceivedTemplate,
  paymentFailedTemplate,
  refundIssuedTemplate,
  orderConfirmedTemplate,
  sendEmail,
} from "../lib/email";
import { notifyUser, notifyUsers } from "../lib/notify";
import { syncPayout, avisarPayoutSincronizado } from "../lib/payouts";
import { Prisma } from "@holidoginn/db";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string | Buffer;
  }
}

export default async function stripeWebhookRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  fastify.post(
    "/stripe/webhook",
    { config: { rawBody: true } },
    async (request: FastifyRequest, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        request.log.error("STRIPE_WEBHOOK_SECRET no configurado");
        return reply.status(500).send({ error: "Webhook no configurado" });
      }

      const signature = request.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return reply.status(400).send({ error: "Falta stripe-signature" });
      }

      const rawBody = request.rawBody;
      if (!rawBody) {
        return reply.status(400).send({ error: "Cuerpo vacío" });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      } catch (err) {
        request.log.warn({ err }, "Firma de webhook inválida");
        return reply.status(400).send({ error: "Firma inválida" });
      }

      // Idempotencia: ¿ya procesamos este event.id?
      const existing = await prisma.stripeEvent.findUnique({
        where: { id: event.id },
      });
      if (existing) {
        request.log.info({ eventId: event.id }, "Webhook duplicado — se ignora");
        return reply.send({ received: true, duplicate: true });
      }

      try {
        switch (event.type) {
          case "payment_intent.succeeded":
            await handlePaymentIntentSucceeded(prisma, event.data.object as Stripe.PaymentIntent);
            break;
          case "payment_intent.payment_failed":
            await handlePaymentIntentFailed(prisma, event.data.object as Stripe.PaymentIntent);
            break;
          case "charge.refunded":
            await handleChargeRefunded(prisma, event.data.object as Stripe.Charge);
            break;
          case "charge.dispute.created":
            await handleDisputeCreated(prisma, event.data.object as Stripe.Dispute);
            break;
          case "payout.paid":
            await handlePayoutPaid(prisma, event.data.object as Stripe.Payout);
            break;
          case "payout.failed":
            await handlePayoutFailed(prisma, event.data.object as Stripe.Payout);
            break;
          default:
            request.log.info({ type: event.type }, "Evento Stripe no manejado");
        }
      } catch (err) {
        request.log.error({ err, eventId: event.id }, "Error procesando webhook");
        // No guardar en StripeEvent: queremos que Stripe reintente
        return reply.status(500).send({ error: "Error procesando" });
      }

      // Guardar como procesado solo tras éxito
      await prisma.stripeEvent.create({
        data: {
          id: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });

      return reply.send({ received: true });
    }
  );
}

// Guarda la comisión de Stripe (bruto − neto) para que los ingresos cuenten el
// neto real que cae a la cuenta, sin tocar `amount` (que sigue siendo bruto).
// El balance_transaction puede estar `pending` en pagos con tarjeta MXN y aún no
// traer `fee`; por eso el llamador filtra por stripeFeeAmount null (idempotente)
// y el script backfill-stripe-fees.ts recoge los que queden pendientes.
// Lo usan los pagos de reservación y los de pedido de tienda por igual.
async function guardarComisionStripe(
  prisma: FastifyInstance["prisma"],
  paymentId: string,
  piId: string
) {
  try {
    const full = await stripe.paymentIntents.retrieve(piId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = full.latest_charge as Stripe.Charge | null;
    const bt = charge?.balance_transaction;
    if (bt && typeof bt !== "string" && bt.fee != null) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          stripeFeeAmount: new Prisma.Decimal(bt.fee / 100),
          // Día en que Stripe libera el dinero: con depósito automático
          // diario es cuando el SPEI sale al banco ("¿cuándo me cae?").
          stripeAvailableOn: bt.available_on
            ? new Date(bt.available_on * 1000)
            : null,
        },
      });
    }
  } catch (err) {
    console.warn(
      `[webhook] no se pudo obtener la comisión de Stripe del PI ${piId}:`,
      err
    );
  }
}

async function handlePaymentIntentSucceeded(
  prisma: FastifyInstance["prisma"],
  pi: Stripe.PaymentIntent
) {
  // Pedido de la tienda en línea (source = "store"): se confirma aquí, no hay
  // Payment de reservación asociado. Ver handleStoreOrderPaid.
  if (pi.metadata?.source === "store" && pi.metadata?.orderId) {
    await handleStoreOrderPaid(prisma, pi);
    return;
  }

  // Buscar Payment existente por PI id (el mobile ya lo crea tras confirm).
  // Si existe y ya está PAID → noop. Si está en otro estado → forzar PAID y
  // confirmar la Reservation. Si no existe → safety net, loguear.
  const payment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: pi.id },
    include: {
      reservation: { include: { pet: true } },
      user: true,
    },
  });

  if (!payment) {
    console.warn(
      `[webhook] payment_intent.succeeded ${pi.id} sin Payment en DB — el cliente mobile debió crearlo. Posible app crash.`
    );
    return;
  }

  if (payment.status !== "PAID") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date() },
    });
  }

  if (payment.stripeFeeAmount == null) {
    await guardarComisionStripe(prisma, payment.id, pi.id);
  }

  // Si el PI es de tipo extension-balance, marcar la change request como pagada.
  if (pi.metadata?.type === "extension-balance" && pi.metadata?.changeRequestId) {
    const cr = await prisma.reservationChangeRequest.findUnique({
      where: { id: String(pi.metadata.changeRequestId) },
    });
    if (cr && !cr.paidAt) {
      await prisma.reservationChangeRequest.update({
        where: { id: cr.id },
        data: { paidAt: new Date() },
      });
    }
  }

  // Email de pago recibido (no es el de reservación confirmada — ese va en /multi).
  // Solo enviamos si este pago es de "balance" (no es el depósito inicial, que ya
  // tiene su email en la creación de la reserva).
  // `payment.reservation` puede ser null (pago de pedido de tienda): el correo
  // habla de la estancia de un perro, así que sin reserva no hay nada que enviar.
  if (pi.metadata?.type === "balance" && payment.user?.email && payment.reservation) {
    const tpl = paymentReceivedTemplate({
      ownerFirstName: payment.user.firstName,
      amount: Number(payment.amount),
      petName: payment.reservation.pet.name,
      method: "CARD",
      reservationStatus: payment.reservation.status,
    });
    await sendEmail({ to: payment.user.email, ...tpl });
  }
}

// Confirma un pedido de la tienda al recibir payment_intent.succeeded.
// En transacción: marca la orden PAID, decrementa inventario de cada item con
// control de stock e incrementa el uso del código de descuento. Idempotente:
// si la orden ya está PAID, no vuelve a descontar inventario.
async function handleStoreOrderPaid(
  prisma: FastifyInstance["prisma"],
  pi: Stripe.PaymentIntent
) {
  const orderId = String(pi.metadata.orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, discountCode: true },
  });

  if (!order) {
    console.warn(`[webhook] store order ${orderId} no encontrada (PI ${pi.id})`);
    return;
  }
  if (order.status === "PAID" || order.status === "FULFILLED") {
    return; // ya procesada
  }

  // Defensa: el monto cobrado debe coincidir con el total de la orden. Stripe
  // firma el webhook, pero esto blinda contra cualquier desfase entre la orden
  // y el PaymentIntent. Si no coincide, no confirmamos (requiere revisión).
  const expectedCents = Math.round(Number(order.total) * 100);
  if (Math.abs(pi.amount - expectedCents) > 1) {
    console.error(
      `[webhook] store order ${order.id}: monto PI ${pi.amount} ≠ total ${expectedCents}. No se confirma.`
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: pi.id },
    });

    // El pedido pagado ES un ingreso. Sin esta fila el dinero cae al banco pero
    // el negocio no lo ve en su mes: los ingresos salen exclusivamente de
    // `payments` (ver packages/db/sql/dashboard_views.sql).
    // `amount` = total bruto que pagó el cliente (incluye envío); la comisión de
    // Stripe se guarda aparte más abajo y las vistas restan el neto real.
    // upsert por stripePaymentIntentId (UNIQUE): si Stripe reintenta el webhook,
    // no duplica el ingreso.
    await tx.payment.upsert({
      where: { stripePaymentIntentId: pi.id },
      create: {
        amount: order.total,
        kind: "FULL",
        method: "STRIPE",
        status: "PAID",
        stripePaymentIntentId: pi.id,
        paidAt: new Date(),
        orderId: order.id,
        reservationId: null,
        userId: order.userId,
        notes: `Pedido de tienda #${order.orderNumber}`,
      },
      update: {},
    });

    // Decremento ATÓMICO con piso en 0: `SET quantity = GREATEST(quantity - n, 0)`
    // es una sola sentencia con lock de fila, así que no sufre lost-update ante
    // webhooks concurrentes y nunca deja el inventario negativo (sobreventa rara
    // por la ventana entre checkout y pago se topa en 0 y se alerta abajo).
    for (const item of order.items) {
      if (!item.variantId) continue;
      await tx.$executeRaw`
        UPDATE inventory
        SET quantity = GREATEST(quantity - ${item.quantity}, 0), "updatedAt" = now()
        WHERE "variantId" = ${item.variantId} AND "trackInventory" = true`;
    }

    if (order.discountCodeId) {
      await tx.discountCode.update({
        where: { id: order.discountCodeId },
        data: { usesCount: { increment: 1 } },
      });
    }

    // Cerrar el carrito y liberar su token (para que el invitado parta de cero).
    const cartId = typeof pi.metadata.cartId === "string" ? pi.metadata.cartId : null;
    if (cartId) {
      await tx.cart.updateMany({
        where: { id: cartId, status: "ACTIVE" },
        data: { status: "CONVERTED", sessionToken: null },
      });
    }
  });

  // Comisión de Stripe del ingreso recién creado. Fuera de la transacción
  // porque llama a la API de Stripe (no se sostiene una tx abierta sobre red).
  const ingreso = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: pi.id },
    select: { id: true, stripeFeeAmount: true },
  });
  if (ingreso && ingreso.stripeFeeAmount == null) {
    await guardarComisionStripe(prisma, ingreso.id, pi.id);
  }

  // Email de confirmación (tolerante a fallos). Va al email del pedido.
  if (order.email) {
    const tpl = orderConfirmedTemplate({
      orderNumber: order.orderNumber,
      total: Number(order.total),
      fulfillment: order.fulfillmentType,
      items: order.items.map((it) => ({
        name: it.productNameSnapshot,
        quantity: it.quantity,
        lineTotal: Number(it.lineTotal),
      })),
    });
    await sendEmail({ to: order.email, ...tpl });
  }

  // Notificar a los admins que entró un pedido nuevo.
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admins.length > 0) {
    await notifyUsers(
      prisma,
      admins.map((a) => a.id),
      {
        type: "GENERAL",
        title: "🛍️ Nuevo pedido en la tienda",
        body: `Pedido #${order.orderNumber} por $${Number(order.total).toLocaleString("es-MX")}.`,
        data: { orderId: order.id },
      }
    );
  }
}

async function handlePaymentIntentFailed(
  prisma: FastifyInstance["prisma"],
  pi: Stripe.PaymentIntent
) {
  // Intentar localizar owner por metadata
  const ownerId = typeof pi.metadata?.ownerId === "string" ? pi.metadata.ownerId : null;
  if (!ownerId) {
    console.warn(`[webhook] payment_intent.payment_failed ${pi.id} sin ownerId en metadata`);
    return;
  }
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner?.email) return;

  // Notificación in-app + push
  await notifyUser(prisma, {
    userId: owner.id,
    type: "GENERAL",
    title: "Pago no completado ⚠️",
    body: "No pudimos procesar tu último pago. Abre la app e intenta de nuevo.",
    data: { paymentIntentId: pi.id },
  });

  // Email
  const tpl = paymentFailedTemplate({
    ownerFirstName: owner.firstName,
    petName: null,
  });
  await sendEmail({ to: owner.email, ...tpl });
}

async function handleChargeRefunded(
  prisma: FastifyInstance["prisma"],
  charge: Stripe.Charge
) {
  // Stripe charge tiene payment_intent asociado; buscamos Payment por ese PI.
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) {
    console.warn(`[webhook] charge.refunded sin payment_intent`);
    return;
  }

  const originalPayment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: piId },
    include: {
      reservation: { include: { pet: true } },
      user: true,
    },
  });
  if (!originalPayment) {
    console.warn(`[webhook] charge.refunded ${charge.id} sin Payment asociado`);
    return;
  }

  // `amount_refunded` es el ACUMULADO del charge, no el monto de este
  // reembolso. Se registra solo la diferencia entre ese acumulado y lo que ya
  // está asentado como REFUNDED en el mismo ámbito: la reserva y sus hermanas
  // de grupo (un solo PI cobra a todo el grupo y cada fila reembolsa lo suyo
  // contra ese PI) o el pedido de tienda. Así ni se duplica lo que /cancel ya
  // creó, ni un segundo reembolso parcial se asienta con el total acumulado.
  // Con `reservationId` NULL (venta de tienda) se filtra por `orderId`: filtrar
  // por reservationId NULL matchearía CUALQUIER reembolso sin reserva.
  const refundedTotal = charge.amount_refunded / 100;
  const groupId = originalPayment.reservation?.groupId ?? null;
  const scope: Prisma.PaymentWhereInput = originalPayment.reservationId
    ? groupId
      ? { reservation: { groupId } }
      : { reservationId: originalPayment.reservationId }
    : { orderId: originalPayment.orderId };
  const already = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: { status: "REFUNDED", ...scope },
  });
  const refundAmount = Number(
    (refundedTotal - Number(already._sum.amount ?? 0)).toFixed(2),
  );
  if (refundAmount <= 0.005) return;

  await prisma.payment.create({
    data: {
      amount: new Prisma.Decimal(refundAmount),
      method: "STRIPE",
      status: "REFUNDED",
      stripePaymentIntentId: `${piId}_refund_${charge.id}`,
      paidAt: new Date(),
      reservationId: originalPayment.reservationId,
      orderId: originalPayment.orderId,
      userId: originalPayment.userId,
      notes: `Reembolso Stripe (webhook) — charge ${charge.id}`,
    },
  });

  // Reembolso de un pedido de tienda: además de registrar el movimiento, el
  // pedido queda REFUNDED. Antes no se hacía porque no había forma de llegar
  // del charge a la orden.
  if (originalPayment.orderId) {
    await prisma.order.updateMany({
      where: { id: originalPayment.orderId, status: { in: ["PAID", "FULFILLED"] } },
      data: { status: "REFUNDED" },
    });
  }

  // Pagos legacy walk-in pueden no tener usuario asociado → sin notificación.
  if (originalPayment.userId) {
    await notifyUser(prisma, {
      userId: originalPayment.userId,
      type: "REFUND_ISSUED",
      title: "Reembolso procesado 💳",
      body: `Te reembolsamos $${refundAmount.toLocaleString("es-MX")}.`,
      data: {
        reservationId: originalPayment.reservationId,
        orderId: originalPayment.orderId,
        amount: refundAmount,
      },
    });
  }

  // El correo habla de "la cancelación de la estancia de <perro>", así que solo
  // aplica a reembolsos de reservación. Un reembolso de pedido de tienda queda
  // registrado y notificado in-app, pero sin este correo: mandarlo diría que se
  // canceló una estancia que nunca existió. (Si algún día se quiere avisar por
  // correo del reembolso de un pedido, necesita su propio template.)
  if (originalPayment.user?.email && originalPayment.reservation) {
    const tpl = refundIssuedTemplate({
      ownerFirstName: originalPayment.user.firstName,
      amount: refundAmount,
      petName: originalPayment.reservation.pet.name,
      channel: "STRIPE",
    });
    await sendEmail({ to: originalPayment.user.email, ...tpl });
  }
}

async function handleDisputeCreated(
  prisma: FastifyInstance["prisma"],
  dispute: Stripe.Dispute
) {
  // Notificar a todos los admins — disputa requiere atención humana
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  const amount = dispute.amount / 100;
  await notifyUsers(prisma, admins.map((a) => a.id), {
    type: "STAFF_ALERT",
    title: "⚠️ Disputa de pago en Stripe",
    body: `Se abrió una disputa por $${amount.toLocaleString("es-MX")}. Responde en el dashboard de Stripe antes de la fecha límite.`,
    data: { disputeId: dispute.id, amount, reason: dispute.reason },
  });
}

/**
 * Stripe emitió un depósito hacia la cuenta del hotel.
 *
 * Reconstruye el desglose (qué cobros lo componen) y avisa a los admins. Es lo
 * que contesta la pregunta de siempre: "me llegó un SPEI de $663.80, ¿de qué
 * reservas es?". Sin esto había que abrir el dashboard de Stripe y cruzar a mano.
 */
async function handlePayoutPaid(
  prisma: FastifyInstance["prisma"],
  payout: Stripe.Payout
) {
  // Si esto truena, el catch del switch devuelve 500 y Stripe reintenta — que
  // es justo lo que queremos: sin el sync no hay desglose que mostrar.
  const result = await syncPayout(prisma, payout.id);

  // El aviso es best-effort y vive en lib/payouts.ts porque el cron diario
  // descubre depósitos por su cuenta y tiene que avisar igual (ver
  // `avisarPayoutSincronizado`). Nunca lanza.
  await avisarPayoutSincronizado(prisma, {
    payoutId: payout.id,
    amount: result.amount,
    lineCount: result.lineCount,
    arrivalDate: new Date(payout.arrival_date * 1000),
  });

  // Railway solo guarda logs: sin esta línea no hay forma de saber si un
  // depósito se concilió bien ni si cuadró.
  console.info("[handlePayoutPaid]", {
    payoutId: payout.id,
    amount: result.amount,
    lines: result.lineCount,
    matched: result.matched,
    unmatched: result.unmatched,
    cuadra: result.cuadra,
    diferencia: result.diferencia,
  });
}

/** El depósito rebotó (cuenta CLABE mal, banco rechazó). El dueño debe saberlo. */
async function handlePayoutFailed(
  prisma: FastifyInstance["prisma"],
  payout: Stripe.Payout
) {
  try {
    await syncPayout(prisma, payout.id);
  } catch (err) {
    console.error(`[handlePayoutFailed] no se pudo sincronizar ${payout.id}:`, err);
  }

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const monto = (payout.amount / 100).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  await notifyUsers(
    prisma,
    admins.map((a) => a.id),
    {
      type: "STAFF_ALERT",
      title: `⚠️ Depósito rechazado — $${monto}`,
      body: payout.failure_message
        ? `El banco lo rechazó: ${payout.failure_message}. Revisa tu cuenta en Stripe.`
        : "El banco rechazó el depósito. Revisa tu cuenta en Stripe.",
      data: { kind: "STRIPE_PAYOUT", payoutId: payout.id, amount: payout.amount / 100 },
      priority: "high",
    }
  );
}
