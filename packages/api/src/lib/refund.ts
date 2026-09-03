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
  /**
   * Avisar al dueño (push + correo). Default `true`.
   *
   * `false` es para capturar HISTORIAL: el panel registra una reserva del mes
   * pasado que ya se canceló y se reembolsó en mostrador. El dinero y el
   * ledger se aplican igual; lo que no sale es el push, porque avisar hoy de
   * un reembolso de hace semanas confunde al cliente.
   */
  notify?: boolean;
};

type PaidPayment = {
  id: string;
  amount: number;
  method: string;
  stripePaymentIntentId: string | null;
};

/**
 * Cómo se devuelve el dinero de una reserva. Regla: a la tarjeta solo puede
 * volver lo que la tarjeta pagó, y de cada PaymentIntent solo lo que ese
 * PaymentIntent cobró; lo demás (efectivo, transferencia, saldo a favor ya
 * aplicado, terminal) se acredita como saldo a favor.
 *
 * Antes se sumaban TODOS los pagos y se pedía ese monto a Stripe contra el
 * último PI: con $300 de anticipo por tarjeta y $700 en efectivo, Stripe
 * rechazaba un reembolso de $1,000 sobre un PI de $300 y la reserva quedaba
 * cancelada sin reembolso.
 *
 * Pura y exportada para poder probarla sin Stripe ni base.
 */
