import type { PrismaClient, ReservationStatus } from "@holidoginn/db";
import { notifyPetAudience } from "./notify";
import { requestReview } from "./reviewRequest";
import { notifyBalanceDue } from "./balanceReminder";

// ── Máquina de estados de una reservación ────────────────────────────────────
// El enum real es CONFIRMED → CHECKED_IN → CHECKED_OUT (+ CANCELLED): no hay
// PENDING ni COMPLETED; "finalizada" es CHECKED_OUT para los tres tipos.
//   CONFIRMED   → CHECKED_IN (STAY/DAYCARE), CANCELLED,
//                 CHECKED_OUT (BATH/DAYCARE: concluyen sin check-in)
//   CHECKED_IN  → CHECKED_OUT
//   CHECKED_OUT → CONFIRMED | CHECKED_IN (STAY/DAYCARE) — "reabrir", SOLO
//                 ADMIN: corrige un check-out hecho por error, sin avisos ni
//                 pagos. Es el único camino de salida de CHECKED_OUT.
//   CANCELLED   → nada (deshacer una cancelación implica dinero; no existe).
//
// Es la MISMA función que vive inline en `PATCH /reservations/:id/status`
// (routes/reservations.ts). Está aquí para que la ruta interna del admin web
// aplique exactamente las mismas reglas; cuando se pueda tocar ese archivo, el
// handler debe importarla de aquí y borrar su copia.
//
// Devuelve null si la transición es válida, o el mensaje del 409.
export function statusTransitionVerdict(
  from: ReservationStatus,
  to: ReservationStatus,
  type: string,
  isAdmin: boolean
): string | null {
  const hasCheckIn = type === "STAY" || type === "DAYCARE";
  switch (from) {
    case "CONFIRMED":
      if (to === "CANCELLED") return null;
      if (to === "CHECKED_IN") {
        return hasCheckIn ? null : "Un baño no hace check-in; se concluye al cobrarlo.";
      }
      if (to === "CHECKED_OUT") {
        return type === "STAY"
          ? "Una estancia no puede finalizar sin check-in. Haz el check-in primero o cancélala."
          : null;
      }
      return `Transición no válida: ${from} → ${to}`;
    case "CHECKED_IN":
      if (to === "CHECKED_OUT") return null;
      if (to === "CANCELLED") {
        return "Una reserva con la mascota en el hotel no se cancela: haz el check-out.";
      }
      return `Transición no válida: ${from} → ${to}`;
    case "CHECKED_OUT":
      if (to === "CONFIRMED" || (to === "CHECKED_IN" && hasCheckIn)) {
        return isAdmin ? null : "Solo un administrador puede reabrir una reserva finalizada.";
      }
      return "Una reserva finalizada no se cancela por aquí; reábrela primero (solo admin).";
    case "CANCELLED":
      return "Una reserva cancelada no se puede reactivar. Crea una nueva.";
    default:
      return `Transición no válida: ${from} → ${to}`;
  }
}

export type StatusTransitionInput = {
  reservationId: string;
  to: ReservationStatus;
  /** Quién lo hace: se vuelve responsable de la estancia en el check-in si es STAFF. */
  actorUserId: string | null;
  actorRole: string | null;
  isAdmin: boolean;
  /** Mover TODAS las filas del grupo multi-mascota (entran y salen juntas). */
  applyToGroup?: boolean;
  /**
   * Avisar al cliente. Default `true`.
   *
   * `false` es para CAPTURAR HISTORIAL: el panel da de alta una reserva del mes
   * pasado y la deja en su estado real (finalizada o cancelada). Sin esto, esa
   * captura dispara hoy "Tu mascota ya está hospedada", "Molly ya salió", la
   * petición de reseña y el aviso de saldo por una estancia que terminó hace
   * semanas. La transición y el dinero se aplican igual; solo se callan los
   * avisos (la acción sí queda en el log de la ruta).
   */
  notify?: boolean;
};

export type StatusTransitionResult =
  | {
      ok: true;
      data: {
        reservations: Array<{ id: string; status: ReservationStatus; petName: string }>;
        warnings: string[];
      };
    }
  | { ok: false; status: number; error: string; code?: string };

/**
 * Aplica la transición con los MISMOS efectos que la app del equipo:
 *   · check-in  (`/staff/stays/:id/checkin`): aviso CHECK_IN al dueño y
 *     co-dueños; el staff que lo hace queda como responsable si no había.
 *   · check-out (`/staff/stays/:id/checkout`): cancela solicitudes de cambio
 *     pendientes, aviso CHECK_OUT, solicitud de reseña y aviso de saldo.
 *   · cancelar: SOLO sin pagos (409 HAS_PAYMENTS); con dinero de por medio va
 *     por `cancelReservations` (lib/reservationAdminOps.ts), que decide el
 *     reembolso.
 *   · reabrir: solo admin, sin avisos.
 * Repetir el estado actual no es error (doble clic, reintento).
 *
 * Con `notify: false` se hace exactamente lo mismo en base (estados, staff
 * responsable, solicitudes de cambio) pero no sale ningún push: ni al cliente
 * ni la reseña ni el aviso de saldo. Ver `StatusTransitionInput.notify`.
 */
