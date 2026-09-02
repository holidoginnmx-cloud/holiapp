import type { PrismaClient } from "@holidoginn/db";
import { notifyUser, notifyPetAudience } from "./notify";
import { requestReview } from "./reviewRequest";
import { notifyBalanceDue } from "./balanceReminder";
import { dayRangeUtc, localYMD } from "./bathAvailability";

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
    await notifyPetAudience(prisma, { petId: v.petId, ownerId: v.pet.ownerId }, {
      
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
    await notifyPetAudience(prisma, { petId: v.petId, ownerId: v.pet.ownerId }, {
      
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
    await notifyPetAudience(prisma, { petId: v.petId, ownerId: v.pet.ownerId }, {
      
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
      await notifyPetAudience(prisma, { petId: v.petId, ownerId: v.pet.ownerId }, {
        
        type: "VACCINE_EXPIRING",
        title: `Cartilla vencida: ${v.pet.name}`,
        body: `Tu cartilla quedó desactualizada. Súbela renovada para volver a reservar.`,
        data: { petId: v.pet.id, kind: "CARTILLA_EXPIRED" },
      });
    }
  }
}

// Auto-checkout STAY reservations cuyo checkOut ya pasó.
// Red de seguridad, no operación normal: el checkout lo hace el staff a mano.
// Antes corría a las 12 h del día de salida, pero cerraba estancias que el
// equipo aún necesitaba tocar (extender fechas, cobrar extras): una reserva
// CHECKED_OUT ya no se puede modificar. Ahora espera UNA SEMANA — si en 7 días
// nadie la cerró ni la movió, entonces sí se cierra sola.
const AUTO_CHECKOUT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export async function autoCheckoutOverdueStays(
  prisma: PrismaClient
): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_CHECKOUT_GRACE_MS);
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
    await notifyPetAudience(prisma, { petId: res.petId, ownerId: res.ownerId }, {
      
      type: "CHECK_OUT",
      title: `${res.pet.name} ya salió 🐾`,
      body: `La estancia de ${res.pet.name} ha finalizado. Gracias por confiar en nosotros, nos vemos pronto.`,
      data: { reservationId: res.id },
    });
    await requestReview(prisma, res.id);
    // El auto-checkout es justo donde más aparece el saldo olvidado: la
    // estancia se cierra sola y nadie cobró.
    await notifyBalanceDue(prisma, res.id);
  }
}

// Cierra lo que quedó atrás: citas de baño/guardería de un día YA PASADO y
// estancias cuyo checkOut pasó pero a las que nunca se les hizo check-in.
// Sin esto, cada cita olvidada se quedaba "Agendada" para siempre y ensuciaba
// las listas del día (el auto-checkout de arriba solo cubre las estancias que sí
// llegaron a check-in).
//
// Dos reglas deliberadas:
//
//  1. Solo se cierran las que NO tienen saldo pendiente. Una cita que aún debe
//     dinero tiene que seguir a la vista para poder cobrarla — cerrarla la saca
//     de las pantallas de cobro y el dinero se pierde de rastro. De paso, eso
//     protege el caso de la reserva abandonada: sin ningún pago, tiene saldo
//     completo, así que no se toca y se cancela a mano desde el admin (misma
//     política que dejó el incidente de los anticipos, ver nota de abajo).
//
//  2. En silencio, sin notificar. El auto-checkout de estancias avisa al cliente
//     ("ya salió" + reseña) porque ocurre el mismo día; esto barre rezago, y
//     mandar push por un baño de hace tres semanas sería absurdo.
//
// El corte es la medianoche local del hotel: "atrasada" = de un día anterior.
// Nunca cierra algo de hoy, que podría estar en curso.
export async function autoCompleteOverdueAppointments(
  prisma: PrismaClient
): Promise<number> {
  const startOfToday = dayRangeUtc(localYMD(new Date())).start;

  const candidates = await prisma.reservation.findMany({
    where: {
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      OR: [
        // Baño y guardería: son de un día y viven en `appointmentAt`.
        {
          reservationType: { in: ["BATH", "DAYCARE"] },
          appointmentAt: { lt: startOfToday },
        },
        // Estancia que nunca llegó a check-in (las CHECKED_IN ya las cierra
        // `autoCheckoutOverdueStays`, que además sí notifica). Misma gracia de
        // una semana: cerrada ya no se puede modificar, y el equipo a veces
        // corrige fechas o cobra días después de la salida.
        {
          reservationType: "STAY",
          status: "CONFIRMED",
          checkOut: { lt: new Date(startOfToday.getTime() - AUTO_CHECKOUT_GRACE_MS) },
        },
      ],
    },
    select: {
      id: true,
      totalAmount: true,
      payments: {
        where: { status: { in: ["PAID", "PARTIAL"] } },
        select: { amount: true },
      },
    },
  });

  // Mismo criterio de saldo que usa GET /reservations para `hasBalance`.
  const liquidadas = candidates.filter((r) => {
    const pagado = r.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    return Number(r.totalAmount) - pagado <= 0.01;
  });
  if (liquidadas.length === 0) return 0;

  const ids = liquidadas.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    await tx.reservation.updateMany({
      where: { id: { in: ids } },
      // `reviewRequestedAt` se sella aquí para que `requestPendingReviews` NO
      // las recoja: son rezago de días o semanas y pedir reseña por un baño de
      // hace tres semanas es justo lo que la regla 2 de arriba evita. Sellarlo
      // es más honesto que afinar la ventana del barrido.
      data: { status: "CHECKED_OUT", reviewRequestedAt: new Date() },
    });
    await tx.reservationChangeRequest.updateMany({
      where: { reservationId: { in: ids }, status: "PENDING" },
      data: { status: "CANCELLED", rejectionReason: "Reservación finalizada" },
    });
  });
  return ids.length;
}

