// Backfill de la comisión de Stripe en payments.stripeFeeAmount
// Uso: npx tsx src/scripts/backfill-stripe-fees.ts
//
// Recorre los Payments de Stripe que aún no tienen stripeFeeAmount y lo puebla
// leyendo la comisión real de latest_charge.balance_transaction.fee. No toca
// `amount` (sigue bruto); el neto se deriva como amount - stripeFeeAmount y se
// usa en los ingresos globales (ver packages/db/sql/dashboard_views.sql).
//
// Idempotente y reejecutable: solo mira payments con stripeFeeAmount = null, así
// que los que hoy caen `pending` en Stripe (sin `fee` disponible) se recogen en
// una corrida posterior.

import { PrismaClient, Prisma } from "@holidoginn/db";
import Stripe from "stripe";

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

async function main() {
  console.log("💸 Backfill de comisiones de Stripe → payments.stripeFeeAmount");

  const payments = await prisma.payment.findMany({
    where: {
      method: "STRIPE",
      stripePaymentIntentId: { not: null },
      stripeFeeAmount: null,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`   ${payments.length} payments Stripe sin comisión registrada`);

  let updated = 0;
  let pending = 0;
  let errors = 0;

  for (const p of payments) {
    const piId = p.stripePaymentIntentId!;

    // Los refunds sintéticos (${piId}_refund_${chargeId}) no son PaymentIntents.
    if (piId.includes("_refund_")) continue;

    try {
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ["latest_charge.balance_transaction"],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      const bt = charge?.balance_transaction;

      if (bt && typeof bt !== "string" && bt.fee != null) {
        const fee = new Prisma.Decimal(bt.fee / 100);
        await prisma.payment.update({
          where: { id: p.id },
          data: { stripeFeeAmount: fee },
        });
        updated++;
        console.log(
          `   ✔ ${p.id}  amount=${p.amount}  fee=${fee}  neto=${new Prisma.Decimal(
            p.amount
          ).minus(fee)}`
        );
      } else {
        pending++;
        console.log(`   … ${p.id}  comisión aún no disponible (balance pending)`);
      }
    } catch (err: any) {
      errors++;
      console.warn(`   ✖ ${p.id}  PI=${piId}  — ${err?.message ?? String(err)}`);
    }
  }

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Actualizados: ${updated}`);
  console.log(`   Pendientes:   ${pending}  (reejecutar más tarde)`);
  console.log(`   Errores:      ${errors}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error en backfill-stripe-fees:", err);
  await prisma.$disconnect();
  process.exit(1);
});
