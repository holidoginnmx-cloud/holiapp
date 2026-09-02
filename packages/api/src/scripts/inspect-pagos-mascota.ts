// Radiografía de las reservas y los pagos de una mascota. SOLO LECTURA.
// Uso: npx tsx --env-file=../db/.env src/scripts/inspect-pagos-mascota.ts Dugan
//
// Para qué: `repair-stripe-payments` sólo ve pagos que conservan su
// PaymentIntent. Si a un cobro de Stripe lo "corrigieron" borrándolo y
// registrándolo a mano, desaparece de ese radar aunque haya quedado mal: el
// monto puede seguir siendo el NETO que llegó al banco y la comisión perdida.
// Esto muestra los datos crudos para decidir con la vista, sin tocar nada.

import { PrismaClient } from "@holidoginn/db";

const prisma = new PrismaClient();

function money(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function duenoDe(o: { firstName: string; lastName: string } | null | undefined): string {
  if (!o) return "sin dueño";
  return `${o.firstName} ${o.lastName}`.trim() || "sin dueño";
}

function dia(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

// Comisión de Stripe MX: (bruto × 3.6% + 3) × 1.16. Despejando el bruto a
// partir de un neto se ve si un monto "raro" es en realidad un neto tecleado
// encima: si el bruto implícito cae en una cifra redonda, casi seguro lo es.
function brutoImplicito(neto: number): number {
  return (neto + 3 * 1.16) / (1 - 0.036 * 1.16);
}

async function main() {
  const termino = process.argv[2];
  if (!termino) {
    console.error("Falta el nombre. Ej: ... inspect-pagos-mascota.ts Dugan");
    process.exit(1);
  }

  const reservas = await prisma.reservation.findMany({
    where: { pet: { name: { contains: termino, mode: "insensitive" } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reservationType: true,
      status: true,
      groupId: true,
      checkIn: true,
      checkOut: true,
      appointmentAt: true,
      totalAmount: true,
      createdAt: true,
      pet: { select: { name: true, owner: { select: { firstName: true, lastName: true } } } },
      payments: {
        orderBy: { paidAt: "asc" },
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          kind: true,
          stripeFeeAmount: true,
          stripePaymentIntentId: true,
          paidAt: true,
          notes: true,
        },
      },
    },
  });

  if (reservas.length === 0) {
    console.log(`Sin reservas para una mascota que se llame como "${termino}".`);
    return;
  }

  console.log(`\n🔎 ${reservas.length} reserva(s) de "${termino}"  (solo lectura)\n`);

  for (const r of reservas) {
    const total = Number(r.totalAmount ?? 0);
    const pagado = r.payments
      .filter((p) => p.status === "PAID" || p.status === "PARTIAL")
      .reduce((a, p) => a + Number(p.amount), 0);
    const saldo = total - pagado;

    console.log(
      `── ${r.pet?.name ?? "?"} (${duenoDe(r.pet?.owner)})  ·  ${r.reservationType}  ${r.status}` +
        (r.groupId ? "  [reserva en grupo]" : "")
    );
    console.log(`   reserva ${r.id}   creada ${dia(r.createdAt)}`);
    console.log(
      `   fechas: ${dia(r.checkIn)} → ${dia(r.checkOut)}` +
        (r.appointmentAt ? `   cita ${r.appointmentAt.toISOString().slice(0, 16).replace("T", " ")}` : "")
    );
    console.log(
      `   total ${money(total)}   pagado ${money(pagado)}   ` +
        (Math.abs(saldo) < 0.005
          ? "saldo 0 ✔"
          : saldo > 0
            ? `SALDO PENDIENTE ${money(saldo)}`
            : `pagado de más ${money(-saldo)}`)
    );

    if (r.payments.length === 0) {
      console.log("   (sin pagos registrados)");
    }
    for (const p of r.payments) {
      const monto = Number(p.amount);
      const fee = p.stripeFeeAmount != null ? Number(p.stripeFeeAmount) : null;
      console.log(
        `   • ${money(monto)}  ${p.method}/${p.status}/${p.kind}  ${dia(p.paidAt)}  ${p.id}`
      );
      console.log(
        `       comisión Stripe: ${fee == null ? "—" : money(fee)}` +
          `   PaymentIntent: ${p.stripePaymentIntentId ?? "—"}` +
          (p.notes ? `   notas: ${p.notes}` : "")
      );
      // Pista de neteo: no tiene PaymentIntent y su bruto implícito es redondo.
      if (!p.stripePaymentIntentId) {
        const bruto = brutoImplicito(monto);
        const redondo = Math.abs(bruto - Math.round(bruto / 10) * 10) < 0.6;
        if (redondo && monto > 50) {
          console.log(
            `       ⚠️  posible NETO tecleado a mano: si fue cobro de Stripe, el bruto sería ~${money(
              Math.round(bruto / 10) * 10
            )}`
          );
        }
      }
    }
    console.log("");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
