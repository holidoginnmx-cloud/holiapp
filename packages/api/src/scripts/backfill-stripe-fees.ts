// Backfill de la comisión de Stripe en payments.stripeFeeAmount
// Uso: npm run backfill:stripe-fees
//
// Recorre los Payments de Stripe que aún no tienen stripeFeeAmount y lo puebla
// leyendo la comisión real de latest_charge.balance_transaction.fee. No toca
// `amount` (sigue bruto); el neto se deriva como amount - stripeFeeAmount y se
// usa en los ingresos globales (ver packages/db/sql/dashboard_views.sql).
//
// La lógica vive en lib/stripeFees.ts, compartida con el webhook
// `payment_intent.succeeded` y con el cron /internal/stripe-fees-sync: los tres
// tienen que escribir exactamente lo mismo.
//
// Idempotente y reejecutable: solo mira payments con stripeFeeAmount = null, así
// que los que hoy caen `pending` en Stripe (sin `fee` disponible) se recogen en
// una corrida posterior.
//
// OJO: necesita la STRIPE_SECRET_KEY de PRODUCCIÓN, que vive en Railway y no en
// local (ver la nota de entornos en el README del paquete). Correrlo con el .env
// de local habla con otra cuenta de Stripe y no encuentra ningún PaymentIntent.

import { PrismaClient } from "@holidoginn/db";
import { syncPendingStripeFees } from "../lib/stripeFees";

const prisma = new PrismaClient();

async function main() {
  console.log("💸 Backfill de comisiones de Stripe → payments.stripeFeeAmount");

  const res = await syncPendingStripeFees(prisma, {
    onRow: (linea) => console.log(linea),
  });

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Revisados:    ${res.revisados}`);
  console.log(`   Actualizados: ${res.actualizados}`);
  console.log(`   Pendientes:   ${res.pendientes}  (reejecutar más tarde)`);
  console.log(`   Errores:      ${res.errores}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error en backfill-stripe-fees:", err);
  await prisma.$disconnect();
  process.exit(1);
});
