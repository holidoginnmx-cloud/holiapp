// Auditoría Stripe → DB: cobros que Stripe procesó y que NO existen como pago.
// Uso: npx tsx --env-file=.env src/scripts/audit-stripe-charges.ts [--days=90]
//
// Es el hermano de reconcile.ts, que mira en la dirección contraria (recorre
// nuestros pagos y verifica que existan en Stripe). Ese nunca puede encontrar
// esto: un cobro que jamás llegó a `payments` no tiene fila desde donde partir.
//
// Pasa cuando el webhook `payment_intent.succeeded` no corrió (API caída,
// endpoint mal configurado, Stripe agotó sus reintentos). El dinero cae al banco
// igual, pero la reserva sigue figurando como si debiera y los ingresos del mes
// salen cortos.
//
// SOLO LECTURA. Para darlos de alta, usa el botón "Registrar como pago" del
// depósito en el admin (o POST /admin/payouts/lines/:id/register-payment), que
// guarda el bruto en `amount` y la comisión aparte, como manda la convención.

import { PrismaClient } from "@holidoginn/db";
import Stripe from "stripe";

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

function money(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : 90;
  if (!Number.isFinite(days) || days < 1) {
    console.error("--days debe ser un entero positivo");
    process.exit(1);
  }

  const desde = Math.floor(Date.now() / 1000) - days * 86_400;
  console.log(`🔎 Cobros de Stripe de los últimos ${days} días sin registrar\n`);

  // `expand: balance_transaction` trae la comisión en el mismo viaje: sin ella
  // no se puede decir cuánto de ese dinero llegó de verdad al banco.
  const charges = await stripe.charges
    .list({ created: { gte: desde }, limit: 100, expand: ["data.balance_transaction"] })
    .autoPagingToArray({ limit: 1000 });

  const exitosos = charges.filter((c) => c.status === "succeeded" && !c.refunded);
  console.log(`   ${charges.length} cobros en Stripe · ${exitosos.length} exitosos sin reembolsar`);

  const piIds = [
    ...new Set(
      exitosos
        .map((c) => (typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id))
        .filter((v): v is string => !!v)
    ),
  ];

  // Un cobro está "registrado" si existe como pago de reserva O como pedido de
  // tienda: los pedidos también generan su fila en `payments`, pero el vínculo
  // vive en `orders`.
  const [pagos, pedidos] = await Promise.all([
    prisma.payment.findMany({
      where: { stripePaymentIntentId: { in: piIds } },
      select: { stripePaymentIntentId: true },
    }),
    prisma.order.findMany({
      where: { stripePaymentIntentId: { in: piIds } },
      select: { stripePaymentIntentId: true },
    }),
  ]);
  const registrados = new Set([
    ...pagos.map((p) => p.stripePaymentIntentId!),
    ...pedidos.map((o) => o.stripePaymentIntentId!),
  ]);

  const faltantes = exitosos.filter((c) => {
    const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
    return pi ? !registrados.has(pi) : true;
  });

  if (faltantes.length === 0) {
    console.log("\n✔ Todos los cobros de Stripe están registrados como pago.");
    return;
  }

  // La metadata es lo único que dice de quién era un cobro que nunca llegó a la
  // base: `ownerId` y `petIds` los pone la API al crear el PaymentIntent.
  const ownerIds = [
    ...new Set(faltantes.map((c) => c.metadata?.ownerId).filter((v): v is string => !!v)),
  ];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, `${o.firstName} ${o.lastName}`.trim()]));

  console.log(`\n⚠️  ${faltantes.length} cobros SIN registrar:\n`);
  let totalBruto = 0;
  let totalNeto = 0;
  for (const c of faltantes) {
    const bt = c.balance_transaction;
    const fee = bt && typeof bt !== "string" ? bt.fee / 100 : 0;
    const neto = bt && typeof bt !== "string" ? bt.net / 100 : c.amount / 100;
    totalBruto += c.amount / 100;
    totalNeto += neto;
    const quien =
      (c.metadata?.ownerId ? ownerById.get(c.metadata.ownerId) : null) ??
      c.billing_details?.name ??
      c.receipt_email ??
      "—";
    console.log(
      `   ${new Date(c.created * 1000).toISOString().slice(0, 10)}  ${money(c.amount / 100).padStart(11)} bruto  −${money(fee).padStart(8)}  = ${money(neto).padStart(11)}  ${quien}`
    );
    console.log(
      `      pi=${typeof c.payment_intent === "string" ? c.payment_intent : (c.payment_intent?.id ?? "—")}  metadata=${JSON.stringify(c.metadata ?? {})}`
    );
  }

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Cobros sin registrar: ${faltantes.length}`);
  console.log(`   Bruto que pagaron:    ${money(totalBruto)}`);
  console.log(`   Neto que entró:       ${money(totalNeto)}`);
  console.log(
    "\n   Ese dinero cayó al banco pero NO está en los ingresos, y sus reservas\n" +
      "   siguen figurando como si debieran. Se dan de alta desde el depósito\n" +
      "   correspondiente, con «Registrar como pago»."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
