import type { PrismaClient } from "@holidoginn/db";
import { notifyUser } from "./notify";

// Recordatorios automáticos de vacunas por vencer.
// Se dispara una sola notificación por (vacuna, ventana). Las ventanas son:
//   - 30 días antes  → reminded30dAt
//   - 7  días antes  → reminded7dAt
//   - el día (o ya vencida) → reminded0dAt
// Cuando el owner registra una nueva vacuna que reemplaza a otra, la nueva
// dispara recordatorios independientes (las marcas viven en cada vacuna).
export async function notifyExpiringVaccines(
  prisma: PrismaClient
): Promise<void> {
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86_400_000);
  const in30d = new Date(now.getTime() + 30 * 86_400_000);

  // 1. Vacunas que vencen en (now, +30d] sin recordatorio de 30d.
  const window30 = await prisma.vaccine.findMany({
    where: {
      reminded30dAt: null,
      expiresAt: { gt: now, lte: in30d },
    },
    include: {
      pet: { select: { id: true, name: true, ownerId: true } },
    },
  });

  // 2. Vacunas que vencen en (now, +7d] sin recordatorio de 7d.
  const window7 = await prisma.vaccine.findMany({
    where: {
      reminded7dAt: null,
      expiresAt: { gt: now, lte: in7d },
    },
    include: {
      pet: { select: { id: true, name: true, ownerId: true } },
    },
  });

  // 3. Vacunas vencidas (expiresAt <= now) sin recordatorio de 0d.
  const window0 = await prisma.vaccine.findMany({
    where: {
      reminded0dAt: null,
      expiresAt: { lte: now, not: null },
    },
    include: {
      pet: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          cartillaStatus: true,
        },
      },
    },
  });

  for (const v of window30) {
    await notifyUser(prisma, {
      userId: v.pet.ownerId,
      type: "VACCINE_EXPIRING",
      title: `Vacuna por vencer: ${v.pet.name} 💉`,
      body: `${v.name} de ${v.pet.name} vence en menos de 30 días. Agenda con tu veterinario.`,
      data: { petId: v.pet.id, vaccineId: v.id, window: "30d" },
    });
    await prisma.vaccine.update({
      where: { id: v.id },
      data: { reminded30dAt: now },
    });
  }

  for (const v of window7) {
    await notifyUser(prisma, {
      userId: v.pet.ownerId,
      type: "VACCINE_EXPIRING",
      title: `Vacuna vence pronto: ${v.pet.name} ⚠️`,
      body: `${v.name} de ${v.pet.name} vence en menos de 7 días. No olvides renovarla.`,
      data: { petId: v.pet.id, vaccineId: v.id, window: "7d" },
    });
    await prisma.vaccine.update({
      where: { id: v.id },
      data: { reminded7dAt: now },
    });
  }

  // Track qué pets ya marcamos EXPIRED en esta corrida (1 sola actualización por pet).
  const petsMarkedExpired = new Set<string>();

  for (const v of window0) {
    await notifyUser(prisma, {
      userId: v.pet.ownerId,
      type: "VACCINE_EXPIRING",
      title: `Vacuna vencida: ${v.pet.name} 🚨`,
      body: `${v.name} de ${v.pet.name} venció. Sube la cartilla actualizada para que el equipo HDI revise las nuevas vacunas.`,
      data: { petId: v.pet.id, vaccineId: v.id, window: "0d" },
    });
    await prisma.vaccine.update({
      where: { id: v.id },
      data: { reminded0dAt: now },
    });

    // Demotar cartilla a EXPIRED si seguía APPROVED.
    // Esto bloquea reservaciones nuevas (el guard sólo permite APPROVED).
    if (
      v.pet.cartillaStatus === "APPROVED" &&
      !petsMarkedExpired.has(v.pet.id)
    ) {
      await prisma.pet.update({
        where: { id: v.pet.id },
        data: { cartillaStatus: "EXPIRED" },
      });
      petsMarkedExpired.add(v.pet.id);
      await notifyUser(prisma, {
        userId: v.pet.ownerId,
        type: "VACCINE_EXPIRING",
        title: `Cartilla vencida: ${v.pet.name}`,
        body: `Tu cartilla quedó desactualizada. Súbela renovada para volver a reservar.`,
        data: { petId: v.pet.id, kind: "CARTILLA_EXPIRED" },
      });
    }
  }
}

// Auto-checkout STAY reservations cuyo checkOut ya pasó.
// Si el staff/admin olvidó hacer checkout, se ejecuta automáticamente
// a las 12:00 PM hora Hermosillo del día de salida. Como el picker de
// mobile guarda el día a 00:00 local (Hermosillo = UTC-7 → 07:00 UTC),
// 12 PM local de ese mismo día = checkOut + 12h.
export async function autoCheckoutOverdueStays(
  prisma: PrismaClient
): Promise<void> {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const overdue = await prisma.reservation.findMany({
    where: {
      status: "CHECKED_IN",
      checkOut: { lte: cutoff },
    },
    include: { pet: { select: { name: true } } },
  });
  for (const res of overdue) {
    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: res.id },
        data: { status: "CHECKED_OUT" },
      });
      await tx.reservationChangeRequest.updateMany({
        where: { reservationId: res.id, status: "PENDING" },
        data: { status: "CANCELLED", rejectionReason: "Reservación finalizada" },
      });
    });
    await notifyUser(prisma, {
      userId: res.ownerId,
      type: "CHECK_OUT",
      title: `${res.pet.name} ya salió 🐾`,
      body: `La estancia de ${res.pet.name} ha finalizado. Gracias por confiar en nosotros, nos vemos pronto.`,
      data: { reservationId: res.id },
    });
    await notifyUser(prisma, {
      userId: res.ownerId,
      type: "REVIEW_REQUEST",
      title: "¿Cómo fue la experiencia? ⭐",
      body: `Cuéntanos sobre la estancia de ${res.pet.name}. Tu reseña nos ayuda a mejorar.`,
      data: { reservationId: res.id },
    });
  }
}

// Auto-cancela reservaciones con anticipo (DEPOSIT) vencido.
// Las reservas DEPOSIT viven en CONFIRMED con saldo pendiente. Si el deadline
// (check-in) ya pasó y el saldo nunca se completó, la reserva queda colgada — la
// cancelamos. Se cancela en lote con un solo updateMany.
export async function cancelOverdueDeposits(prisma: PrismaClient): Promise<void> {
  const overdue = await prisma.reservation.findMany({
    where: {
      paymentType: "DEPOSIT",
      depositDeadline: { lt: new Date() },
      status: "CONFIRMED",
    },
    include: {
      payments: {
        where: { status: { in: ["PAID", "PARTIAL"] } },
        select: { amount: true },
      },
    },
  });
  const toCancel = overdue
    .filter((res) => {
      const totalPaid = res.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return totalPaid < Number(res.totalAmount);
    })
    .map((res) => res.id);
  if (toCancel.length > 0) {
    await prisma.reservation.updateMany({
      where: { id: { in: toCancel } },
      data: { status: "CANCELLED" },
    });
  }
}
