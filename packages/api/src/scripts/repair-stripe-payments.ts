// Repara pagos de Stripe cuyo monto o método se editaron a mano.
// Uso: npx tsx --env-file=.env src/scripts/repair-stripe-payments.ts [--apply]
//
// Sin --apply solo REPORTA (dry-run). Nada se escribe hasta pedirlo explícito.
//
// QUÉ ARREGLA
// -----------
// `payments.amount` guarda el BRUTO que pagó el cliente y la comisión va aparte
// en `stripeFeeAmount`; el neto lo calculan las vistas de ingresos restando una
// de otro. Editar el pago desde el admin web y teclear encima el neto que llegó
// al banco rompe las dos cosas: la comisión se descuenta dos veces y la reserva
// arrastra un saldo que el cliente ya pagó. Cambiar el método a TRANSFER además
// esconde que fue un cobro de Stripe.
//
// Caso real: un anticipo de $610 quedó como transferencia de $581.05 y su
// reserva figuraba debiendo $28.95 de más.
//
// DE DÓNDE SALEN LOS NÚMEROS
// --------------------------
// De la línea del depósito ya conciliado (`stripe_payout_lines`), que trae el
// bruto y la comisión exactos que reportó Stripe. Si el cobro todavía no viaja
// en ningún depósito sincronizado, se consulta Stripe directo. NUNCA se deduce
// un monto a partir del total de la reserva: eso sería adivinar.
//
// QUÉ NO TOCA
// -----------
// Dos casos donde `amount` ≠ bruto es lo CORRECTO y "arreglarlo" haría daño:
//
//   1. Reservas en grupo (varias mascotas). El PaymentIntent se guarda SOLO en
//      el primer pago, pero su `amount` es la parte de ESA reserva, no el total
//      cobrado.
//   2. Pagos donde el cliente usó saldo a favor. Stripe cobra el anticipo MENOS
//      el crédito aplicado, pero `payments.amount` guarda el anticipo completo
//      (ver routes/payments.ts: `chargeAmount = depositAmountBase - creditApplied`).
//      Bajar `amount` al bruto de Stripe le borraría al cliente el saldo que sí
//      aplicó, y su reserva quedaría debiendo esa diferencia.
//
// De esos dos solo se rellena la comisión, que nunca está de más.

import { PrismaClient, Prisma } from "@holidoginn/db";
import Stripe from "stripe";

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

