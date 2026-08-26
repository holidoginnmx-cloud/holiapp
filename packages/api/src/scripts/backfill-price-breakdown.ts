// Backfill del desglose del cobro en estancias creadas ANTES de que las
// columnas lodgingAmount / medicationFee / sameDayFee existieran.
// Uso: railway run npx tsx src/scripts/backfill-price-breakdown.ts
//
// Reconstruye el desglose con la MISMA fórmula de la creación (hospedaje por
// peso × noches, +10% con medicamento, ×1.20 mismo día, − descuento,
// + domicilio, + addons BOOKING) y SOLO persiste cuando alguna combinación
// reproduce el totalAmount al centavo. Si no cuadra (tarifas que cambiaron,
// totales editados a mano, casos raros), la reserva se queda sin desglose —
// preferible a inventar cifras.
//
// Idempotente: solo mira estancias con lodgingAmount NULL.

import { PrismaClient, Prisma } from "@holidoginn/db";
import { pricePerDayForWeight } from "@holidoginn/shared/src/pricing";

const prisma = new PrismaClient();
const round2 = (n: number) => Number(n.toFixed(2));

async function main() {
  console.log("🧾 Backfill del desglose de estancias → lodging/medication/sameDay");

  const pricingRow = await prisma.lodgingPricing.findFirst();
  if (!pricingRow) throw new Error("Sin lodging_pricing");
  const pricing = {
    pricePerDaySmall: Number(pricingRow.pricePerDaySmall),
    pricePerDayLarge: Number(pricingRow.pricePerDayLarge),
    largeWeightKg: Number(pricingRow.largeWeightKg),
  } as any;

  const stays = await prisma.reservation.findMany({
    where: {
      reservationType: "STAY",
      lodgingAmount: null,
      totalDays: { gt: 0 },
      totalAmount: { gt: 0 },
    },
    include: {
      pet: { select: { name: true, weight: true } },
      addons: true,
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`   ${stays.length} estancias sin desglose`);

  let filled = 0;
  let skipped = 0;

  for (const r of stays) {
    const weight = r.pet?.weight != null ? Number(r.pet.weight) : null;
    if (!weight || !r.totalDays) {
      skipped++;
      continue;
    }
    const lodging = pricePerDayForWeight(weight, pricing) * r.totalDays;
    const med = r.medicationNotes?.trim() ? round2(lodging * 0.1) : 0;
    const discount = Number(r.discountTotal ?? 0);
    const delivery = Number(r.homeDeliveryFee ?? 0);

    // Addons que sumaron al total. Los creados junto con la reserva entraron
    // a la base ANTES del ×1.2 (así cobraba el flujo del dueño); los agregados
    // después se sumaron tal cual.
    const booking = r.addons.filter(
      (a) => a.paidWith === "BOOKING" && !a.isCourtesy && Number(a.unitPrice) > 0,
    );
    const creationMs = r.createdAt.getTime();
    const atCreation = booking
      .filter((a) => Math.abs(a.createdAt.getTime() - creationMs) < 10 * 60_000)
      .reduce((s, a) => s + Number(a.unitPrice), 0);
    const later = booking
      .filter((a) => Math.abs(a.createdAt.getTime() - creationMs) >= 10 * 60_000)
      .reduce((s, a) => s + Number(a.unitPrice), 0);

    const base = lodging + med + atCreation - discount;
    const total = Number(r.totalAmount);
    const matches: { mult: number }[] = [];
    for (const mult of [1, 1.2]) {
      const expected = round2(base * mult) + delivery + later;
      if (Math.abs(expected - total) <= 0.02) matches.push({ mult });
    }
    // El recargo solo existió en reservas hechas <24h antes del check-in: si
    // la reserva no fue de último momento, el match con 1.2 es coincidencia.
    const hoursAhead = r.checkIn
      ? (r.checkIn.getTime() - creationMs) / 3_600_000
      : Infinity;
    const valid = matches.filter((m) => m.mult === 1 || hoursAhead < 24);

    if (valid.length !== 1) {
      skipped++;
      console.log(
        `   … ${r.id}  ${r.pet?.name?.trim() ?? "?"}  total=${total}  sin match único (${valid.length})`,
      );
      continue;
    }

    const mult = valid[0].mult;
    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        lodgingAmount: new Prisma.Decimal(lodging),
        ...(med > 0 ? { medicationFee: new Prisma.Decimal(med) } : {}),
        ...(mult === 1.2
          ? { sameDayFee: new Prisma.Decimal(round2(base * 0.2)) }
          : {}),
      },
    });
    filled++;
    console.log(
      `   ✔ ${r.id}  ${r.pet?.name?.trim() ?? "?"}  hospedaje=${lodging}  med=${med}  mismoDia=${
        mult === 1.2 ? round2(base * 0.2) : 0
      }  total=${total}`,
    );
  }

  console.log("\n─────────── RESUMEN ───────────");
  console.log(`   Rellenadas: ${filled}`);
  console.log(`   Sin tocar:  ${skipped}  (no cuadran al centavo: se quedan sin desglose)`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error en backfill-price-breakdown:", err);
  await prisma.$disconnect();
  process.exit(1);
});