// Pide reseña de las visitas que se cerraron SIN pasar por el API.
//
// El admin web finaliza reservaciones escribiendo directo a Supabase (no llama
// a esta API, por diseño: ver su CLAUDE.md §2), así que ningún `requestReview`
// corre en ese camino — que es justamente el más común, porque el equipo cierra
// desde la web. Este barrido lo cubre sin que el web tenga que saber del API.
//
// Dos topes deliberados:
//  1. Ventana de 14 días: nunca despierta visitas viejas. Junto con el backfill
//     de la migración (todo lo CHECKED_OUT nació con `reviewRequestedAt`), hace
//     imposible el aluvión de pushes históricos al desplegar.
//  2. Máximo 40 visitas por corrida: si un día se cierran 300 reservaciones, se
//     reparten entre corridas en vez de saturar Expo de un golpe.
const REVIEW_SWEEP_WINDOW_MS = 14 * 86_400_000;
const REVIEW_SWEEP_MAX_GROUPS = 40;

export async function requestPendingReviews(
  prisma: PrismaClient
): Promise<number> {
  const desde = new Date(Date.now() - REVIEW_SWEEP_WINDOW_MS);

  const candidates = await prisma.reservation.findMany({
    where: {
      status: "CHECKED_OUT",
      reviewRequestedAt: null,
      review: { is: null },
      // `updatedAt` es el único instante REAL de "cuándo se cerró esto":
      // `checkOut` guarda el día a 00:00 UTC y el `appointmentAt` de guardería
      // está anclado a mediodía UTC. El admin web lo escribe a mano en `aRow`
      // (app/(dashboard)/reservaciones/actions.ts) — si alguna vez deja de
      // hacerlo, sus check-outs dejarían de pedir reseña en silencio.
      updatedAt: { gte: desde },
    },
    select: { id: true, groupId: true },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  if (candidates.length === 0) return 0;

  // Una visita = un grupo. Basta pedirla por cualquier hermana: `requestReview`
  // resuelve el grupo completo y se salta los que aún no cierran del todo.
  const porVisita = new Map<string, string>();
  for (const r of candidates) {
    const key = r.groupId ?? r.id;
    if (!porVisita.has(key)) porVisita.set(key, r.id);
  }

  let enviadas = 0;
  for (const reservationId of [...porVisita.values()].slice(
    0,
    REVIEW_SWEEP_MAX_GROUPS
  )) {
    if (await requestReview(prisma, reservationId)) enviadas++;
    // Red de seguridad del mismo barrido: una visita que cerró con saldo y
    // cuyo aviso se perdió (proceso caído a media petición) se recupera aquí.
    await notifyBalanceDue(prisma, reservationId);
  }
  return enviadas;
}

// NOTA: aquí vivía `cancelOverdueDeposits`, que cancelaba automáticamente las
// reservas con anticipo (DEPOSIT) cuyo saldo no estuviera liquidado al llegar el
// `depositDeadline` (= la hora del check-in). Se eliminó el 2026-08-05: en la
// operación real el saldo se cobra AL ENTREGAR al perro, así que la regla
// cancelaba reservas legítimas justo cuando el cliente iba llegando (caso Bailey,
// 5 ago: $360 de anticipo pagados y cancelada a los 9 minutos del check-in).
// Las reservas abandonadas (sin ningún pago) se cancelan a mano desde el admin.
//
// `depositDeadline` se sigue guardando: es informativo y alimenta el aviso de
// "saldo pendiente" en la app del cliente.