export async function applyStatusTransition(
  prisma: PrismaClient,
  input: StatusTransitionInput
): Promise<StatusTransitionResult> {
  const anchor = await prisma.reservation.findUnique({
    where: { id: input.reservationId },
    include: {
      pet: { select: { name: true } },
      checklists: { select: { id: true } },
      updates: { select: { id: true } },
      alerts: { where: { isResolved: false }, select: { id: true } },
    },
  });
  if (!anchor) {
    return { ok: false, status: 404, error: "Reservación no encontrada", code: "NOT_FOUND" };
  }

  const rows =
    input.applyToGroup && anchor.groupId
      ? await prisma.reservation.findMany({
          where: { groupId: anchor.groupId, ownerId: anchor.ownerId },
          include: {
            pet: { select: { name: true } },
            checklists: { select: { id: true } },
            updates: { select: { id: true } },
            alerts: { where: { isResolved: false }, select: { id: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [anchor];

  // Primero se valida TODO el grupo; si una fila no puede moverse, no se mueve
  // ninguna (medio grupo hospedado y medio no es peor que el error).
  const pending = rows.filter((r) => r.status !== input.to);
  for (const r of pending) {
    const verdict = statusTransitionVerdict(r.status, input.to, r.reservationType, input.isAdmin);
    if (verdict) {
      const quien = rows.length > 1 ? ` (${r.pet.name})` : "";
      return { ok: false, status: 409, error: `${verdict}${quien}`, code: "INVALID_TRANSITION" };
    }
  }

  if (input.to === "CANCELLED" && pending.length > 0) {
    const paidCount = await prisma.payment.count({
      where: {
        reservationId: { in: pending.map((r) => r.id) },
        status: { in: ["PAID", "PARTIAL"] },
      },
    });
    if (paidCount > 0) {
      return {
        ok: false,
        status: 409,
        error:
          "La reserva tiene pagos registrados. Usa la cancelación con reembolso (POST …/cancel).",
        code: "HAS_PAYMENTS",
      };
    }
  }

  const notify = input.notify !== false;
  const warnings: string[] = [];
  const result: Array<{ id: string; status: ReservationStatus; petName: string }> = [];

  for (const r of rows) {
    if (r.status === input.to) {
      result.push({ id: r.id, status: r.status, petName: r.pet.name });
      continue;
    }
    const from = r.status;
    const to = input.to;
    const label = rows.length > 1 ? `${r.pet.name}: ` : "";

    if (to === "CHECKED_IN" && from === "CONFIRMED") {
      await prisma.reservation.update({
        where: { id: r.id },
        data: {
          status: "CHECKED_IN",
          // El staff que recibe al perro queda como responsable si no había.
          ...(r.staffId || input.actorRole !== "STAFF" || !input.actorUserId
            ? {}
            : { staffId: input.actorUserId }),
        },
      });
      const esGuarderia = r.reservationType === "DAYCARE";
      if (notify)
        await notifyPetAudience(
          prisma,
          { petId: r.petId, ownerId: r.ownerId },
          {
            type: "CHECK_IN",
            title: esGuarderia ? "Tu mascota ya está en guardería" : "Tu mascota ya está hospedada",
            body: esGuarderia
              ? `${r.pet.name} ya se encuentra en HolidogInn. Estamos al pendiente 🐾`
              : `${r.pet.name} ya se encuentra en HolidogInn. Estamos al pendiente, te enviaremos actualizaciones diarias 🐾`,
            data: { reservationId: r.id },
          }
        );
    } else if (to === "CHECKED_OUT") {
      if (from === "CHECKED_IN") {
        if (r.checklists.length === 0) warnings.push(`${label}No hay reportes diarios registrados`);
        if (r.updates.length === 0) warnings.push(`${label}No hay evidencias (fotos/videos) registradas`);
        if (r.alerts.length > 0) warnings.push(`${label}Hay ${r.alerts.length} alerta(s) sin resolver`);
      }
      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({ where: { id: r.id }, data: { status: "CHECKED_OUT" } });
        await tx.reservationChangeRequest.updateMany({
          where: { reservationId: r.id, status: "PENDING" },
          data: { status: "CANCELLED", rejectionReason: "Reservación finalizada" },
        });
      });
      if (notify && from === "CHECKED_IN") {
        await notifyPetAudience(
          prisma,
          { petId: r.petId, ownerId: r.ownerId },
          {
            type: "CHECK_OUT",
            title: `${r.pet.name} ya salió 🐾`,
            body: `La estancia de ${r.pet.name} ha finalizado. Gracias por confiar en nosotros, nos vemos pronto.`,
            data: { reservationId: r.id },
          }
        );
      }
      // Por VISITA (grupo completo) e idempotentes: llamarlos por cada fila es
      // seguro y es lo que hace el check-out de la app. Ambos MANDAN push, así
      // que con `notify: false` (captura de historial) no se corren: pedir hoy
      // la reseña de una estancia de hace un mes es peor que no pedirla.
      if (notify) {
        await requestReview(prisma, r.id);
        await notifyBalanceDue(prisma, r.id);
      }
    } else if (to === "CANCELLED") {
      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
        await tx.reservationChangeRequest.updateMany({
          where: { reservationId: r.id, status: "PENDING" },
          data: { status: "CANCELLED", rejectionReason: "Reservación cancelada" },
        });
      });
      if (notify)
        await notifyPetAudience(
          prisma,
          { petId: r.petId, ownerId: r.ownerId },
          {
            type: "GENERAL",
            title: "Tu reserva fue cancelada",
            body: `Cancelamos la reserva de ${r.pet.name}.`,
            data: { reservationId: r.id },
          }
        );
    } else {
      // Reabrir (CHECKED_OUT → CONFIRMED/CHECKED_IN): sin avisos, a propósito.
      await prisma.reservation.update({ where: { id: r.id }, data: { status: to } });
    }
    result.push({ id: r.id, status: to, petName: r.pet.name });
  }

  return { ok: true, data: { reservations: result, warnings } };
}
