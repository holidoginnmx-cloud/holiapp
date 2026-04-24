import { FastifyInstance } from "fastify";
import Stripe from "stripe";
import {
  CreateChangeRequestSchema,
  RejectChangeRequestSchema,
} from "@holidoginn/shared";
import {
  createAuthMiddleware,
  createAdminMiddleware,
} from "../middleware/auth";
import { computeChangeTotal } from "../lib/pricing";
import { notifyUser, notifyUsers } from "../lib/notify";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

const MODIFIABLE_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"] as const;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function changeRequestsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const ownerAuth = [authMiddleware];
  const adminAuth = [authMiddleware, adminMiddleware];

  // ─── helper: compute new total for a reservation given new dates
  async function buildPreview(reservationId: string, newCheckIn: Date, newCheckOut: Date) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        pet: true,
        payments: true,
        addons: { include: { variant: true } },
      },
    });
    if (!reservation) return { error: "Reservación no encontrada" as const };
    if (reservation.reservationType !== "STAY") {
      return { error: "Solo se pueden modificar fechas de hospedajes" as const };
    }

    const existingBathTotal = reservation.addons.reduce(
      (sum, a) => sum + Number(a.unitPrice),
      0
    );
    const { newTotalDays, newTotal } = computeChangeTotal({
      petWeightKg: reservation.pet.weight,
      newCheckIn,
      newCheckOut,
      hasMedication: !!reservation.medicationNotes,
      existingBathTotal,
    });
    const currentTotal = Number(reservation.totalAmount);
    const delta = newTotal - currentTotal;
    const lastPaid = reservation.payments
      .filter((p) => p.status === "PAID")
      .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0];

    return {
      reservation,
      preview: {
        newTotalDays,
        newTotal,
        currentTotal,
        delta,
        requiresApproval: delta > 0,
        lastPaymentMethod: lastPaid?.method ?? null,
      },
    };
  }

  // ─── POST /reservations/:id/change-requests/preview ────────────
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/change-requests/preview",
    { preHandler: ownerAuth },
    async (request, reply) => {
      const parsed = CreateChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const result = await buildPreview(
        request.params.id,
        parsed.data.newCheckIn,
        parsed.data.newCheckOut
      );
      if ("error" in result) return reply.status(404).send({ error: result.error });
      if (result.reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      return reply.send(result.preview);
    }
  );

  // ─── POST /reservations/:id/change-requests ────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/change-requests",
    { preHandler: ownerAuth },
    async (request, reply) => {
      const parsed = CreateChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { newCheckIn, newCheckOut, refundChoice } = parsed.data;

      const result = await buildPreview(request.params.id, newCheckIn, newCheckOut);
      if ("error" in result) return reply.status(404).send({ error: result.error });

      const { reservation, preview } = result;
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      if (!MODIFIABLE_STATUSES.includes(reservation.status as any)) {
        return reply.status(400).send({
          error: "Solo se pueden modificar reservaciones pendientes, confirmadas o activas",
        });
      }

      if (newCheckOut <= newCheckIn) {
        return reply.status(400).send({ error: "La fecha de salida debe ser posterior a la entrada" });
      }

      const today = startOfToday();
      if (reservation.status === "CHECKED_IN") {
        if (
          reservation.checkIn &&
          newCheckIn.getTime() !== reservation.checkIn.getTime()
        ) {
          return reply.status(400).send({
            error: "No puedes cambiar la fecha de entrada durante la estancia",
          });
        }
        if (newCheckOut < today) {
          return reply.status(400).send({ error: "La nueva salida no puede ser anterior a hoy" });
        }
      } else {
        if (newCheckIn < today) {
          return reply.status(400).send({ error: "La nueva entrada no puede ser en el pasado" });
        }
      }

      if (preview.delta === 0) {
        return reply.status(400).send({ error: "Sin cambio en el monto" });
      }

      // Deposit gate: balance must be paid in full
      const totalPaid = reservation.payments
        .filter((p) => p.status === "PAID")
        .reduce((s, p) => s + Number(p.amount), 0);
      const hasOutstandingBalance = totalPaid < Number(reservation.totalAmount) - 0.01;
      if (hasOutstandingBalance) {
        return reply.status(409).send({
          error: "Liquida el saldo antes de modificar fechas",
        });
      }

      // ─── Extension path ────────────────────────────────────────
      if (preview.delta > 0) {
        const existingPending = await prisma.reservationChangeRequest.findFirst({
          where: { reservationId: reservation.id, status: "PENDING" },
        });
        if (existingPending) {
          return reply.status(409).send({ error: "Ya tienes una solicitud de cambio pendiente" });
        }

        const created = await prisma.reservationChangeRequest.create({
          data: {
            reservationId: reservation.id,
            requestedById: request.userId!,
            newCheckIn,
            newCheckOut,
            newTotalDays: preview.newTotalDays,
            newTotalAmount: preview.newTotal,
            deltaAmount: preview.delta,
            status: "PENDING",
          },
        });

        const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
        await notifyUsers(prisma, admins.map((a) => a.id), {
          type: "RESERVATION_CHANGE_REQUESTED" as const,
          title: "Nueva solicitud de cambio 📅",
          body: `${reservation.pet.name}: extender a ${newTotalDays(preview.newTotalDays)}, +$${preview.delta.toLocaleString("es-MX")}`,
          data: { reservationId: reservation.id, changeRequestId: created.id },
        });

        // Notificar al staff asignado (si existe)
        if (reservation.staffId) {
          await notifyUser(prisma, {
            userId: reservation.staffId,
            type: "RESERVATION_CHANGE_REQUESTED" as any,
            title: `Cambio solicitado: ${reservation.pet.name} 📅`,
            body: `El dueño solicitó extender la estancia a ${newTotalDays(preview.newTotalDays)}. Pendiente de aprobación del admin.`,
            data: { reservationId: reservation.id, changeRequestId: created.id },
          });
        }

        return reply.status(201).send({ request: created, requiresApproval: true });
      }

      // ─── Shortening path (delta < 0) — immediate ──────────────
      if (!refundChoice) {
        return reply.status(400).send({ error: "Selecciona reembolso o saldo a favor" });
      }
      if (refundChoice === "STRIPE_REFUND" && preview.lastPaymentMethod !== "STRIPE") {
        return reply.status(409).send({
          error: "El pago original no fue con tarjeta; elige saldo a favor",
        });
      }

      const refundAmount = -preview.delta; // positive

      const resultTx = await prisma.$transaction(async (tx) => {
        const updatedReservation = await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            checkIn: newCheckIn,
            checkOut: newCheckOut,
            totalDays: preview.newTotalDays,
            totalAmount: preview.newTotal,
            depositDeadline: reservation.paymentType === "DEPOSIT"
              ? new Date(newCheckIn.getTime() - 48 * 60 * 60 * 1000)
              : reservation.depositDeadline,
          },
        });

        const changeRequest = await tx.reservationChangeRequest.create({
          data: {
            reservationId: reservation.id,
            requestedById: request.userId!,
            newCheckIn,
            newCheckOut,
            newTotalDays: preview.newTotalDays,
            newTotalAmount: preview.newTotal,
            deltaAmount: preview.delta,
            refundChoice,
            status: "APPROVED",
            approvedById: request.userId!,
            approvedAt: new Date(),
          },
        });

        if (refundChoice === "STRIPE_REFUND") {
          const lastStripePayment = reservation.payments
            .filter((p) => p.status === "PAID" && p.stripePaymentIntentId)
            .sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0];
          if (!lastStripePayment?.stripePaymentIntentId) {
            throw new Error("No se encontró pago Stripe para reembolsar");
          }
          const refund = await stripe.refunds.create({
            payment_intent: lastStripePayment.stripePaymentIntentId,
            amount: Math.round(refundAmount * 100),
          });
          await tx.payment.create({
            data: {
              amount: refundAmount,
              method: "STRIPE",
              status: "REFUNDED",
              stripePaymentIntentId: refund.id,
              paidAt: new Date(),
              reservationId: reservation.id,
              userId: reservation.ownerId,
              notes: `Reembolso por recorte de estadía (change request ${changeRequest.id})`,
            },
          });
          await tx.notification.create({
            data: {
              userId: reservation.ownerId,
              type: "REFUND_ISSUED",
              title: "Reembolso procesado 💳",
              body: `Te reembolsamos $${refundAmount.toLocaleString("es-MX")} por el recorte de ${reservation.pet.name}.`,
              data: { reservationId: reservation.id, amount: refundAmount },
            },
          });
        } else {
          // CREDIT
          const updatedUser = await tx.user.update({
            where: { id: reservation.ownerId },
            data: { creditBalance: { increment: refundAmount } },
          });
          await tx.creditLedger.create({
            data: {
              userId: reservation.ownerId,
              type: "CREDIT_ADDED",
              amount: refundAmount,
              balanceAfter: Number(updatedUser.creditBalance),
              description: `Saldo por recorte de estadía de ${reservation.pet.name}`,
              reservationId: reservation.id,
              changeRequestId: changeRequest.id,
            },
          });
          await tx.notification.create({
            data: {
              userId: reservation.ownerId,
              type: "CREDIT_ADDED",
              title: "Saldo a favor acreditado 💰",
              body: `Se acreditaron $${refundAmount.toLocaleString("es-MX")} a tu saldo por el recorte de ${reservation.pet.name}.`,
              data: { reservationId: reservation.id, amount: refundAmount },
            },
          });
        }

        return { updatedReservation, changeRequest };
      });

      return reply.status(201).send({
        request: resultTx.changeRequest,
        requiresApproval: false,
        applied: true,
      });
    }
  );

  // ─── GET /reservations/:id/change-requests ─────────────────────
  fastify.get<{ Params: { id: string } }>(
    "/reservations/:id/change-requests",
    { preHandler: ownerAuth },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) return reply.status(404).send({ error: "Reservación no encontrada" });
      if (reservation.ownerId !== request.userId && request.userRole !== "ADMIN") {
        return reply.status(403).send({ error: "No autorizado" });
      }
      const list = await prisma.reservationChangeRequest.findMany({
        where: { reservationId: request.params.id },
        orderBy: { createdAt: "desc" },
        include: {
          requestedBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return reply.send(list);
    }
  );

  // ─── GET /admin/change-requests?status=PENDING ─────────────────
  fastify.get<{ Querystring: { status?: string } }>(
    "/admin/change-requests",
    { preHandler: adminAuth },
    async (request, reply) => {
      const status = (request.query.status ?? "PENDING") as any;
      const list = await prisma.reservationChangeRequest.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        include: {
          reservation: {
            include: {
              pet: { select: { id: true, name: true } },
              owner: { select: { id: true, firstName: true, lastName: true, email: true } },
              room: { select: { id: true, name: true } },
              payments: true,
            },
          },
          requestedBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return reply.send(list);
    }
  );

  // ─── POST /admin/change-requests/:id/approve ───────────────────
  fastify.post<{ Params: { id: string } }>(
    "/admin/change-requests/:id/approve",
    { preHandler: adminAuth },
    async (request, reply) => {
      const cr = await prisma.reservationChangeRequest.findUnique({
        where: { id: request.params.id },
        include: { reservation: { include: { pet: true } } },
      });
      if (!cr) return reply.status(404).send({ error: "Solicitud no encontrada" });
      if (cr.status !== "PENDING") {
        return reply.status(400).send({ error: "Solicitud ya procesada" });
      }
      if (Number(cr.deltaAmount) <= 0) {
        return reply.status(400).send({
          error: "Esta solicitud no requiere aprobación (recortes son inmediatos)",
        });
      }

      // Room availability check (exclude this reservation)
      if (cr.reservation.roomId) {
        const conflict = await prisma.reservation.findFirst({
          where: {
            roomId: cr.reservation.roomId,
            id: { not: cr.reservationId },
            status: { notIn: ["CANCELLED", "CHECKED_OUT"] as any },
            AND: [
              { checkIn: { lt: cr.newCheckOut } },
              { checkOut: { gt: cr.newCheckIn } },
            ],
          },
        });
        if (conflict) {
          return reply.status(409).send({
            error: "Habitación no disponible en las nuevas fechas",
            conflictingReservationId: conflict.id,
          });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: cr.reservationId },
          data: {
            checkIn: cr.newCheckIn,
            checkOut: cr.newCheckOut,
            totalDays: cr.newTotalDays,
            totalAmount: cr.newTotalAmount,
            depositDeadline: cr.reservation.paymentType === "DEPOSIT"
              ? new Date(cr.newCheckIn.getTime() - 48 * 60 * 60 * 1000)
              : cr.reservation.depositDeadline,
          },
        });
        await tx.reservationChangeRequest.update({
          where: { id: cr.id },
          data: {
            status: "APPROVED",
            approvedById: request.userId!,
            approvedAt: new Date(),
          },
        });
        await tx.notification.create({
          data: {
            userId: cr.reservation.ownerId,
            type: "RESERVATION_CHANGE_APPROVED",
            title: "Tu extensión fue aprobada ✅",
            body: `Extendimos la estadía de ${cr.reservation.pet.name}. Tienes un saldo pendiente de $${Number(cr.deltaAmount).toLocaleString("es-MX")}.`,
            data: {
              reservationId: cr.reservationId,
              requiresPayment: true,
              amount: Number(cr.deltaAmount),
            },
          },
        });
        // Notificar al staff asignado
        if (cr.reservation.staffId) {
          await tx.notification.create({
            data: {
              userId: cr.reservation.staffId,
              type: "RESERVATION_CHANGE_APPROVED" as any,
              title: `Extensión aprobada: ${cr.reservation.pet.name} ✅`,
              body: `La estancia se extendió a ${cr.newTotalDays} ${cr.newTotalDays === 1 ? "día" : "días"}. Nuevas fechas ya aplicadas.`,
              data: { reservationId: cr.reservationId },
            },
          });
        }
      });

      return reply.send({ success: true });
    }
  );

  // ─── POST /admin/change-requests/:id/reject ────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/admin/change-requests/:id/reject",
    { preHandler: adminAuth },
    async (request, reply) => {
      const parsed = RejectChangeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const cr = await prisma.reservationChangeRequest.findUnique({
        where: { id: request.params.id },
        include: { reservation: { include: { pet: true } } },
      });
      if (!cr) return reply.status(404).send({ error: "Solicitud no encontrada" });
      if (cr.status !== "PENDING") {
        return reply.status(400).send({ error: "Solicitud ya procesada" });
      }

      await prisma.reservationChangeRequest.update({
        where: { id: cr.id },
        data: {
          status: "REJECTED",
          rejectionReason: parsed.data.reason,
          approvedById: request.userId!,
          approvedAt: new Date(),
        },
      });
      await notifyUser(prisma, {
        userId: cr.reservation.ownerId,
        type: "RESERVATION_CHANGE_REJECTED",
        title: "Solicitud de cambio rechazada",
        body: parsed.data.reason,
        data: { reservationId: cr.reservationId, reason: parsed.data.reason },
      });

      // Notificar al staff asignado
      if (cr.reservation.staffId) {
        await notifyUser(prisma, {
          userId: cr.reservation.staffId,
          type: "RESERVATION_CHANGE_REJECTED" as any,
          title: `Cambio rechazado: ${cr.reservation.pet.name}`,
          body: `La solicitud de cambio de fechas fue rechazada. Motivo: ${parsed.data.reason}`,
          data: { reservationId: cr.reservationId },
        });
      }

      return reply.send({ success: true });
    }
  );
}

function newTotalDays(days: number): string {
  return `${days} ${days === 1 ? "día" : "días"}`;
}
