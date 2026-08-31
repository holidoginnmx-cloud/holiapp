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
    // Un depósito que ni se pudo bajar de Stripe no es un descuadre: no tiene
    // desglose que sumar. Decir "DESCUADRE de $0.00" ahí sería mentir sobre lo
    // que pasó y esconder el error real.
    if (r.error) {
      console.log(`   ✖ ${r.payoutId}  ${money(r.amount).padStart(12)}  NO SE PUDO CONCILIAR: ${r.error}`);
      continue;
    }
    const estado = r.cuadra ? "✔" : "✖";
    const partes = [`${r.lineCount} líneas`, `${r.matched} con pago`];
    if (r.porMetadata > 0) partes.push(`${r.porMetadata} solo por metadata`);
    if (r.unmatched > 0) partes.push(`${r.unmatched} ajustes`);
    const descuadre = r.cuadra ? "" : `  ⚠️  DESCUADRE de ${money(r.diferencia)}`;
    console.log(
      `   ${estado} ${r.payoutId}  ${money(r.amount).padStart(12)}  ${partes.join(" · ")}${descuadre}`
    );
  }

  const fallidos = results.filter((r) => r.error);
  const descuadrados = results.filter((r) => !r.error && !r.cuadra);
  const porMetadata = results.reduce((a, r) => a + r.porMetadata, 0);
  const sinIdentificar = results.reduce((a, r) => a + r.unmatched, 0);

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Depósitos:        ${results.length}`);
  console.log(`   Líneas totales:   ${results.reduce((a, r) => a + r.lineCount, 0)}`);
  console.log(`   Con pago:         ${results.reduce((a, r) => a + r.matched, 0)}`);
  console.log(`   Solo por metadata:${String(porMetadata).padStart(2)}  (COBRADOS pero sin registrar como pago)`);
  console.log(`   Ajustes:          ${sinIdentificar}  (comisiones y movimientos de Stripe)`);
  console.log(`   Descuadrados:     ${descuadrados.length}`);
  if (fallidos.length > 0) {
    console.log(`   Sin conciliar:    ${fallidos.length}  (no se pudieron bajar de Stripe)`);
  }

  if (porMetadata > 0) {
    console.log(
      "\n   ℹ️  Los de 'solo por metadata' SÍ se identifican en la pantalla de Depósitos:" +
        "\n      Stripe cobró y depositó ese dinero, pero nunca quedó registrado como" +
        "\n      pago, así que esas reservas figuran debiendo algo que ya se pagó."
    );
  }

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
