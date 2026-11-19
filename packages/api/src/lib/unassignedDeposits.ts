import { Prisma } from "@holidoginn/db";
import type { PrismaClient } from "@holidoginn/db";
import {
  opFail as fail,
  opOk as ok,
  type OpActor,
  type ManualPaymentMethod,
} from "./reservationAdminOps";
import { notifyTeamReservationUpdated } from "./notify";
import { isCoOwner } from "./petAccess";
import { maybeConcludeStandaloneBath } from "../routes/baths";

/**
 * Anticipos SIN reserva ("Por asignar").
 *
 * Jessica pide al cliente sus datos y el anticipo. Hay quien paga el anticipo y
 * nunca manda los datos del perro, así que no hay reserva de la cual colgar el
 * pago. José lo anotaba en su Excel y en la app no existía: la semana no
 * cuadraba (Javier, 18-nov-2026).
 *
 * Un anticipo suelto es un `Payment` PAID/ANTICIPO con `reservationId` y
 * `orderId` en NULL. `userId` es opcional: si el cliente todavía no tiene
 * ficha, el nombre viaja en `notes` (obligatorio en ese caso). Cuenta como
 * ingreso desde el día del cobro y las vistas lo reportan en la banda
 * POR_ASIGNAR; al asignarlo a una reserva se mueve solo al servicio de esa
 * reserva y baja su saldo.
 *
 * Solo lo usa el admin web (`/internal/*`). PATCH y DELETE de
 * `/internal/payments/:id` ya aceptan un pago sin reserva.
 */

const money = (n: number) => n.toLocaleString("es-MX");

export type UnassignedDepositInput = {
  amount: number;
  method: ManualPaymentMethod;
  userId?: string | null;
  cardBrand?: string | null;
  cardFeePct?: number | null;
  cardFeeAmount?: number | null;
  notes?: string | null;
  reference?: string | null;
  paidAt?: Date | null;
};

export async function registerUnassignedDeposit(
  prisma: PrismaClient,
  params: { input: UnassignedDepositInput; actor: OpActor }
) {
  const { input } = params;
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return fail(400, "El monto debe ser un número mayor a 0", "VALIDATION");
  }
  if (!["CASH", "TRANSFER", "CARD"].includes(input.method)) {
    return fail(400, "Método inválido", "VALIDATION");
  }
  const notes = input.notes?.trim() || null;
  // Sin cliente ni nombre nadie sabría después a qué reserva asignarlo.
  if (!input.userId && !notes) {
    return fail(400, "Indica el cliente o escribe a nombre de quién es el anticipo", "VALIDATION");
  }
  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!user) return fail(404, "Cliente no encontrado", "NOT_FOUND");
  }

  const esTarjeta = input.method === "CARD";
  const payment = await prisma.payment.create({
    data: {
      amount: new Prisma.Decimal(Number(input.amount.toFixed(2))),
      method: input.method,
      status: "PAID",
      kind: "ANTICIPO",
      paidAt: input.paidAt ?? new Date(),
      reservationId: null,
      orderId: null,
      userId: input.userId ?? null,
      reference: input.reference?.trim() || null,
      notes: notes ?? "Anticipo sin reserva",
      cardBrand: esTarjeta ? input.cardBrand ?? null : null,
      cardFeePct: esTarjeta && input.cardFeePct != null ? new Prisma.Decimal(input.cardFeePct) : null,
      cardFeeAmount:
        esTarjeta && input.cardFeeAmount != null ? new Prisma.Decimal(input.cardFeeAmount) : null,
    },
  });
  // Sin push al cliente: puede ni tener la app, y el "Pago recibido" ya se lo
  // dio Jessica por WhatsApp cuando le confirmó la transferencia.
  return ok({ success: true as const, payment });
}

/**
 * Cuelga un anticipo suelto de una reserva. Si el anticipo ya tenía cliente y
 * la reserva es de otro (ni dueño ni co-dueño de la mascota), responde 409
 * OTHER_OWNER salvo que venga `confirmOtherOwner`: pasa con las cuentas
 * duplicadas (la misma persona con dos fichas), pero también es el error de
 * dedo típico, así que se confirma a propósito.
 */
