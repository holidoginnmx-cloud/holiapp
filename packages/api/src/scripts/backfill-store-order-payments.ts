// Backfill: un Payment PAID por cada pedido de tienda ya pagado.
//
// EN PRODUCCIÓN, desde packages/api:
//   railway run npx tsx src/scripts/backfill-store-order-payments.ts --dry-run
//   railway run npx tsx src/scripts/backfill-store-order-payments.ts
// `railway run` inyecta el env del servicio (BD de producción). OJO: NO usar el
// script de npm para esto — lleva `--env-file=.env` y pisaría ese env con el
// local, que apunta a otra base. El script de npm es solo para local.
//
// Los ingresos salen exclusivamente de `payments`, y hasta la entrega de ventas
// de tienda un pedido no podía tener Payment (reservationId era NOT NULL). Los
// pedidos confirmados por Stripe antes de eso nunca generaron fila, así que su
// dinero no aparece en los ingresos del mes en que se cobró — aunque sí cayera
// al banco. Este script los crea con paidAt = order.paidAt, de modo que caen en
// su mes real y no en el de hoy.
//
// Idempotente: salta los pedidos que ya tienen un pago no-REFUNDED. Correrlo dos
// veces no duplica ingresos.
//
// Después de este script conviene correr backfill-stripe-fees.ts: busca
// method=STRIPE + stripePaymentIntentId con stripeFeeAmount null y NO hace join
// a reservations, así que funciona tal cual sobre estas filas nuevas y les pone
// la comisión (el neto real que reportan las vistas).

import { PrismaClient } from "@holidoginn/db";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(
    `🛍️  Backfill de ingresos de pedidos de tienda${dryRun ? "  (DRY RUN — no escribe nada)" : ""}`
  );

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "FULFILLED"] },
      // Sin ningún pago vivo. Un pedido reembolsado sí puede tener su Payment
      // REFUNDED y aun así necesitar el PAID original.
      payments: { none: { status: { not: "REFUNDED" } } },
    },
    orderBy: { paidAt: "asc" },
  });

  console.log(`   ${orders.length} pedidos pagados sin ingreso registrado`);

  let creados = 0;
  let errores = 0;
  let totalMXN = 0;

  for (const o of orders) {
    // Los pedidos viejos siempre vinieron de Stripe; si por lo que sea no hay
    // PaymentIntent, se registra como efectivo (no inventamos un cobro Stripe
    // que la conciliación luego no encontraría).
    const method = o.stripePaymentIntentId ? "STRIPE" : "CASH";
    const paidAt = o.paidAt ?? o.updatedAt;

    console.log(
      `   ${dryRun ? "·" : "✔"} #${o.orderNumber}  ${paidAt.toISOString().slice(0, 10)}  $${Number(o.total)}  ${method}`
    );

    if (dryRun) {
      creados++;
      totalMXN += Number(o.total);
      continue;
    }

    try {
      await prisma.payment.create({
        data: {
          amount: o.total,
          kind: "FULL",
          method,
          status: "PAID",
          stripePaymentIntentId: o.stripePaymentIntentId,
          paidAt,
          orderId: o.id,
          reservationId: null,
          userId: o.userId,
          notes: `Pedido de tienda #${o.orderNumber} (backfill)`,
        },
      });
      creados++;
      totalMXN += Number(o.total);
    } catch (err: any) {
      errores++;
      console.warn(`   ✖ #${o.orderNumber} — ${err?.message ?? String(err)}`);
    }
  }

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Ingresos ${dryRun ? "que se crearían" : "creados"}: ${creados}`);
  console.log(`   Monto bruto total: $${totalMXN.toLocaleString("es-MX")}`);
  console.log(`   Errores: ${errores}`);
  if (!dryRun && creados > 0) {
    console.log("\n   Siguiente paso: npm run backfill:stripe-fees");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error en backfill-store-order-payments:", err);
  await prisma.$disconnect();
  process.exit(1);
});
