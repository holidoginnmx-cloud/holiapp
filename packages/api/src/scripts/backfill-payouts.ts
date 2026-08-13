// Backfill de los depósitos SPEI de Stripe → stripe_payouts / stripe_payout_lines
// Uso: npx tsx src/scripts/backfill-payouts.ts [--limit=100]
//
// El webhook `payout.paid` solo cubre los depósitos de aquí en adelante. Este
// script trae el histórico, que es lo que permite contestar la pregunta que
// originó la feature: "me llegaron $663.80 el 12 de agosto, ¿de qué son?".
//
// Idempotente y reejecutable: el PK de cada línea es el `txn_...` de Stripe, así
// que volver a correrlo es un UPSERT. Solo LEE de Stripe; lo único que escribe
// allá es nada — todo el efecto es local.
//
// Además reporta si algún depósito NO cuadra (la suma de sus líneas difiere del
// monto depositado). Un descuadre no se corrige solo: significa que Stripe
// devolvió movimientos que no supimos sumar, y hay que mirarlo a mano.

import { PrismaClient } from "@holidoginn/db";
import { syncRecentPayouts } from "../lib/payouts";

const prisma = new PrismaClient();

function money(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 100;
  if (!Number.isFinite(limit) || limit < 1) {
    console.error("--limit debe ser un entero positivo");
    process.exit(1);
  }

  console.log(`🏦 Backfill de depósitos de Stripe (últimos ${limit})`);

  const results = await syncRecentPayouts(prisma, { limit });

  console.log(`\n   ${results.length} depósitos sincronizados\n`);

  for (const r of results) {
    const estado = r.cuadra ? "✔" : "✖";
    const detalle = `${r.lineCount} líneas · ${r.matched} identificadas · ${r.unmatched} sin identificar`;
    const descuadre = r.cuadra ? "" : `  ⚠️  DESCUADRE de ${money(r.diferencia)}`;
    console.log(`   ${estado} ${r.payoutId}  ${money(r.amount).padStart(12)}  ${detalle}${descuadre}`);
  }

  const descuadrados = results.filter((r) => !r.cuadra);
  const sinIdentificar = results.reduce((a, r) => a + r.unmatched, 0);

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Depósitos:        ${results.length}`);
  console.log(`   Líneas totales:   ${results.reduce((a, r) => a + r.lineCount, 0)}`);
  console.log(`   Sin identificar:  ${sinIdentificar}  (ajustes de Stripe o cobros huérfanos)`);
  console.log(`   Descuadrados:     ${descuadrados.length}`);

  if (descuadrados.length > 0) {
    console.log("\n   ⚠️  Estos depósitos NO cuadran y hay que revisarlos en Stripe:");
    for (const r of descuadrados) {
      console.log(`      ${r.payoutId}  esperado ${money(r.amount)}  diferencia ${money(r.diferencia)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error en backfill-payouts:", err);
  await prisma.$disconnect();
  process.exit(1);
});
