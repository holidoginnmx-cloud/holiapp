import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CreateReservationSchema,
  AdminCreateAddonSchema,
  ReservationStatusEnum,
  TimeHHmmSchema,
  UpdateReservationDeliverySchema,
  UpdateDaycareScheduleSchema,
  DeliveryTripSchema,
} from "@holidoginn/shared";
import { createInternalGuard, logInternal } from "../lib/internalAuth";
import {
  assignStaff,
  assignRoom,
  previewDatesChange,
  applyDatesChange,
  updateReservationBasics,
  addReservationAddon,
  removeReservationAddon,
  cancelReservations,
  registerManualPayment,
  deleteReservation,
  deletePayment,
  updatePayment,
  updateReservationAddon,
  changeReservationPet,
  type OpActor,
  type OpError,
} from "../lib/reservationAdminOps";
import { applyDeliveryUpdate } from "../lib/deliveryUpdate";
import { applyDaycareScheduleUpdate } from "../lib/daycareSchedule";
import { applyStatusTransition } from "../lib/reservationStatus";
import { createTeamReservation, teamCreatePayload } from "../lib/reservationTeamCreate";
import { applyReservationTimesUpdate } from "../lib/stayTimes";

// ─────────────────────────────────────────────────────────────────────────────
//  /internal/reservations/* — administración de reservas para el ADMIN WEB
//
//  El panel web (Next.js + Supabase) escribía directo en `reservations`,
//  `payments` y `reservation_addons` sin las reglas de esta API: al cancelar no
//  reembolsaba ni avisaba, al mover fechas no recalculaba el desglose, tocaba
//  una sola fila del grupo multi-mascota y no mandaba ninguna notificación.
//  Estas rutas son las gemelas de `/admin/*` (mismas funciones de
//  lib/reservationAdminOps.ts) autenticadas server-to-server:
//
//    x-cron-secret : CRON_SECRET compartido (401 si falta o no coincide)
//    x-actor-email : correo del usuario del panel; se resuelve a users.email
//                    para atribuir la acción y excluirlo de los avisos al
//                    equipo. Si no resuelve, actor nulo (no falla).
//
//  El panel web ya está restringido a administradores por su propia lista de
//  acceso, así que aquí el actor se trata como ADMIN (puede fijar precio,
//  cortesía y reabrir) sin importar el rol que tenga en `users`.
// ─────────────────────────────────────────────────────────────────────────────

const RefundChoiceSchema = z.enum(["STRIPE_REFUND", "CREDIT", "NONE", "ASK_CLIENT"]);

/**
 * `notify: false` = CAPTURA DE HISTORIAL. El panel da de alta reservas viejas
 * (del mes pasado) que ya están finalizadas o canceladas; mandarlas por aquí
 * con los avisos vivos dispara HOY "Tu mascota ya está hospedada", "Molly ya
 * salió", la petición de reseña y el aviso de saldo por una estancia que
 * terminó hace semanas. Con `false` la transición y el dinero se aplican
 * igual, pero no sale ningún push ni correo al cliente ni al equipo. La acción
 * sí queda en el log (`logInternal`).
 */
const StatusSchema = z.object({
  status: ReservationStatusEnum,
  /** Mover todas las filas del grupo multi-mascota. */
  applyToGroup: z.boolean().default(false),
  /** Avisar al cliente. Default true; false para capturar historial. */
  notify: z.boolean().default(true),
});

const CancelSchema = z.object({
  refundChoice: RefundChoiceSchema.default("ASK_CLIENT"),
  /** Cancelar el grupo completo (default) o solo esta fila. */
  includeGroup: z.boolean().default(true),
  /** Avisar al cliente y al equipo. Default true; false para capturar historial. */
  notify: z.boolean().default(true),
});

const DatesSchema = z.object({
  newCheckIn: z.coerce.date(),
  newCheckOut: z.coerce.date(),
  applyToGroup: z.boolean().default(true),
});