function money(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Arreglo = {
  paymentId: string;
  reservationId: string | null;
  pi: string;
  amountActual: number;
  amountCorrecto: number;
  feeActual: number | null;
  feeCorrecta: number | null;
  methodActual: string;
  fuente: "deposito" | "stripe";
};

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `🔧 Pagos de Stripe con monto o método editados a mano ${apply ? "(APLICANDO)" : "(dry-run)"}\n`
  );

  // Candidatos: tienen PaymentIntent (o sea, los cobró Stripe) pero su método
  // dice otra cosa, o no tienen registrada la comisión.
  const candidatos = await prisma.payment.findMany({
    where: {
      stripePaymentIntentId: { not: null },
      NOT: { stripePaymentIntentId: { contains: "_refund_" } },
      OR: [{ method: { not: "STRIPE" } }, { stripeFeeAmount: null }],
      status: { in: ["PAID", "PARTIAL"] },
    },
    select: {
      id: true,
      amount: true,
      method: true,
      stripeFeeAmount: true,
      stripePaymentIntentId: true,
      reservationId: true,
      reservation: { select: { groupId: true, pet: { select: { name: true } } } },
    },
  });

  if (candidatos.length === 0) {
    console.log("✔ Nada que reparar.");
    return;
  }

  // Líneas de depósito ya conciliadas: la fuente preferida, porque son los
  // números que Stripe reportó al depositar y no cuestan una llamada de red.
  const lineas = await prisma.stripePayoutLine.findMany({
    where: {
      stripePaymentIntentId: { in: candidatos.map((c) => c.stripePaymentIntentId!) },
      type: { notIn: ["refund", "payment_refund", "refund_failure"] },
    },
    select: { stripePaymentIntentId: true, gross: true, fee: true },
  });
  const porPi = new Map(lineas.map((l) => [l.stripePaymentIntentId!, l]));

  // Reservas donde se aplicó saldo a favor: ahí el cobro de Stripe es menor que
  // el anticipo registrado, a propósito.
  const resvIds = candidatos
    .map((c) => c.reservationId)
    .filter((v): v is string => !!v);
  const conCredito = new Set(
    resvIds.length
      ? (
          await prisma.creditLedger.findMany({
            where: { reservationId: { in: resvIds }, type: "CREDIT_APPLIED" },
            select: { reservationId: true },
          })
        )
          .map((c) => c.reservationId)
          .filter((v): v is string => !!v)
      : []
  );

  const arreglos: Arreglo[] = [];
  const saltados: string[] = [];

  for (const p of candidatos) {
    const pi = p.stripePaymentIntentId!;

    // Dos casos donde el monto NO se toca (ver cabecera). No se saltan del todo:
    // rellenar la comisión que falte sigue siendo correcto y útil.
    const montoIntocable =
      !!p.reservation?.groupId ||
      (p.reservationId != null && conCredito.has(p.reservationId));
    const razonIntocable = p.reservation?.groupId
      ? "reserva en grupo — el monto parcial es correcto"
      : "el cliente aplicó saldo a favor — Stripe cobró menos que el anticipo";

    let gross: number | null = null;
    let fee: number | null = null;
    let fuente: Arreglo["fuente"] = "deposito";

    const linea = porPi.get(pi);
    if (linea) {
      gross = Number(linea.gross);
      fee = Number(linea.fee);
    } else {
      fuente = "stripe";
      try {
        const full = await stripe.paymentIntents.retrieve(pi, {
          expand: ["latest_charge.balance_transaction"],
        });
        const charge = full.latest_charge as Stripe.Charge | null;
        const bt = charge?.balance_transaction;
        if (full.amount) gross = full.amount / 100;
        if (bt && typeof bt !== "string") fee = bt.fee / 100;
      } catch (err) {
        saltados.push(`${p.id} (no se pudo leer ${pi} en Stripe: ${String(err).slice(0, 80)})`);
        continue;
      }
    }

    if (gross == null || !(gross > 0)) {
      saltados.push(`${p.id} (sin monto bruto confiable)`);
      continue;
    }

    const amountActual = Number(p.amount);
    const feeActual = p.stripeFeeAmount != null ? Number(p.stripeFeeAmount) : null;
    // Con el monto intocable, el objetivo es el que ya tiene: no se propone cambio.
    const amountCorrecto = montoIntocable ? amountActual : gross;
    const montoCambia = Math.abs(amountActual - amountCorrecto) > 0.005;
    const feeCambia = fee != null && (feeActual == null || Math.abs(feeActual - fee) > 0.005);
    const methodCambia = p.method !== "STRIPE";
    if (!montoCambia && !feeCambia && !methodCambia) continue;

    if (montoIntocable && Math.abs(amountActual - gross) > 0.005) {
      saltados.push(`${p.id} (monto sin tocar: ${razonIntocable})`);
    }

    arreglos.push({
      paymentId: p.id,
      reservationId: p.reservationId,
      pi,
      amountActual,
      amountCorrecto,
      feeActual,
      feeCorrecta: fee,
      methodActual: p.method,
      fuente,
    });
  }

  if (arreglos.length === 0) {
    console.log("✔ Nada que reparar.");
  }

  for (const a of arreglos) {
    console.log(`   payment ${a.paymentId}  (${a.fuente})`);
    const delta = a.amountCorrecto - a.amountActual;
    console.log(
      `      monto:    ${money(a.amountActual)} → ${money(a.amountCorrecto)}` +
        (Math.abs(delta) <= 0.005
          ? "   (sin cambio)"
          : delta > 0
            ? `   (la reserva figura debiendo ${money(delta)} que el cliente ya pagó)`
            : `   (la reserva da por pagados ${money(-delta)} de más)`)
    );
    console.log(
      `      comisión: ${a.feeActual == null ? "—" : money(a.feeActual)} → ${a.feeCorrecta == null ? "—" : money(a.feeCorrecta)}`
    );
    console.log(`      método:   ${a.methodActual} → STRIPE`);
  }

  if (saltados.length > 0) {
    console.log("\n   Saltados:");
    for (const s of saltados) console.log(`      ${s}`);
  }

  if (!apply) {
    console.log(`\n   ${arreglos.length} pago(s) por reparar. Corre con --apply para escribirlos.`);
    return;
  }

  for (const a of arreglos) {
    await prisma.payment.update({
      where: { id: a.paymentId },
      data: {
        amount: new Prisma.Decimal(a.amountCorrecto),
        method: "STRIPE",
        ...(a.feeCorrecta != null
          ? { stripeFeeAmount: new Prisma.Decimal(a.feeCorrecta) }
          : {}),
      },
    });
    console.log(`   ✔ ${a.paymentId} reparado`);
  }
  console.log(`\n   ${arreglos.length} pago(s) reparado(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
