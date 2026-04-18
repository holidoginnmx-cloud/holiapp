// Script de conciliación Stripe ↔ DB
// Uso: npx tsx src/scripts/reconcile.ts
//
// Recorre todos los Payments con stripePaymentIntentId y verifica que:
//   1. El PaymentIntent existe en Stripe.
//   2. Su status coincide con el de DB.
//   3. El monto coincide (en centavos).
// Reporta un resumen de discrepancias. No modifica nada — es solo lectura.

import { PrismaClient } from "@holidoginn/db";
import Stripe from "stripe";

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

type Issue = {
  paymentId: string;
  paymentIntentId: string;
  reservationId: string;
  kind:
    | "STRIPE_MISSING"
    | "STATUS_MISMATCH"
    | "AMOUNT_MISMATCH"
    | "FETCH_ERROR";
  detail: string;
};

async function main() {
  console.log("🔎 Iniciando conciliación Stripe ↔ DB");

  const payments = await prisma.payment.findMany({
    where: {
      stripePaymentIntentId: { not: null },
      method: "STRIPE",
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`   ${payments.length} payments con stripePaymentIntentId`);
  const issues: Issue[] = [];
  let okCount = 0;

  for (const p of payments) {
    const piId = p.stripePaymentIntentId!;

    // Los refunds creados por el webhook usan ${piId}_refund_${chargeId} como
    // identificador sintético — no existen en Stripe como PaymentIntent, se
    // identifican con el prefix. Los saltamos.
    if (piId.includes("_refund_")) continue;

    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(piId);
    } catch (err: any) {
      if (err?.statusCode === 404) {
        issues.push({
          paymentId: p.id,
          paymentIntentId: piId,
          reservationId: p.reservationId,
          kind: "STRIPE_MISSING",
          detail: "PaymentIntent no existe en Stripe",
        });
      } else {
        issues.push({
          paymentId: p.id,
          paymentIntentId: piId,
          reservationId: p.reservationId,
          kind: "FETCH_ERROR",
          detail: err?.message ?? String(err),
        });
      }
      continue;
    }

    // Status mapping
    const dbStatusExpected =
      pi.status === "succeeded"
        ? ["PAID", "PARTIAL"]
        : pi.status === "requires_payment_method" || pi.status === "canceled"
        ? ["UNPAID"]
        : null;

    if (dbStatusExpected && !dbStatusExpected.includes(p.status)) {
      issues.push({
        paymentId: p.id,
        paymentIntentId: piId,
        reservationId: p.reservationId,
        kind: "STATUS_MISMATCH",
        detail: `Stripe=${pi.status}, DB=${p.status}`,
      });
    }

    // Amount mapping (en centavos)
    const expectedCents = Math.round(Number(p.amount) * 100);
    if (pi.amount !== expectedCents && p.status === "PAID") {
      issues.push({
        paymentId: p.id,
        paymentIntentId: piId,
        reservationId: p.reservationId,
        kind: "AMOUNT_MISMATCH",
        detail: `Stripe=${pi.amount}c, DB=${expectedCents}c`,
      });
    }

    if (!dbStatusExpected || dbStatusExpected.includes(p.status)) okCount++;
  }

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   OK:          ${okCount}`);
  console.log(`   Discrepant.: ${issues.length}`);

  if (issues.length > 0) {
    console.log("\n   DETALLE:");
    for (const i of issues) {
      console.log(`   · ${i.kind}  payment=${i.paymentId}  reserv=${i.reservationId}  — ${i.detail}`);
    }
    process.exitCode = 1;
  } else {
    console.log("   ✅ Todo en orden.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error en reconcile:", err);
  await prisma.$disconnect();
  process.exit(1);
});