const UpdateSchema = z
  .object({
    totalAmount: z.number().nonnegative().optional(),
    internalNotes: z.string().max(2000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    depositAgreed: z.number().nonnegative().nullable().optional(),
    priceChangeReason: z.string().max(200).optional(),
    /** Hora estimada de llegada/recogida ("HH:mm" hora del hotel); null la borra. */
    checkInTime: TimeHHmmSchema.nullable().optional(),
    checkOutTime: TimeHHmmSchema.nullable().optional(),
  })
  .refine(
    (d) =>
      d.totalAmount !== undefined ||
      d.internalNotes !== undefined ||
      d.notes !== undefined ||
      d.depositAgreed !== undefined ||
      d.checkInTime !== undefined ||
      d.checkOutTime !== undefined,
    { message: "Indica al menos un campo a actualizar" }
  );

const AddonSchema = AdminCreateAddonSchema.extend({
  variantId: z.string().optional(),
  serviceCode: z.enum(["BATH", "DEWORMING", "EXTRA_HOURS"]).optional(),
  deslanado: z.boolean().optional(),
  corte: z.boolean().optional(),
}).refine((d) => !!d.variantId || !!d.serviceCode, {
  message: "Indica variantId o serviceCode",
});

const PaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "TRANSFER", "CARD"]),
  cardBrand: z.string().max(40).nullable().optional(),
  cardFeePct: z.number().nonnegative().nullable().optional(),
  cardFeeAmount: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  paidAt: z.coerce.date().nullable().optional(),
  kind: z.enum(["ANTICIPO", "ABONO", "RESTANTE", "FULL"]).nullable().optional(),
});

/**
 * Edición de un cobro MANUAL. Todos los campos opcionales: se manda lo que
 * cambió. `amount` es SIEMPRE el bruto (lo que entregó el cliente); el recargo
 * de tarjeta viaja aparte en `cardFee*`, o se descontaría dos veces.
 */
const UpdatePaymentSchema = z
  .object({
    amount: z.number().positive().optional(),
    method: z.enum(["CASH", "TRANSFER", "CARD"]).optional(),
    paidAt: z.coerce.date().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    reference: z.string().max(120).nullable().optional(),
    cardBrand: z.string().max(40).nullable().optional(),
    cardFeePct: z.number().nonnegative().nullable().optional(),
    cardFeeAmount: z.number().nonnegative().nullable().optional(),
    kind: z.enum(["ANTICIPO", "ABONO", "RESTANTE", "FULL"]).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Indica al menos un campo a actualizar",
  });

/**
 * Edición de un add-on ya agregado. `unitPrice` es el TOTAL del add-on, no el
 * precio por unidad (ver `addonContribution`): en EXTRA_HOURS es horas × tarifa,
 * y `quantity` solo dice de cuántas unidades se compone.
 */
const UpdateAddonSchema = z
  .object({
    variantId: z.string().min(1).optional(),
    unitPrice: z.number().nonnegative().optional(),
    isCourtesy: z.boolean().optional(),
    courtesyReason: z.string().max(200).nullable().optional(),
    internalNote: z.string().max(500).nullable().optional(),
    scheduledAt: z.coerce.date().nullable().optional(),
    durationMinutes: z.number().int().positive().nullable().optional(),
    quantity: z.number().int().positive().nullable().optional(),
    extraPaymentStatus: z
      .enum(["PENDING_PAYMENT", "PAY_ON_PICKUP", "PAID"])
      .nullable()
      .optional(),
    extraPaidAt: z.coerce.date().nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Indica al menos un campo a actualizar",
  });

/**
 * Mismo contrato que `PATCH /reservations/:id/delivery` más `feeOverride`: el
 * panel pacta tarifas a mano (viaje fuera de zona, precio cerrado con el
 * cliente) y ahí la cotización por distancia no manda. La cortesía le gana.
 */
const InternalDeliverySchema = z.discriminatedUnion("enable", [
  z.object({
    enable: z.literal(true),
    address: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    placeId: z.string().optional(),
    trip: DeliveryTripSchema.optional(),
    isCourtesy: z.boolean().optional(),
    feeOverride: z.number().nonnegative().optional(),
  }),
  z.object({ enable: z.literal(false) }),
]);

const ChangePetSchema = z.object({ petId: z.string().min(1) });

const AssignStaffSchema = z.object({ staffId: z.string().min(1) });
const AssignRoomSchema = z.object({ roomId: z.string().min(1) });

const truthy = (v: unknown) => v === true || v === "true" || v === "1";

