import type { PrismaClient } from "@holidoginn/db";
import Stripe from "stripe";
import { notifyUser } from "./notify";
import { refundIssuedTemplate, sendEmail } from "./email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

type RefundChoice = "STRIPE_REFUND" | "CREDIT";

export type ProcessRefundOpts = {
  reservationId: string;
  refundChoice: RefundChoice;
};

/**
 * Reembolsa los pagos PAID/PARTIAL de una reservación, ya sea via Stripe
 * (revierte al método original de pago) o como saldo a favor (CreditLedger
 * + User.creditBalance). Crea Payment record con status REFUNDED, manda
 * push y email al dueño.
 *
 * Asume que la reserva ya está cancelada o por cancelarse externamente —
 * no toca Reservation.status. El llamador es responsable de marcarla.
 *
 * Idempotente solo en el sentido de no duplicar refunds: si ya existe un
 * Payment con status REFUNDED para la reserva, lanza error 409.
 */
export async function processRefund(
  prisma: PrismaClient,
  opts: ProcessRefundOpts
): Promise<{ refundAmount: number; refundChoice: RefundChoice }> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: opts.reservationId },
    include: { payments: true, pet: true },
  });
  if (!reservation) {
    throw new Error("Reservación no encontrada");
  }

  // Si ya hay un refund emitido, no duplicar.
  if (reservation.payments.some((p) => p.status === "REFUNDED")) {
    throw new Error("Ya se emitió un reembolso para esta reservación");
  }

  const paidPayments = reservation.payments.filter(
    (p) => p.status === "PAID" || p.status === "PARTIAL"
  );
  const refundAmount = paidPayments.reduce((s, p) => s + Number(p.amount), 0);
  const lastStripePayment = paidPayments
    .filter((p) => p.stripePaymentIntentId)
    .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0];

  if (refundAmount <= 0) {
    return { refundAmount: 0, refundChoice: opts.refundChoice };
  }

  if (opts.refundChoice === "STRIPE_REFUND" && !lastStripePayment) {
    throw new Error("El pago original no fue con tarjeta; elige saldo a favor");
  }

  const ownerForEmail = await prisma.user.findUnique({
    where: { id: reservation.ownerId },
    select: { email: true, firstName: true },
  });

  await prisma.$transaction(async (tx) => {
    if (
      opts.refundChoice === "STRIPE_REFUND" &&
      lastStripePayment?.stripePaymentIntentId
    ) {
      const refund = await stripe.refunds.create({
        payment_intent: lastStripePayment.stripePaymentIntentId,
        amount: Math.round(refundAmount * 100),
      });
      await tx.payment.create({
        data: {
          amount: refundAmount,
          method: "STRIPE",
          status: "REFUNDED",
          stripePaymentIntentId: refund.id,
          paidAt: new Date(),
          reservationId: reservation.id,
          userId: reservation.ownerId,
          notes: `Reembolso por cancelación de reservación`,
        },
      });
    } else {
      const updatedUser = await tx.user.update({
        where: { id: reservation.ownerId },
        data: {
          creditBalance: { increment: refundAmount },
          lastCreditEntryAt: new Date(),
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: reservation.ownerId,
          type: "CREDIT_ADDED",
          amount: refundAmount,
          balanceAfter: Number(updatedUser.creditBalance),
          description: `Saldo por cancelación de reservación de ${reservation.pet.name}`,
          reservationId: reservation.id,
        },
      });
    }
  });

  // Side-effects post-commit
  if (opts.refundChoice === "STRIPE_REFUND" && lastStripePayment?.stripePaymentIntentId) {
    await notifyUser(prisma, {
      userId: reservation.ownerId,
      type: "REFUND_ISSUED",
      title: "Reembolso procesado 💳",
      body: `Te reembolsamos $${refundAmount.toLocaleString("es-MX")} por la cancelación de ${reservation.pet.name}.`,
      data: { reservationId: reservation.id, amount: refundAmount },
    });
  } else {
    await notifyUser(prisma, {
      userId: reservation.ownerId,
      type: "CREDIT_ADDED",
      title: "Saldo a favor acreditado 💰",
      body: `Se acreditaron $${refundAmount.toLocaleString("es-MX")} a tu saldo por la cancelación de ${reservation.pet.name}.`,
      data: { reservationId: reservation.id, amount: refundAmount },
    });
  }

  if (ownerForEmail?.email) {
    const tpl = refundIssuedTemplate({
      ownerFirstName: ownerForEmail.firstName,
      amount: refundAmount,
      petName: reservation.pet.name,
      channel: opts.refundChoice === "STRIPE_REFUND" ? "STRIPE" : "CREDIT",
    });
    await sendEmail({ to: ownerForEmail.email, ...tpl });
  }

  return { refundAmount, refundChoice: opts.refundChoice };
}

/**
 * Determina si un cliente puede pedir refund a tarjeta para esta reserva
 * (i.e. tiene al menos un pago Stripe completado). Útil para que el modal
 * decida qué opciones mostrar.
 */
export function canStripeRefund(
  payments: { status: string; stripePaymentIntentId: string | null }[]
): boolean {
  return payments.some(
    (p) =>
      (p.status === "PAID" || p.status === "PARTIAL") &&
      !!p.stripePaymentIntentId
  );
}
