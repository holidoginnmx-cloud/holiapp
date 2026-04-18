import { FastifyInstance, FastifyRequest } from "fastify";
import Stripe from "stripe";
import {
  paymentReceivedTemplate,
  paymentFailedTemplate,
  refundIssuedTemplate,
  sendEmail,
} from "../lib/email";
import { notifyUser, notifyUsers } from "../lib/notify";
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

async function handlePaymentIntentSucceeded(
  prisma: FastifyInstance["prisma"],
  pi: Stripe.PaymentIntent
) {
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

  // Si la reserva estaba PENDING (anticipo o balance), confirmarla cuando esté totalmente pagada.
  if (payment.reservation.status === "PENDING") {
    const allPayments = await prisma.payment.findMany({
      where: { reservationId: payment.reservationId, status: "PAID" },
    });
    const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0);
    if (totalPaid >= Number(payment.reservation.totalAmount) - 0.01) {
      await prisma.reservation.update({
        where: { id: payment.reservationId },
        data: { status: "CONFIRMED" },
      });
    }
  }

  // Email de pago recibido (no es el de reservación confirmada — ese va en /multi).
  // Solo enviamos si este pago es de "balance" (no es el depósito inicial, que ya
  // tiene su email en la creación de la reserva).
  if (pi.metadata?.type === "balance" && payment.user.email) {
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

  // Si ya hay un Payment REFUNDED para esta reservación con el mismo monto, saltar
  // (el flujo de /cancel ya lo creó).
  const refundAmount = charge.amount_refunded / 100;
  const existingRefund = await prisma.payment.findFirst({
    where: {
      reservationId: originalPayment.reservationId,
      status: "REFUNDED",
      amount: { equals: new Prisma.Decimal(refundAmount) },
    },
  });
  if (existingRefund) return;

  await prisma.payment.create({
    data: {
      amount: new Prisma.Decimal(refundAmount),
      method: "STRIPE",
      status: "REFUNDED",
      stripePaymentIntentId: `${piId}_refund_${charge.id}`,
      paidAt: new Date(),
      reservationId: originalPayment.reservationId,
      userId: originalPayment.userId,
      notes: `Reembolso Stripe (webhook) — charge ${charge.id}`,
    },
  });

  await notifyUser(prisma, {
    userId: originalPayment.userId,
    type: "REFUND_ISSUED",
    title: "Reembolso procesado 💳",
    body: `Te reembolsamos $${refundAmount.toLocaleString("es-MX")}.`,
    data: { reservationId: originalPayment.reservationId, amount: refundAmount },
  });

  if (originalPayment.user.email) {
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