export async function assignDepositToReservation(
  prisma: PrismaClient,
  params: {
    paymentId: string;
    reservationId: string;
    confirmOtherOwner?: boolean;
    actor: OpActor;
  }
) {
  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    select: {
      id: true,
      amount: true,
      status: true,
      reservationId: true,
      orderId: true,
      userId: true,
      notes: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!payment) return fail(404, "Pago no encontrado", "NOT_FOUND");
  if (payment.reservationId || payment.orderId) {
    return fail(409, "Este pago ya está asignado", "ALREADY_ASSIGNED");
  }
  if (payment.status !== "PAID" && payment.status !== "PARTIAL") {
    return fail(409, "Solo se asigna un anticipo cobrado", "NOT_PAID");
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    select: {
      id: true,
      status: true,
      reservationType: true,
      groupId: true,
      ownerId: true,
      petId: true,
      staffId: true,
      totalAmount: true,
      pet: { select: { name: true } },
      owner: { select: { firstName: true, lastName: true } },
    },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.status === "CANCELLED") {
    return fail(400, "La reservación está cancelada", "CANCELLED");
  }

  if (
    payment.userId &&
    payment.userId !== reservation.ownerId &&
    !params.confirmOtherOwner &&
    !(await isCoOwner(prisma, reservation.petId, payment.userId))
  ) {
    const ownerName = [reservation.owner.firstName, reservation.owner.lastName]
      .filter((s) => s && s !== "—")
      .join(" ");
    return fail(
      409,
      `La reserva de ${reservation.pet.name} es de ${ownerName || "otro cliente"}, no de quien pagó el anticipo. ¿Asignarlo de todos modos?`,
      "OTHER_OWNER",
      { ownerName }
    );
  }

  // El pago pasa a nombre del dueño de la reserva (así lo ven su ficha y sus
  // pendientes). Si pagó otra cuenta —co-dueño, ficha duplicada—, su nombre se
  // conserva en las notas para no perder quién entregó el dinero.
  const pagador =
    payment.userId && payment.userId !== reservation.ownerId && payment.user
      ? [payment.user.firstName, payment.user.lastName].filter((s) => s && s !== "—").join(" ")
      : null;
  const notes = pagador
    ? [payment.notes, `Pagado por ${pagador}`].filter(Boolean).join(" · ").slice(0, 500)
    : undefined;

  // Condicional: si dos personas asignan el mismo anticipo a la vez, solo una
  // gana (la otra recibe 409 en vez de mover el pago de reserva en silencio).
  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, reservationId: null, orderId: null },
    data: {
      reservationId: reservation.id,
      userId: reservation.ownerId,
      ...(notes !== undefined ? { notes } : {}),
    },
  });
  if (updated.count === 0) return fail(409, "Este pago ya está asignado", "ALREADY_ASSIGNED");

  const pagos = await prisma.payment.findMany({
    where: { reservationId: reservation.id, status: { in: ["PAID", "PARTIAL"] } },
    select: { amount: true },
  });
  const raw = Number(
    (Number(reservation.totalAmount) - pagos.reduce((s, p) => s + Number(p.amount), 0)).toFixed(2)
  );
  const balance = Math.max(0, raw);

  let groupBalance = balance;
  if (reservation.groupId) {
    const siblings = await prisma.reservation.findMany({
      where: { groupId: reservation.groupId, ownerId: reservation.ownerId, status: { not: "CANCELLED" } },
      select: {
        totalAmount: true,
        payments: { where: { status: { in: ["PAID", "PARTIAL"] } }, select: { amount: true } },
      },
    });
    groupBalance = Math.max(
      0,
      Number(
        siblings
          .reduce(
            (s, r) => s + Number(r.totalAmount) - r.payments.reduce((a, p) => a + Number(p.amount), 0),
            0
          )
          .toFixed(2)
      )
    );
  }

  // Un baño suelto ya terminado se cierra cuando queda liquidado (ver
  // bano-pagado-no-concluia): todo cobro de baño pasa por aquí.
  if (reservation.reservationType === "BATH") {
    await maybeConcludeStandaloneBath(prisma, reservation.id);
  }

  await notifyTeamReservationUpdated(prisma, {
    reservationId: reservation.id,
    petName: reservation.pet.name,
    body: `Se asignó un anticipo de $${money(Number(payment.amount))}. Saldo: $${money(balance)}.`,
    actorUserId: params.actor.userId,
    assignedStaffId: reservation.staffId,
  });

  const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return ok({
    success: true as const,
    payment: fresh,
    balance,
    groupBalance,
    overpaid: Math.max(0, -raw),
  });
}