export default async function internalReservationsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const guard = createInternalGuard(prisma);
  const opts = { preHandler: [guard] };

  const actorOf = (request: { internalActor?: { userId: string | null } }): OpActor => ({
    userId: request.internalActor?.userId ?? null,
    isAdmin: true,
  });

  const sendError = (reply: FastifyReply, res: OpError) =>
    reply.status(res.status).send({
      error: res.error,
      ...(res.code ? { code: res.code } : {}),
      ...(res.extra ?? {}),
    });

  const sendInvalid = (reply: FastifyReply, err: z.ZodError) =>
    reply.status(400).send({
      error: err.issues[0]?.message ?? "Datos inválidos",
      code: "VALIDATION",
      details: err.flatten(),
    });

  // ── POST /internal/reservations — alta por el equipo ────────────────────
  fastify.post("/internal/reservations", opts, async (request, reply) => {
    const parsed = CreateReservationSchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(reply, parsed.error);
    const res = await createTeamReservation(prisma, {
      input: parsed.data,
      actorUserId: request.internalActor?.userId ?? null,
      source: "APP_ADMIN",
    });
    if (!res.ok) return sendError(reply, res);
    logInternal(request, "internal-reservation-create", {
      reservationId: res.data.reservations[0]?.id,
      groupId: res.data.groupId,
      type: parsed.data.reservationType,
      pets: res.data.reservations.length,
    });
    return reply.status(201).send({
      ...teamCreatePayload(res.data.reservations),
      agendaWarnings: res.data.agendaWarnings,
    });
  });

  // ── PATCH /internal/reservations/:id — total, notas, anticipo, horas ────
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id",
    opts,
    async (request, reply) => {
      const parsed = UpdateSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const { checkInTime, checkOutTime, ...basics } = parsed.data;
      const actor = actorOf(request);

      const tocaBasics =
        basics.totalAmount !== undefined ||
        basics.internalNotes !== undefined ||
        basics.notes !== undefined ||
        basics.depositAgreed !== undefined;

      let body: Record<string, unknown> = { success: true };
      if (tocaBasics) {
        const res = await updateReservationBasics(prisma, {
          reservationId: request.params.id,
          input: basics,
          actor,
        });
        if (!res.ok) return sendError(reply, res);
        body = { ...body, ...res.data };
      }

      if (checkInTime !== undefined || checkOutTime !== undefined) {
        const reservation = await prisma.reservation.findUnique({
          where: { id: request.params.id },
        });
        if (!reservation) {
          return reply.status(404).send({ error: "Reservación no encontrada", code: "NOT_FOUND" });
        }
        if (!["STAY", "DAYCARE"].includes(reservation.reservationType)) {
          return reply.status(400).send({
            error: "La hora de llegada/recogida solo aplica a hospedajes y guarderías",
            code: "NOT_A_STAY",
          });
        }
        if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
          return reply
            .status(400)
            .send({ error: "La reserva ya no está activa", code: "NOT_ACTIVE" });
        }
        const updated = await applyReservationTimesUpdate(prisma, {
          reservation,
          checkInTime,
          checkOutTime,
          actorUserId: actor.userId,
          notifyTeam: true,
        });
        body = {
          ...body,
          checkInTime: updated?.checkInTime ?? null,
          checkOutTime: updated?.checkOutTime ?? null,
        };
      }

      logInternal(request, "internal-reservation-update", {
        reservationId: request.params.id,
        fields: Object.keys(parsed.data),
      });
      return reply.send(body);
    }
  );

  // ── PATCH /internal/reservations/:id/assign-staff ───────────────────────
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id/assign-staff",
    opts,
    async (request, reply) => {
      const parsed = AssignStaffSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await assignStaff(prisma, {
        reservationId: request.params.id,
        staffId: parsed.data.staffId,
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-assign-staff", {
        reservationId: request.params.id,
        staffId: parsed.data.staffId,
      });
      return reply.send(res.data);
    }
  );

  // ── PATCH /internal/reservations/:id/assign-room ────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id/assign-room",
    opts,
    async (request, reply) => {
      const parsed = AssignRoomSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await assignRoom(prisma, {
        reservationId: request.params.id,
        roomId: parsed.data.roomId,
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-assign-room", {
        reservationId: request.params.id,
        roomId: parsed.data.roomId,
      });
      return reply.send(res.data);
    }
  );

  // ── POST /internal/reservations/:id/dates/preview ───────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/internal/reservations/:id/dates/preview",
    opts,
    async (request, reply) => {
      const parsed = DatesSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await previewDatesChange(prisma, {
        reservationId: request.params.id,
        newCheckIn: parsed.data.newCheckIn,
        newCheckOut: parsed.data.newCheckOut,
        scope: parsed.data.applyToGroup ? "group" : "single",
      });
      if (!res.ok) return sendError(reply, res);
      return reply.send(res.data.preview);
    }
  );

  // ── POST /internal/reservations/:id/dates ───────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/internal/reservations/:id/dates",
    opts,
    async (request, reply) => {
      const parsed = DatesSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await applyDatesChange(prisma, {
        reservationId: request.params.id,
        newCheckIn: parsed.data.newCheckIn,
        newCheckOut: parsed.data.newCheckOut,
        scope: parsed.data.applyToGroup ? "group" : "single",
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-dates", {
        reservationId: request.params.id,
        newCheckIn: parsed.data.newCheckIn.toISOString(),
        newCheckOut: parsed.data.newCheckOut.toISOString(),
        rows: res.data.perReservation.length,
        delta: res.data.delta,
      });
      return reply.send(res.data);
    }
  );

  // ── POST /internal/reservations/:id/status ──────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/internal/reservations/:id/status",
    opts,
    async (request, reply) => {
      const parsed = StatusSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const actor = request.internalActor;
      const res = await applyStatusTransition(prisma, {
        reservationId: request.params.id,
        to: parsed.data.status,
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.role ?? null,
        isAdmin: true,
        applyToGroup: parsed.data.applyToGroup,
        notify: parsed.data.notify,
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-status", {
        reservationId: request.params.id,
        to: parsed.data.status,
        rows: res.data.reservations.length,
        notify: parsed.data.notify,
      });
      return reply.send({ success: true, ...res.data });
    }
  );

  // ── POST /internal/reservations/:id/cancel ──────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/internal/reservations/:id/cancel",
    opts,
    async (request, reply) => {
      const parsed = CancelSchema.safeParse(request.body ?? {});
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await cancelReservations(prisma, {
        reservationId: request.params.id,
        refundChoice: parsed.data.refundChoice,
        scope: parsed.data.includeGroup ? "group" : "single",
        actor: actorOf(request),
        notify: parsed.data.notify,
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-cancel", {
        reservationId: request.params.id,
        refundChoice: parsed.data.refundChoice,
        rows: res.data.reservationIds.length,
        refundedToCard: res.data.refundedToCard,
        creditedToBalance: res.data.creditedToBalance,
        alreadyRefunded: res.data.rows.filter((r) => r.wasAlreadyRefunded).length,
        notify: parsed.data.notify,
      });
      return reply.send(res.data);
    }
  );

  // ── POST /internal/reservations/:id/addons ──────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/internal/reservations/:id/addons",
    opts,
    async (request, reply) => {
      const parsed = AddonSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await addReservationAddon(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-addon-add", {
        reservationId: request.params.id,
        addonId: res.data.addon.id,
        service: res.data.addon.variant.serviceType.code,
        addedToTotal: res.data.addedToTotal,
      });
      return reply.status(201).send(res.data);
    }
  );

  // ── DELETE /internal/reservations/:id/addons/:addonId ───────────────────
  fastify.delete<{ Params: { id: string; addonId: string } }>(
    "/internal/reservations/:id/addons/:addonId",
    opts,
    async (request, reply) => {
      const res = await removeReservationAddon(prisma, {
        reservationId: request.params.id,
        addonId: request.params.addonId,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-addon-remove", {
        reservationId: request.params.id,
        addonId: request.params.addonId,
        delta: res.data.delta,
      });
      return reply.send(res.data);
    }
  );

  // ── POST /internal/reservations/:id/payments — cobro manual ─────────────
  fastify.post<{ Params: { id: string } }>(
    "/internal/reservations/:id/payments",
    opts,
    async (request, reply) => {
      const parsed = PaymentSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await registerManualPayment(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-payment", {
        reservationId: request.params.id,
        paymentId: res.data.payment.id,
        amount: parsed.data.amount,
        method: parsed.data.method,
        kind: res.data.kind,
      });
      return reply.status(201).send(res.data);
    }
  );

  // ── DELETE /internal/reservations/:id?includeGroup=true ─────────────────
  fastify.delete<{ Params: { id: string }; Querystring: { includeGroup?: string } }>(
    "/internal/reservations/:id",
    opts,
    async (request, reply) => {
      const res = await deleteReservation(prisma, {
        reservationId: request.params.id,
        includeGroup: truthy(request.query?.includeGroup),
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-delete", {
        reservationId: request.params.id,
        deletedIds: res.data.deletedIds,
        deletedPayments: res.data.deletedPayments,
      });
      return reply.send(res.data);
    }
  );

  // ── PATCH /internal/reservations/:id/addons/:addonId ────────────────────
  //  Antes el panel tenía que QUITAR el add-on y volver a agregarlo para
  //  cambiarle la variante o el precio: perdía la hora agendada, la nota
  //  interna y la auditoría de la cortesía, y fallaba con 409 si el add-on ya
  //  tenía un cobro encima.
  fastify.patch<{ Params: { id: string; addonId: string } }>(
    "/internal/reservations/:id/addons/:addonId",
    opts,
    async (request, reply) => {
      const parsed = UpdateAddonSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await updateReservationAddon(prisma, {
        reservationId: request.params.id,
        addonId: request.params.addonId,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-addon-update", {
        reservationId: request.params.id,
        addonId: request.params.addonId,
        fields: Object.keys(parsed.data),
        delta: res.data.delta,
        totalAmount: res.data.totalAmount,
      });
      return reply.send(res.data);
    }
  );

  // ── PATCH /internal/reservations/:id/delivery ───────────────────────────
  //  El panel escribía las columnas homeDelivery* directo en Supabase: sin
  //  recotizar, sin mover el totalAmount, sin la regla de "un solo domicilio
  //  por grupo" y sin avisarle a nadie.
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id/delivery",
    opts,
    async (request, reply) => {
      const parsed = InternalDeliverySchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await applyDeliveryUpdate(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        // El panel ya está restringido a administradores por su lista de
        // acceso: aquí el actor siempre es equipo (puede regalar el viaje,
        // pactar tarifa y tocarlo con la estancia en curso).
        isStaffOrAdmin: true,
        actorUserId: request.internalActor?.userId ?? null,
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-delivery", {
        reservationId: request.params.id,
        enable: parsed.data.enable,
        fee: res.data.fee,
        isCourtesy: res.data.isCourtesy,
        delta: res.data.delta,
        newTotal: res.data.newTotal,
      });
      return reply.send(res.data);
    }
  );

  // ── PATCH /internal/reservations/:id/daycare-schedule ───────────────────
  //  Mover el día/horas de una guardería. El panel escribía `appointmentAt`
  //  a pelo: no revalidaba el cupo, no recalculaba el precio por la diferencia
  //  de horas, no arrastraba al grupo y dejaba vivo el recordatorio de 24 h
  //  con el día viejo.
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id/daycare-schedule",
    opts,
    async (request, reply) => {
      const parsed = UpdateDaycareScheduleSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await applyDaycareScheduleUpdate(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        actorUserId: request.internalActor?.userId ?? null,
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-daycare-schedule", {
        reservationId: request.params.id,
        date: parsed.data.date ?? null,
        checkInTime: parsed.data.checkInTime,
        checkOutTime: parsed.data.checkOutTime,
        hours: res.data.hours,
        delta: res.data.delta,
        newTotal: res.data.newTotal,
      });
      return reply.send(res.data);
    }
  );

  // ── PATCH /internal/reservations/:id/pet ────────────────────────────────
  //  Corregir el perro de una reserva capturada con la mascota equivocada.
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id/pet",
    opts,
    async (request, reply) => {
      const parsed = ChangePetSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await changeReservationPet(prisma, {
        reservationId: request.params.id,
        petId: parsed.data.petId,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-reservation-pet", {
        reservationId: request.params.id,
        petId: res.data.petId,
        previousPetId: res.data.previousPetId,
        changed: res.data.changed,
      });
      return reply.send(res.data);
    }
  );

  // ── PATCH /internal/payments/:id — corregir un cobro manual ─────────────
  //  Mismos candados que el DELETE: lo que cobró Stripe, la terminal o una
  //  venta de tienda no se edita a mano (su monto refleja dinero que ya se
  //  movió en otro sistema), y un renglón REFUNDED tampoco.
  fastify.patch<{ Params: { id: string } }>(
    "/internal/payments/:id",
    opts,
    async (request, reply) => {
      const parsed = UpdatePaymentSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalid(reply, parsed.error);
      const res = await updatePayment(prisma, {
        paymentId: request.params.id,
        input: parsed.data,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-payment-update", {
        paymentId: request.params.id,
        reservationId: res.data.payment.reservationId,
        fields: Object.keys(parsed.data),
        amount: Number(res.data.payment.amount),
        method: res.data.payment.method,
        balance: res.data.balance,
      });
      return reply.send(res.data);
    }
  );

  // ── DELETE /internal/payments/:id ───────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    "/internal/payments/:id",
    opts,
    async (request, reply) => {
      const res = await deletePayment(prisma, {
        paymentId: request.params.id,
        actor: actorOf(request),
      });
      if (!res.ok) return sendError(reply, res);
      logInternal(request, "internal-payment-delete", {
        paymentId: request.params.id,
        reservationId: res.data.reservationId,
        creditReturned: res.data.creditReturned,
      });
      return reply.send(res.data);
    }
  );
}