export function planRefund(
  payments: PaidPayment[],
  refundChoice: RefundChoice,
  /** PI del grupo (multi-mascota) cuando esta fila no lo tiene colgado. */
  groupPaymentIntentId: string | null = null,
): {
  total: number;
  toStripe: Array<{ paymentIntentId: string; amount: number; paymentId: string }>;
  toCredit: number;
} {
  const total = Number(payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
  if (refundChoice === "CREDIT") {
    return { total, toStripe: [], toCredit: total };
  }
  const toStripe: Array<{ paymentIntentId: string; amount: number; paymentId: string }> = [];
  let toCredit = 0;
  for (const p of payments) {
    if (p.amount <= 0) continue;
    // Un pago STRIPE sin PI es una fila hermana de un grupo: el cargo real
    // vive en el PI de la primera fila.
    const pi =
      p.method === "STRIPE" ? p.stripePaymentIntentId ?? groupPaymentIntentId : null;
    if (pi) {
      toStripe.push({ paymentIntentId: pi, amount: p.amount, paymentId: p.id });
    } else {
      toCredit += p.amount;
    }
  }
  return { total, toStripe, toCredit: Number(toCredit.toFixed(2)) };
}

/**
 * Reembolsa los pagos PAID/PARTIAL de una reservación, ya sea via Stripe
 * (revierte al método original de pago, lo que la tarjeta pagó) o como saldo
 * a favor (CreditLedger + User.creditBalance). Crea Payment records con
 * status REFUNDED, manda push y email al dueño.
 *
 * Asume que la reserva ya está cancelada o por cancelarse externamente —
 * no toca Reservation.status. El llamador es responsable de marcarla.
 *
 * Idempotente en dos capas: si ya existe un Payment REFUNDED para la reserva
 * lanza error 409; y cada refund de Stripe lleva una llave de idempotencia
 * (reserva + pago), así que si la escritura en base falla después de que
 * Stripe reembolsó, el reintento recibe el MISMO refund en vez de emitir otro.
 */
export async function processRefund(
  prisma: PrismaClient,
  opts: ProcessRefundOpts
): Promise<{
  refundAmount: number;
  refundChoice: RefundChoice;
  refundedToCard: number;
  creditedToBalance: number;
}> {
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

  const paidPayments: PaidPayment[] = reservation.payments
    .filter((p) => p.status === "PAID" || p.status === "PARTIAL")
    .map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      stripePaymentIntentId: p.stripePaymentIntentId,
    }));

  // Multi-mascota: el PI cuelga de la primera fila del grupo; las hermanas
  // tienen pagos STRIPE sin PI.
  let groupPaymentIntentId: string | null = null;
  if (
    reservation.groupId &&
    paidPayments.some((p) => p.method === "STRIPE" && !p.stripePaymentIntentId)
  ) {
    // El PI del booking es el más antiguo del grupo (una hermana pudo liquidar
    // su saldo después con OTRO PI, que no cobró a esta fila).
    const sibling = await prisma.payment.findFirst({
      where: {
        reservation: { groupId: reservation.groupId },
        stripePaymentIntentId: { not: null },
        status: { in: ["PAID", "PARTIAL"] },
      },
      orderBy: { paidAt: "asc" },
      select: { stripePaymentIntentId: true },
    });
    groupPaymentIntentId = sibling?.stripePaymentIntentId ?? null;
  }

  const plan = planRefund(paidPayments, opts.refundChoice, groupPaymentIntentId);
  const refundAmount = plan.total;

  if (refundAmount <= 0) {
    return {
      refundAmount: 0,
      refundChoice: opts.refundChoice,
      refundedToCard: 0,
      creditedToBalance: 0,
    };
  }

  if (opts.refundChoice === "STRIPE_REFUND" && plan.toStripe.length === 0) {
    throw new Error("El pago original no fue con tarjeta; elige saldo a favor");
  }

  const ownerForEmail = await prisma.user.findUnique({
    where: { id: reservation.ownerId },
    select: { email: true, firstName: true },
  });

  // 1) Stripe, FUERA de la transacción de base (una llamada externa dentro de
  //    una transacción interactiva la mantiene abierta y, si la escritura
  //    falla, el reembolso ya salió sin fila REFUNDED). Con la llave de
  //    idempotencia, reintentar es seguro.
  const stripeRefunds: Array<{ refundId: string; amount: number }> = [];
  for (const item of plan.toStripe) {
    const refund = await stripe.refunds.create(
      {
        payment_intent: item.paymentIntentId,
        amount: Math.round(item.amount * 100),
      },
      { idempotencyKey: `refund-${reservation.id}-${item.paymentId}` },
    );
    stripeRefunds.push({ refundId: refund.id, amount: item.amount });
  }
  const refundedToCard = Number(
    stripeRefunds.reduce((s, r) => s + r.amount, 0).toFixed(2),
  );
  const creditedToBalance = plan.toCredit;

  // 2) Registro en base: filas REFUNDED por cada refund de Stripe y, si hay
  //    parte no reembolsable a tarjeta, saldo a favor con su ledger.
  await prisma.$transaction(async (tx) => {
    for (const r of stripeRefunds) {
      await tx.payment.create({
        data: {
          amount: r.amount,
          method: "STRIPE",
          status: "REFUNDED",
          stripePaymentIntentId: r.refundId,
          paidAt: new Date(),
          reservationId: reservation.id,
          userId: reservation.ownerId,
          notes: `Reembolso por cancelación de reservación`,
        },
      });
    }
    if (creditedToBalance > 0) {
      const updatedUser = await tx.user.update({
        where: { id: reservation.ownerId },
        data: {
          creditBalance: { increment: creditedToBalance },
          lastCreditEntryAt: new Date(),
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: reservation.ownerId,
          type: "CREDIT_ADDED",
          amount: creditedToBalance,
          balanceAfter: Number(updatedUser.creditBalance),
          description: `Saldo por cancelación de reservación de ${reservation.pet.name}`,
          reservationId: reservation.id,
        },
      });
      // Rastro del saldo acreditado como pago REFUNDED (método CREDIT),
      // SIEMPRE: es el único candado contra un segundo reembolso (el guard de
      // arriba y `issue-refund` buscan una fila REFUNDED). Antes, con
      // "saldo a favor" no se creaba ninguna y el cliente podía volver a elegir
      // y acreditarse el doble.
      await tx.payment.create({
        data: {
          amount: creditedToBalance,
          method: "CREDIT",
          status: "REFUNDED",
          paidAt: new Date(),
          reservationId: reservation.id,
          userId: reservation.ownerId,
          notes:
            opts.refundChoice === "STRIPE_REFUND"
              ? `Acreditado como saldo a favor (no se pagó con tarjeta)`
              : `Reembolso como saldo a favor por cancelación`,
        },
      });
    }
  });

  // Side-effects post-commit
  //
  // Estos avisos van SOLO a `reservation.ownerId`, no a la audiencia de la
  // mascota: el dinero es de quien reservó y pagó. Decirle a un co-dueño "se
  // acreditaron $X a tu saldo" sería falso — su `creditBalance` es aparte. La
  // cancelación en sí sí se le avisa a los dos por otro lado.
  if (opts.notify === false) {
    return {
      refundAmount,
      refundChoice: opts.refundChoice,
      refundedToCard,
      creditedToBalance,
    };
  }

  const fmt = (n: number) => n.toLocaleString("es-MX");
  if (refundedToCard > 0 && creditedToBalance > 0) {
    await notifyUser(prisma, {
      userId: reservation.ownerId,
      type: "REFUND_ISSUED",
      title: "Reembolso procesado 💳",
      body: `Te reembolsamos $${fmt(refundedToCard)} a tu tarjeta y $${fmt(creditedToBalance)} quedaron como saldo a favor por la cancelación de ${reservation.pet.name}.`,
      data: { reservationId: reservation.id, amount: refundAmount },
    });
  } else if (refundedToCard > 0) {
    await notifyUser(prisma, {
      userId: reservation.ownerId,
      type: "REFUND_ISSUED",
      title: "Reembolso procesado 💳",
      body: `Te reembolsamos $${fmt(refundedToCard)} por la cancelación de ${reservation.pet.name}.`,
      data: { reservationId: reservation.id, amount: refundedToCard },
    });
  } else {
    await notifyUser(prisma, {
      userId: reservation.ownerId,
      type: "CREDIT_ADDED",
      title: "Saldo a favor acreditado 💰",
      body: `Se acreditaron $${fmt(creditedToBalance)} a tu saldo por la cancelación de ${reservation.pet.name}.`,
      data: { reservationId: reservation.id, amount: creditedToBalance },
    });
  }

  if (ownerForEmail?.email) {
    const tpl = refundIssuedTemplate({
      ownerFirstName: ownerForEmail.firstName,
      amount: refundAmount,
      petName: reservation.pet.name,
      channel: refundedToCard > 0 ? "STRIPE" : "CREDIT",
    });
    await sendEmail({ to: ownerForEmail.email, ...tpl });
  }

  return {
    refundAmount,
    refundChoice: opts.refundChoice,
    refundedToCard,
    creditedToBalance,
  };
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
