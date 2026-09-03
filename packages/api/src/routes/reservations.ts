import { FastifyInstance } from "fastify";
import {
  CreateReservationSchema,
  CreateMultiReservationSchema,
  UpdateReservationStatusSchema,
  UpdateReservationTimesSchema,
  UpdateReservationDeliverySchema,
  ReservationStatus,
  CancelReservationSchema,
  hoursUntilHotelDay,
} from "@holidoginn/shared";
import { Prisma, PetSize, ReservationStatus as PrismaResStatus } from "@holidoginn/db";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { notifyBathContracted } from "./services";
import { createAuthMiddleware } from "../middleware/auth";
import {
  canAccessReservation,
  isCoOwner,
  linkedPetIds,
  sharedPetIds,
} from "../lib/petAccess";
import { resolveDiscount } from "../lib/discounts";
import {
  reservationConfirmedTemplate,
  sendEmail,
} from "../lib/email";
import { notifyUser, notifyUsers, notifyTeamReservationUpdated } from "../lib/notify";
import { notifyNewReservation } from "../lib/notifyNewReservation";
import { applyReservationTimesUpdate } from "../lib/stayTimes";
import { processRefund } from "../lib/refund";
import { notifyExpiringVaccines } from "../lib/auto-actions";
import { triggerMaintenance } from "../lib/maintenance";
import {
  stripInternalFields,
  stripInternalFieldsList,
  stripChecklistInternalFieldsList,
} from "../lib/stripInternal";
import { LEGAL_DOC_VERSIONS, REQUIRED_FOR_BOOKING } from "../lib/legal";
import {
  getLodgingPricing,
  sizeFromWeight,
  computeDays,
  computeStayPricing,
  allocateProportional,
  roundMoney,
  type StayPricing,
} from "../lib/pricing";
import { quoteDelivery } from "../lib/delivery";
import { applyDeliveryUpdate } from "../lib/deliveryUpdate";
import { lockRoomsAndVerifyCapacity, RoomTakenError } from "../lib/reservationCreate";
import { createTeamReservation, teamCreatePayload } from "../lib/reservationTeamCreate";
import { statusTransitionVerdict } from "../lib/reservationStatus";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// Igualdad de conjuntos de ids (sin importar orden ni repetidos).
function sameStringSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

// `bathBreakdown` del metadata del PI: JSON [{petId, variantId, price}].
// Devuelve petId → variantId (vacío si el intent no traía baños; null si el
// intent es tan viejo que no trae la llave, para no exigir nada).
function parseBathBreakdown(raw: unknown): Map<string, string> | null {
  if (typeof raw !== "string") return null;
  if (raw.trim() === "") return new Map();
  try {
    const arr = JSON.parse(raw) as Array<{ petId?: string; variantId?: string }>;
    const map = new Map<string, string>();
    for (const b of arr) {
      if (b?.petId && b?.variantId) map.set(String(b.petId), String(b.variantId));
    }
    return map;
  } catch {
    return null;
  }
}

export default async function reservationsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // GET /reservations — listar (acepta query ?ownerId= y ?status=)
  // OWNER siempre queda filtrado a sus propias reservas; STAFF/ADMIN pueden filtrar libremente.
  fastify.get<{
    Querystring: { ownerId?: string; status?: ReservationStatus };
  }>("/reservations", { preHandler: [authMiddleware] }, async (request) => {
    // Mantenimiento (auto-checkout, anticipos vencidos, recordatorios) en
    // segundo plano y con throttle — ya no bloquea esta lectura.
    triggerMaintenance(prisma);
    const { ownerId: queryOwnerId, status } = request.query;
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    const effectiveOwnerId = isStaffOrAdmin ? queryOwnerId : request.userId;

    // El cliente ve las reservas que él hizo MÁS las de las mascotas
    // vinculadas, en las dos direcciones: las que le comparten y las suyas que
    // tienen co-dueño (la reserva se guarda a nombre de quien la hizo, así que
    // filtrar solo por `ownerId` le escondería al dueño lo que reservó el
    // otro). Mismo patrón de dos caminos que GET /pets: sin ningún vínculo la
    // consulta es la de siempre y usa (ownerId, status).
    const sharedPets = isStaffOrAdmin
      ? []
      : await linkedPetIds(prisma, request.userId!);

    const reservations = await prisma.reservation.findMany({
      where: {
        ...(sharedPets.length > 0
          ? {
              OR: [
                { ownerId: request.userId! },
                { petId: { in: sharedPets } },
              ],
            }
          : effectiveOwnerId
            ? { ownerId: effectiveOwnerId }
            : {}),
        ...(status ? { status } : {}),
      },
      include: {
        pet: { select: { id: true, name: true, breed: true, photoUrl: true } },
        room: { select: { id: true, name: true } },
        staff: { select: { id: true, firstName: true, lastName: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        payments: {
          where: { status: { in: ["PAID", "PARTIAL"] } },
          select: { amount: true },
        },
        changeRequests: {
          where: { status: "PENDING" },
          select: { id: true },
          take: 1,
        },
        updates: {
          select: { createdAt: true },
          orderBy: { createdAt: "desc" as const },
          take: 1,
        },
        review: {
          select: { id: true, rating: true },
        },
        // Para tarjetas de baño: indicadores deslanado/corte y si el servicio ya
        // se ejecutó (`completedAt`), que es lo que distingue "baño listo, falta
        // cobrar" de "pendiente". El precio y demás detalles viven en el detail.
        addons: {
          select: {
            completedAt: true,
            variant: {
              select: {
                deslanado: true,
                corte: true,
                serviceType: { select: { code: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    // Defensa: omite reservaciones con relaciones rotas (datos legacy con FK
    // huérfana) para no romper a los clientes que asumen pet/owner presentes.
    const rows = reservations
      .filter((r) => r.pet && r.owner)
      .map(({ payments, changeRequests, updates, review, addons, ...r }) => {
      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(r.totalAmount) - totalPaid;
      const hasDeslanado = addons.some((a) => a.variant?.deslanado === true);
      const hasCorte = addons.some((a) => a.variant?.corte === true);
      return {
        ...r,
        hasBalance: remaining > 0.01,
        hasPendingChangeRequest: (changeRequests?.length ?? 0) > 0,
        lastUpdateAt: updates?.[0]?.createdAt ?? null,
        hasReview: !!review,
        reviewRating: review?.rating ?? null,
        hasDeslanado,
        hasCorte,
        // Slim: la UI deriva de aquí el estado "baño listo · por cobrar".
        addons,
      };
    });
    // El `...r` de arriba arrastra TODA la fila, incluida la nota interna del
    // equipo: hay que quitarla antes de que salga hacia un dueño.
    return stripInternalFieldsList(rows, isStaffOrAdmin);
  });

  // GET /reservations/:id — obtener con relaciones completas (owner o staff/admin)
  fastify.get<{ Params: { id: string } }>(
    "/reservations/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: true,
          room: true,
          payments: {
            orderBy: { createdAt: "desc" },
            // El depósito real de Stripe (si ya se concilió): con él el admin
            // ve cuándo cayó (o cae) al banco el dinero de cada pago.
            include: {
              payoutLines: {
                select: {
                  payout: { select: { arrivalDate: true, status: true } },
                },
              },
            },
          },
          updates: {
            orderBy: { createdAt: "desc" },
            include: {
              staff: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          staff: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          review: true,
          addons: {
            include: {
              variant: { include: { serviceType: true } },
              // Quién ejecutó el servicio ("Bañó: X"). Antes solo se sabía por
              // el StayUpdate de la foto, que ahora es opcional.
              completedBy: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!(await canAccessReservation(prisma, reservation, request))) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      // El `include` (no `select`) devuelve la fila completa: sin este filtro la
      // nota interna del equipo y el motivo de las cortesías viajan al dueño.
      return stripInternalFields(reservation, isStaffOrAdmin);
    }
  );

  // ────────────────────────────────────────────────────────────
  //  PATCH /reservations/:id/delivery — agregar/cambiar/quitar el
  //  servicio a domicilio de una reserva YA creada.
  //
  //  Hasta ahora solo se podía capturar al crear: si el cliente lo
  //  pedía después, no había dónde registrarlo. Lo puede hacer el
  //  dueño (antes del check-in) o el equipo.
  //
  //  La tarifa SIEMPRE se recotiza server-side; el delta se aplica al
  //  totalAmount y se cobra al recoger (no se cobra en línea aquí).
  //  Nota: el admin web YA NO escribe estas columnas en Supabase; pasa
  //  por PATCH /internal/reservations/:id/delivery, que comparte esta
  //  misma lógica (lib/deliveryUpdate.ts) y solo agrega `feeOverride`
  //  para las tarifas pactadas a mano.
  // ────────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    "/reservations/:id/delivery",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = UpdateReservationDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";

      const res = await applyDeliveryUpdate(prisma, {
        reservationId: request.params.id,
        input: parsed.data,
        isStaffOrAdmin,
        actorUserId: request.userId ?? null,
        authorize: (reservation) => canAccessReservation(prisma, reservation, request),
      });
      if (!res.ok) {
        return reply
          .status(res.status)
          .send({ error: res.error, ...(res.code ? { code: res.code } : {}) });
      }
      const { delta, newTotal, overpaid } = res.data;
      return reply.send({ success: true, delta, newTotal, overpaid });
    }
  );

  // POST /reservations — alta MANUAL del equipo (mostrador/teléfono). La
  // lógica vive en lib/reservationTeamCreate.ts y la comparten esta ruta y
  // POST /internal/reservations (admin web): una sola fórmula de precio,
  // un solo lock de cuartos y los mismos avisos, sin dos copias que diverjan.
  fastify.post("/reservations", { preHandler: [authMiddleware] }, async (request, reply) => {
    // Nace CONFIRMED sin pago, sin cartilla aprobada, sin gate legal y acepta
    // staffId, internalNotes y anticipo acordado. Un dueño con sesión podía
    // llamarlo y saltarse todo eso. El cliente reserva por sus rutas con pago
    // (/reservations/multi, /baths/confirm, /daycare/confirm); la app del
    // cliente nunca usa este endpoint.
    if (request.userRole !== "ADMIN" && request.userRole !== "STAFF") {
      return reply.status(403).send({
        error: "Reserva desde el flujo de pago",
        code: "TEAM_ONLY",
      });
    }

    const parsed = CreateReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const res = await createTeamReservation(prisma, {
      input: parsed.data,
      actorUserId: request.userId ?? null,
      source: "APP_ADMIN",
    });
    if (!res.ok) {
      return reply.status(res.status).send({
        error: res.error,
        ...(res.code ? { code: res.code } : {}),
        ...(res.extra ?? {}),
      });
    }
    return reply.status(201).send({
      ...teamCreatePayload(res.data.reservations),
      agendaWarnings: res.data.agendaWarnings,
    });
  });

  // PATCH /reservations/:id/times — hora estimada de llegada/recogida.
  // La indica el dueño (o staff/admin). Se propaga a TODO el grupo
  // multi-mascota: las mascotas del mismo dueño llegan y se recogen juntas.
  fastify.patch<{ Params: { id: string } }>(
    "/reservations/:id/times",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = UpdateReservationTimesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!(await canAccessReservation(prisma, reservation, request))) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      if (!["STAY", "DAYCARE"].includes(reservation.reservationType)) {
        return reply
          .status(400)
          .send({ error: "Solo aplica a hospedajes y guarderías" });
      }

      // En guardería las horas SON el precio (horas × tarifa): si el dueño
      // pudiera extender la salida estimada gratis, evitaría el cobro de horas
      // extra al recoger. Solo staff/admin ajustan horas de guardería (y
      // regularizan el cobro con el add-on de horas extra si hace falta).
      if (reservation.reservationType === "DAYCARE") {
        if (!isStaffOrAdmin) {
          return reply.status(403).send({
            error: "Contáctanos para cambiar las horas de tu guardería",
          });
        }
        if (parsed.data.checkInTime === null || parsed.data.checkOutTime === null) {
          return reply.status(400).send({
            error: "Las horas de la guardería no se pueden borrar",
          });
        }
      }

      const { checkInTime, checkOutTime } = parsed.data;

      // Los dos límites de abajo son reglas del flujo del CLIENTE: para él, la
      // hora de llegada deja de tener sentido una vez que el perro ya entró.
      // El EQUIPO no vive con esa regla — el cliente avisa por WhatsApp que
      // pasa por su perro más tarde y eso ocurre con la estancia en curso, que
      // es justo cuando el guard de CONFIRMED lo bloqueaba.
      if (!isStaffOrAdmin) {
        if (checkInTime !== undefined && reservation.status !== "CONFIRMED") {
          return reply
            .status(400)
            .send({ error: "La hora de llegada ya no se puede cambiar" });
        }
        if (
          checkOutTime !== undefined &&
          !["CONFIRMED", "CHECKED_IN"].includes(reservation.status)
        ) {
          return reply
            .status(400)
            .send({ error: "La hora de recogida ya no se puede cambiar" });
        }
      } else if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
        // Una reserva cancelada o ya cerrada no tiene horario que planear.
        return reply
          .status(400)
          .send({ error: "La reserva ya no está activa" });
      }

      return applyReservationTimesUpdate(prisma, {
        reservation,
        checkInTime,
        checkOutTime,
        actorUserId: request.userId ?? null,
        notifyTeam: isStaffOrAdmin,
      });
    }
  );

  // PATCH /internal/reservations/:id/times — la misma edición, para el admin
  // web. Su Clerk es OTRA instancia y la API no puede validar sus tokens; el
  // CRON_SECRET compartido es el único puente, igual que en el reagendado de
  // baños. Sin secreto configurado la ruta no existe en la práctica (401).
  fastify.patch<{ Params: { id: string } }>(
    "/internal/reservations/:id/times",
    async (request, reply) => {
      const secret = process.env.CRON_SECRET;
      if (!secret || request.headers["x-cron-secret"] !== secret) {
        return reply.status(401).send({ error: "No autorizado" });
      }

      const parsed = UpdateReservationTimesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (!["STAY", "DAYCARE"].includes(reservation.reservationType)) {
        return reply
          .status(400)
          .send({ error: "Solo aplica a hospedajes y guarderías" });
      }
      if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
        return reply.status(400).send({ error: "La reserva ya no está activa" });
      }

      return applyReservationTimesUpdate(prisma, {
        reservation,
        checkInTime: parsed.data.checkInTime,
        checkOutTime: parsed.data.checkOutTime,
        // El admin web no manda un usuario identificable, así que el aviso va
        // a todo el equipo sin exclusiones.
        actorUserId: null,
        notifyTeam: true,
      });
    }
  );

  // PATCH /reservations/:id/status — cambiar status
  fastify.patch<{ Params: { id: string } }>(
    "/reservations/:id/status",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      // Solo el equipo mueve estados (check-in/out, reabrir). El endpoint no
      // validaba rol NI dueño: cualquier usuario autenticado podía cambiarle
      // el estado a cualquier reserva. El dueño cancela por su propia ruta
      // (/reservations/:id/cancel), nunca por aquí.
      if (request.userRole !== "ADMIN" && request.userRole !== "STAFF") {
        return reply
          .status(403)
          .send({ error: "Solo el equipo puede cambiar el estado" });
      }

      const parsed = UpdateReservationStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }

      const from = reservation.status;
      const to = parsed.data.status;
      // Repetir el estado actual (doble tap, reintento) no es un error.
      if (from === to) {
        return prisma.reservation.findUniqueOrThrow({
          where: { id: reservation.id },
          include: { pet: true, room: true },
        });
      }

      const verdict = statusTransitionVerdict(
        from,
        to,
        reservation.reservationType,
        request.userRole === "ADMIN",
      );
      if (verdict) {
        return reply.status(409).send({ error: verdict, code: "INVALID_TRANSITION" });
      }

      // Cancelar con dinero de por medio tiene su propia ruta, que decide el
      // reembolso (tarjeta o saldo a favor). Por aquí solo se cancelan
      // reservas sin cobro, para no dejar pagos huérfanos.
      if (to === "CANCELLED") {
        const paidCount = await prisma.payment.count({
          where: {
            reservationId: reservation.id,
            status: { in: ["PAID", "PARTIAL"] },
          },
        });
        if (paidCount > 0) {
          return reply.status(409).send({
            error:
              "La reserva tiene pagos registrados. Usa la cancelación con reembolso (/admin/reservations/:id/cancel).",
            code: "HAS_PAYMENTS",
          });
        }
      }

      const updated = await prisma.reservation.update({
        where: { id: request.params.id },
        data: { status: to },
        include: { pet: true, room: true },
      });
      return updated;
    }
  );


  // ── Helper: cuenta cuántas reservas activas (no CANCELLED/CHECKED_OUT) solapan
  // con la ventana [checkIn, checkOut) en un cuarto. Opcionalmente excluye un id
  // (para edición de la misma reserva).
  async function countOverlappingForRoom(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: string,
  ): Promise<number> {
    return prisma.reservation.count({
      where: {
        roomId,
        reservationType: "STAY",
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] as PrismaResStatus[] },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        AND: [
          { checkIn: { lt: checkOut } },
          { checkOut: { gt: checkIn } },
        ],
      },
    });
  }

  // ── Helper: find available room for a pet size + dates (capacity-aware) ──
  // Toma en cuenta `capacity`: un cuarto se considera disponible mientras la
  // cantidad de reservaciones activas solapadas sea menor a su capacidad.
  // `addingCount` es cuántos perros nuevos se quieren meter (default 1).
  async function findAvailableRoom(
    petSize: PetSize,
    checkIn: Date,
    checkOut: Date,
    addingCount: number = 1,
  ) {
    const rooms = await prisma.room.findMany({
      where: {
        isActive: true,
        sizeAllowed: { has: petSize },
      },
      orderBy: { createdAt: "asc" },
    });
    for (const room of rooms) {
      const taken = await countOverlappingForRoom(room.id, checkIn, checkOut);
      if (taken + addingCount <= room.capacity) return room;
    }
    return null;
  }

  // POST /reservations/discounts/validate — feedback en vivo del código de
  // descuento al reservar (hotel o baño). create-intent es la autoridad final;
  // esto solo da retroalimentación inmediata. Alcance RESERVATIONS/BOTH.
  fastify.post<{ Body: { code?: string; subtotal?: number } }>(
    "/reservations/discounts/validate",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const code = (request.body?.code ?? "").trim();
      const subtotal = Number(request.body?.subtotal);
      if (!code) return reply.status(400).send({ error: "Código requerido" });
      if (!Number.isFinite(subtotal) || subtotal <= 0) {
        return reply.status(400).send({ error: "Subtotal inválido" });
      }
      const discount = await resolveDiscount(prisma, {
        code,
        subtotal,      });
      if (discount.error) {
        return reply.send({ valid: false, discountTotal: 0, message: discount.error });
      }
      return reply.send({
        valid: true,
        discountTotal: discount.discountTotal,
        message: "Cupón aplicado",
      });
    }
  );

  // POST /reservations/multi — crear reservaciones para múltiples mascotas
  fastify.post("/reservations/multi", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = CreateMultiReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { checkIn, checkOut, checkInTime, checkOutTime, ownerId, petIds, notes, legalAccepted, roomPreference, stripePaymentIntentId, paymentType, bathSelectionsByPet, medicationByPet, homeDelivery, discountCode } = parsed.data;

    // OWNER solo puede reservar para sí mismo.
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    if (!isStaffOrAdmin && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes reservar para tu propia cuenta" });
    }

    if (checkOut <= checkIn) {
      return reply.status(400).send({ error: "checkOut debe ser posterior a checkIn" });
    }
    if (!legalAccepted) {
      return reply.status(400).send({ error: "Debes aceptar los términos legales para reservar" });
    }

    // Gate: verificar que el usuario haya aceptado la versión vigente de los
    // documentos requeridos (TOS, PRIVACY, VET_AUTH). 412 = Precondition Failed.
    const acceptances = await prisma.legalAcceptance.findMany({
      where: { userId: ownerId },
      select: { documentType: true, version: true },
    });
    const acceptedSet = new Set(
      acceptances.map((a) => `${a.documentType}@${a.version}`)
    );
    const missingLegal = REQUIRED_FOR_BOOKING.filter(
      (type) => !acceptedSet.has(`${type}@${LEGAL_DOC_VERSIONS[type]}`)
    );
    if (missingLegal.length > 0) {
      return reply.status(412).send({
        error: "Faltan consentimientos legales vigentes",
        code: "LEGAL_ACCEPTANCE_REQUIRED",
        missing: missingLegal,
        versions: LEGAL_DOC_VERSIONS,
      });
    }

    // Verify Stripe payment succeeded (allow credit-only bypass when no intent was created)
    let paymentIntent: Stripe.PaymentIntent | null = null;
    let creditApplied = 0;
    // Descuento: en el flujo Stripe se lee del metadata del PI (autoritativo,
    // fijado en create-intent); en credit-only se re-valida más abajo.
    let discountTotal = 0;
    let discountCodeId: string | null = null;
    // Con PI: el recargo de mismo día y los baños se toman del intent (lo que
    // el cliente vio y pagó), no se recalculan con el reloj de ahora.
    let piSameDaySurcharge: boolean | null = null;
    let piBathVariantByPet: Map<string, string> | null = null;
    if (stripePaymentIntentId) {
      // IDEMPOTENCIA: si este PaymentIntent ya generó reservación(es) (p. ej. el
      // cliente reintentó tras 3DS o recargó la página de confirmación), devolver
      // las existentes en lugar de crear duplicados.
      const existingPayment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId },
        include: { reservation: true },
      });
      if (existingPayment?.reservation) {
        const groupId = existingPayment.reservation.groupId;
        const reservations = groupId
          ? await prisma.reservation.findMany({ where: { groupId } })
          : [existingPayment.reservation];
        const grandTotal = reservations.reduce((s, r) => s + Number(r.totalAmount), 0);
        return reply.status(200).send({
          reservations,
          grandTotal,
          discountTotal: reservations.reduce((s, r) => s + Number(r.discountTotal ?? 0), 0),
          groupId: groupId ?? null,
          creditApplied: 0,
          idempotent: true,
        });
      }

      paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
      if (paymentIntent.status !== "succeeded") {
        return reply.status(400).send({ error: "El pago no fue completado" });
      }
      // ANTI-REPLAY / ANTI-TAMPER: el PI es la autoridad de lo que se cobró.
      // Debe ser un intent de hospedaje (create-intent marca `type: "stay"`;
      // los intents viejos no traen `type` pero sí `ownerId` y `petIds`), del
      // mismo dueño, y lo que fija el precio (mascotas, fechas, tipo de pago,
      // cuarto, baños, medicamento) tiene que ser lo mismo que se cotizó al
      // crear el intent. Sin esto, con un PI de 1 noche se confirmaban 10.
      const md = paymentIntent.metadata ?? {};
      if (md.type && md.type !== "stay") {
        return reply.status(400).send({ error: "El pago no es de un hospedaje" });
      }
      if (!md.ownerId || md.ownerId !== ownerId) {
        return reply.status(403).send({ error: "El pago no corresponde a esta cuenta" });
      }
      const mismatch = (what: string) => {
        request.log.warn(
          { tag: "multi-pi-mismatch", paymentIntentId: stripePaymentIntentId, ownerId, what },
          "[pago] el body de /multi no coincide con el PaymentIntent",
        );
        return reply.status(400).send({
          error: "Los datos de la reservación no coinciden con el pago realizado. Vuelve a cotizar.",
          code: "PAYMENT_MISMATCH",
        });
      };
      const mdPetIds = String(md.petIds ?? "").split(",").filter(Boolean);
      if (!sameStringSet(mdPetIds, petIds)) return mismatch("petIds");
      if (md.checkIn && new Date(md.checkIn).getTime() !== checkIn.getTime()) {
        return mismatch("checkIn");
      }
      if (md.checkOut && new Date(md.checkOut).getTime() !== checkOut.getTime()) {
        return mismatch("checkOut");
      }
      if (md.paymentType && md.paymentType !== paymentType) return mismatch("paymentType");
      if (md.roomPreference && md.roomPreference !== roomPreference) {
        return mismatch("roomPreference");
      }
      if (typeof md.medicationPetIds === "string") {
        const bodyMedPets = Object.entries(medicationByPet ?? {})
          .filter(([, sel]) => (sel?.notes?.trim() ?? "").length > 0)
          .map(([petId]) => petId);
        if (!sameStringSet(md.medicationPetIds.split(",").filter(Boolean), bodyMedPets)) {
          return mismatch("medication");
        }
      }
      creditApplied = Number(md.creditApplied ?? 0);
      discountTotal = Number(md.discountTotal ?? 0);
      discountCodeId = md.discountCodeId || null;
      piSameDaySurcharge = md.sameDaySurcharge === "1";
      piBathVariantByPet = parseBathBreakdown(md.bathBreakdown);
    }
    // creditOnly = true when the deposit/total was fully covered by the
    // owner's saldo a favor and no Stripe charge was created. We compute the
    // exact credit to apply later (after we know grandTotal).
    const creditOnly = !stripePaymentIntentId;

    // Verify owner
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) return reply.status(404).send({ error: "Dueño no encontrado" });

    // Defense in depth: corre el chequeo de vacunas vencidas antes del guard.
    // Esto asegura que si una vacuna venció y el admin no ha abierto el dashboard,
    // igual se demote la cartilla a EXPIRED y se bloquee la reservación aquí.
    await notifyExpiringVaccines(prisma);

    // Verify all pets belong to owner (re-fetch para tener el cartillaStatus
    // fresco). Cuentan también las compartidas: quien reserva puede ser el
    // co-dueño de la mascota.
    const sharedForBooker = await sharedPetIds(prisma, ownerId);
    const pets = await prisma.pet.findMany({
      where: {
        id: { in: petIds },
        ...(sharedForBooker.length > 0
          ? { OR: [{ ownerId }, { id: { in: sharedForBooker } }] }
          : { ownerId }),
      },
    });
    if (pets.length !== petIds.length) {
      return reply.status(400).send({ error: "Una o más mascotas no pertenecen al dueño" });
    }

    // Cartilla guard: block pets without APPROVED cartilla
    const blocked = pets.filter((p) => p.cartillaStatus !== "APPROVED");
    if (blocked.length > 0) {
      const names = blocked.map((p) => p.name).join(", ");
      const someExpired = blocked.some((p) => p.cartillaStatus === "EXPIRED");
      return reply.status(400).send({
        error: someExpired
          ? `Cartilla vencida: ${names}. Renueva la cartilla y espera el visto bueno del equipo HDI antes de reservar.`
          : `Cartilla pendiente de aprobación: ${names}. Sube la cartilla y espera el visto bueno del equipo HDI.`,
        blockedPetIds: blocked.map((p) => p.id),
      });
    }

    // Overlap guard: una misma mascota no puede tener dos reservas activas con
    // fechas solapadas. Defensa en profundidad — el frontend ya valida pero no
    // es confiable ante race conditions / clientes desactualizados.
    const overlapping = await prisma.reservation.findMany({
      where: {
        petId: { in: petIds },
        status: { not: "CANCELLED" },
        AND: [
          { checkIn: { lt: checkOut } },
          { checkOut: { gt: checkIn } },
        ],
      },
      include: { pet: { select: { id: true, name: true } } },
    });
    if (overlapping.length > 0) {
      const names = Array.from(
        new Set(overlapping.map((r) => r.pet.name))
      ).join(", ");
      return reply.status(409).send({
        error: `Ya existe una reserva activa para: ${names} en esas fechas.`,
        code: "RESERVATION_OVERLAP",
        conflicts: overlapping.map((r) => ({
          reservationId: r.id,
          petId: r.petId,
          petName: r.pet.name,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          status: r.status,
        })),
      });
    }

    // Noches en días-calendario UTC (computeDays): la misma cuenta que hizo
    // create-intent al fijar el PI. Las estancias van ancladas a 00:00 UTC.
    const totalDays = computeDays(checkIn, checkOut);
    if (totalDays < 1) {
      return reply.status(400).send({ error: "La estancia debe ser de al menos una noche" });
    }
    const groupId = petIds.length > 1 ? randomUUID() : null;
    const pricingConfig = await getLodgingPricing(prisma);

    // Talla y hospedaje por mascota — UNA fórmula (computeStayPricing), la
    // MISMA con la que /payments/create-intent fijó el monto del PI.
    const petSizes = pets.map((p) => {
      const stay = computeStayPricing({
        petWeightKg: p.weight,
        totalDays,
        hasMedication: false,
        sameDay: false,
        config: pricingConfig,
      });
      return {
        pet: p,
        size: sizeFromWeight(p.weight ?? 0),
        pricePerDay: stay.pricePerDay,
        lodging: stay.lodging,
      };
    });

    // Find rooms
    type Assignment = { petId: string; roomId: string | null; amount: number };
    // La búsqueda corre SIN lock (el lock por cuarto se toma dentro de la
    // transacción). Va en una función para poder rehacerla si otro request
    // gana el lugar entre la búsqueda y la escritura (RoomTakenError).
    const assignRooms = async (): Promise<
      { assignments: Assignment[]; error?: undefined } | { assignments?: undefined; error: string }
    > => {
      const assignments: Assignment[] = [];
      if (roomPreference === "shared") {
        // Find room for the largest pet size that fits TODAS las mascotas del grupo.
        const sizeOrder: PetSize[] = ["XS", "S", "M", "L", "XL"];
        const largestSize = petSizes.reduce((max, ps) =>
          sizeOrder.indexOf(ps.size) > sizeOrder.indexOf(max) ? ps.size : max,
          petSizes[0].size
        );
        const room = await findAvailableRoom(
          largestSize,
          checkIn,
          checkOut,
          petSizes.length,
        );
        if (!room) {
          return {
            error: `No hay cuartos con capacidad para ${petSizes.length} perros (tamaño ${largestSize}) en las fechas seleccionadas`,
          };
        }
        for (const ps of petSizes) {
          assignments.push({
            petId: ps.pet.id,
            roomId: room.id,
            amount: ps.lodging,
          });
        }
      } else {
        // Separate: find a room per pet — y reservar lugares ya asignados en este
        // mismo request para no asignar dos perros al mismo cuarto rebasando su
        // capacidad dentro de la misma operación.
        const localUsage = new Map<string, number>();
        for (const ps of petSizes) {
          const rooms = await prisma.room.findMany({
            where: { isActive: true, sizeAllowed: { has: ps.size } },
            orderBy: { createdAt: "asc" },
          });
          let chosen: typeof rooms[number] | null = null;
          for (const room of rooms) {
            const taken = await countOverlappingForRoom(room.id, checkIn, checkOut);
            const localTaken = localUsage.get(room.id) ?? 0;
            if (taken + localTaken + 1 <= room.capacity) {
              chosen = room;
              localUsage.set(room.id, localTaken + 1);
              break;
            }
          }
          if (!chosen) {
            return {
              error: `No hay cuartos disponibles para ${ps.pet.name} (tamaño ${ps.size}) en las fechas seleccionadas`,
            };
          }
          assignments.push({
            petId: ps.pet.id,
            roomId: chosen.id,
            amount: ps.lodging,
          });
        }
      }
      return { assignments };
    };

    // Sin cuarto y con el PaymentIntent YA cobrado: antes se respondía 4xx y
    // el dinero quedaba en Stripe sin reserva, sin fila en `payments`, sin
    // reembolso y sin aviso (solo un log). Ahora se devuelve el cobro de
    // inmediato (idempotente por PI) y se avisa a los admins; si el reembolso
    // falla, el aviso lo dice para que se haga a mano en Stripe.
    const failWithoutRoom = async (message: string) => {
      if (!paymentIntent) {
        return reply.status(409).send({ error: message, code: "ROOM_TAKEN" });
      }
      const piId = paymentIntent.id;
      let refunded = false;
      try {
        await stripe.refunds.create(
          { payment_intent: piId },
          { idempotencyKey: `refund-orphan-${piId}` },
        );
        refunded = true;
      } catch (e) {
        request.log.error(
          { tag: "multi-orphan-refund-failed", ownerId, paymentIntentId: piId, err: String(e) },
          "[reservas] no se pudo reembolsar el cobro sin reserva",
        );
      }
      request.log.warn(
        { tag: "multi-orphan-charge", ownerId, paymentIntentId: piId, refunded },
        "[reservas] cobro sin reserva por falta de cuarto",
      );
      try {
        const admins = await prisma.user.findMany({
          where: { role: "ADMIN" },
          select: { id: true },
        });
        const amount = (paymentIntent.amount_received ?? paymentIntent.amount) / 100;
        await notifyUsers(prisma, admins.map((a) => a.id), {
          type: "STAFF_ALERT",
          title: refunded ? "Cobro devuelto: se acabó el cupo" : "Cobro sin reserva: revisar en Stripe",
          body: refunded
            ? `Un cliente pagó $${amount.toFixed(2)} por la app pero el cuarto se ocupó antes de crear la reserva. El pago ya se reembolsó (${piId}).`
            : `Un cliente pagó $${amount.toFixed(2)} por la app, el cuarto se ocupó antes de crear la reserva y el reembolso automático falló. Devuélvelo en Stripe: ${piId}.`,
          data: { paymentIntentId: piId, refunded },
          priority: "high",
        });
      } catch (e) {
        request.log.error({ err: String(e) }, "[reservas] no se pudo avisar a los admins del cobro sin reserva");
      }
      return reply.status(409).send({
        error:
          message +
          (refunded
            ? " Tu pago se devolvió automáticamente; el reembolso aparece en tu tarjeta en unos días."
            : " Tu pago quedó registrado y el equipo te contactará para devolverlo."),
        code: refunded ? "ROOM_TAKEN_REFUNDED" : "ROOM_TAKEN_UNREFUNDED",
      });
    };

    const firstAssign = await assignRooms();
    if (firstAssign.error !== undefined) {
      if (!paymentIntent) return reply.status(400).send({ error: firstAssign.error });
      return await failWithoutRoom(firstAssign.error);
    }
    let assignments: Assignment[] = firstAssign.assignments;

    // Resolve bath variants for each pet (if provided)
    const bathByPet = new Map<string, { variantId: string; price: number }>();
    if (bathSelectionsByPet && Object.keys(bathSelectionsByPet).length > 0) {
      const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bathType) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }
      for (const [petId, sel] of Object.entries(bathSelectionsByPet)) {
        const ps = petSizes.find((x) => x.pet.id === petId);
        if (!ps) continue;
        // ps.size proviene de sizeFromWeight → nunca "XS" (no requiere colapso).
        const size: PetSize = ps.size;
        const variant = await prisma.serviceVariant.findUnique({
          where: {
            serviceTypeId_petSize_deslanado_corte: {
              serviceTypeId: bathType.id,
              petSize: size,
              deslanado: sel.deslanado,
              corte: sel.corte,
            },
          },
        });
        if (!variant || !variant.isActive) {
          return reply.status(400).send({
            error: `Variante de baño no disponible para ${ps.pet.name}`,
          });
        }
        bathByPet.set(petId, { variantId: variant.id, price: Number(variant.price) });
      }
    }
    // Con PI, los baños contratados deben ser exactamente los del intent.
    if (piBathVariantByPet) {
      const same =
        piBathVariantByPet.size === bathByPet.size &&
        Array.from(piBathVariantByPet.entries()).every(
          ([petId, variantId]) => bathByPet.get(petId)?.variantId === variantId,
        );
      if (!same) {
        request.log.warn(
          { tag: "multi-pi-mismatch", paymentIntentId: stripePaymentIntentId, ownerId, what: "bath" },
          "[pago] los baños de /multi no coinciden con el PaymentIntent",
        );
        return reply.status(400).send({
          error: "Los datos de la reservación no coinciden con el pago realizado. Vuelve a cotizar.",
          code: "PAYMENT_MISMATCH",
        });
      }
    }

    // Medicamento: notas obligatorias por mascota; el recargo
    // (medicationSurchargePct de Config → Tarifas sobre SU hospedaje) lo pone
    // computeStayPricing.
    const medicationNotesByPet = new Map<string, string>();
    if (medicationByPet && Object.keys(medicationByPet).length > 0) {
      for (const [petId, sel] of Object.entries(medicationByPet)) {
        const trimmed = sel?.notes?.trim() ?? "";
        if (trimmed.length === 0) {
          return reply.status(400).send({
            error: "Las instrucciones de administración del medicamento son obligatorias",
          });
        }
        if (!assignments.some((x) => x.petId === petId)) continue;
        medicationNotesByPet.set(petId, trimmed);
      }
    }

    // Base por mascota (hospedaje + medicamento + baño) — la misma que
    // create-intent usó para resolver y repartir el descuento.
    const stayInputOf = (petId: string) => {
      const ps = petSizes.find((x) => x.pet.id === petId);
      return {
        petWeightKg: ps?.pet.weight ?? null,
        totalDays,
        hasMedication: medicationNotesByPet.has(petId),
        addonsAmount: bathByPet.get(petId)?.price ?? 0,
        config: pricingConfig,
      };
    };
    const baseByPet = assignments.map((a) =>
      computeStayPricing({ ...stayInputOf(a.petId), sameDay: false }),
    );
    const baseTotal = roundMoney(baseByPet.reduce((sum, b) => sum + b.total, 0));

    // Descuento credit-only (sin PI): re-validar server-side contra el subtotal
    // del servicio. En el flujo Stripe ya se leyó del metadata del PI.
    if (creditOnly) {
      const d = await resolveDiscount(prisma, {
        code: discountCode,
        subtotal: baseTotal,      });
      if (d.error) {
        return reply.status(400).send({ error: d.error });
      }
      discountTotal = d.discountTotal;
      discountCodeId = d.discountCodeId;
    }
    // Acotar defensivamente (el metadata del PI podría no cuadrar con la base).
    discountTotal = Math.min(Math.max(0, discountTotal), baseTotal);

    // Same-day surcharge: OWNER booking < 24h before check-in pays +20%.
    // Con PI se respeta lo que el intent cobró (un intent creado a las 23:50 y
    // confirmado a las 00:05 no debe cambiar de precio).
    // Sin PI (saldo a favor): "mismo día" se mide contra la medianoche LOCAL
    // del check-in; las 00:00 UTC guardadas son las 17:00 del día anterior.
    const hoursUntilCheckIn = hoursUntilHotelDay(checkIn);
    const sameDaySurcharge =
      piSameDaySurcharge !== null
        ? piSameDaySurcharge
        : owner.role === "OWNER" && hoursUntilCheckIn < 24;

    // Precio FINAL por mascota: descuento repartido en proporción a su base
    // (allocateProportional, igual que create-intent) y recargo de mismo día
    // sobre la base ya descontada. Es la MISMA función que fijó el monto del
    // PI, así lo cobrado y lo persistido no dependen de redondeos distintos.
    const discountByRow = allocateProportional(
      discountTotal,
      baseByPet.map((b) => b.total),
    );
    const pricingByPet = new Map<string, StayPricing>();
    assignments.forEach((a, i) => {
      pricingByPet.set(
        a.petId,
        computeStayPricing({
          ...stayInputOf(a.petId),
          sameDay: sameDaySurcharge,
          discount: discountByRow[i],
        }),
      );
    });

    // Servicio a domicilio — fee RE-CALCULADA server-side desde lat/lng (igual
    // que en /payments/create-intent). Costo logístico fijo: NO lleva el
    // recargo mismo-día, pero SÍ entra en la base del anticipo. En grupos
    // multi-mascota se cobra UNA sola vez (se adjunta a la primera reserva).
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    let deliveryActive = false;
    if (homeDelivery && Number.isFinite(homeDelivery.lat) && Number.isFinite(homeDelivery.lng)) {
      const quote = await quoteDelivery(
        prisma,
        homeDelivery.lat,
        homeDelivery.lng,
        homeDelivery.trip ?? "PICKUP"
      );
      if (quote.active) {
        deliveryActive = true;
        deliveryFee = quote.fee;
        deliveryDistanceKm = quote.distanceKm;
      }
    }

    // Σ precio final por mascota + domicilio (costo fijo por grupo, sin recargo).
    const grandTotal = roundMoney(
      assignments.reduce((s, a) => s + (pricingByPet.get(a.petId)?.total ?? 0), 0) +
        deliveryFee,
    );

    const amountDue = paymentType === "DEPOSIT"
      ? Math.ceil(grandTotal * 0.20)
      : grandTotal;

    // Credit-only path: owner's saldo covers the deposit/total and no Stripe
    // charge was created. El saldo TIENE que cubrir el monto completo; si no,
    // el cliente debe pagar con tarjeta (create-intent lo manda a Stripe). Sin
    // este candado, cualquiera con saldo $0 confirmaba reservas "pagadas".
    if (creditOnly) {
      const ownerCredit = Number(owner.creditBalance || 0);
      if (ownerCredit + 0.005 < amountDue) {
        request.log.warn(
          { tag: "multi-credit-insufficient", ownerId, amountDue, ownerCredit },
          "[pago] intento de confirmar con saldo insuficiente y sin PaymentIntent",
        );
        return reply.status(402).send({
          error: "Tu saldo a favor no cubre el monto de la reservación. Paga con tarjeta para confirmar.",
          code: "CREDIT_INSUFFICIENT",
          amountDue,
          creditAvailable: ownerCredit,
        });
      }
      creditApplied = amountDue;
    } else if (paymentIntent) {
      // Lo que Stripe cobró debe ser lo que esta reserva cuesta (menos el
      // saldo aplicado en el intent). Tolerancia de $5 por los redondeos
      // distintos entre create-intent (ceil) y este cálculo (proporcional).
      const expectedCharge = amountDue - creditApplied;
      const charged = paymentIntent.amount / 100;
      // $5 o 1% (grupos grandes con medicamento y mismo día acumulan más
      // diferencia de redondeo); un fraude real es de otro orden de magnitud.
      if (Math.abs(charged - expectedCharge) > Math.max(5, amountDue * 0.01)) {
        request.log.warn(
          {
            tag: "multi-pi-amount-mismatch",
            paymentIntentId: stripePaymentIntentId,
            ownerId,
            charged,
            expectedCharge,
            amountDue,
            creditApplied,
          },
          "[pago] el monto cobrado no corresponde a la reservación",
        );
        return reply.status(400).send({
          error: "El monto pagado no corresponde a esta reservación. Vuelve a cotizar.",
          code: "PAYMENT_MISMATCH",
        });
      }
    }

    // Reserva + pago + addon de baño + descuento de saldo en UNA transacción
    // interactiva: si algo falla a mitad, NADA se persiste (no quedan reservas
    // sin su registro de pago, ni saldo descontado sin reserva). Las
    // notificaciones (push) y lecturas auxiliares van DESPUÉS del commit.
    const isDeposit = paymentType === "DEPOSIT";
    let reservations!: Prisma.ReservationGetPayload<{
      include: { pet: true; room: true };
    }>[];
    // Si otro request ganó el lugar (RoomTakenError, antes de escribir nada),
    // se vuelve a buscar cuarto y se reintenta la transacción; con un PI ya
    // cobrado no se puede responder 4xx a secas (ver failWithoutRoom).
    const MAX_ROOM_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
    try {
      reservations = await prisma.$transaction(async (tx) => {
        // La búsqueda del cuarto (arriba) corre sin lock; aquí se toma el
        // advisory lock por cuarto y se re-verifica el cupo antes de escribir,
        // como hacen baños (42) y guardería (43). Si otro request ganó el
        // lugar, RoomTakenError → 409.
        await lockRoomsAndVerifyCapacity(tx, assignments, checkIn, checkOut);
        const created: Prisma.ReservationGetPayload<{
          include: { pet: true; room: true };
        }>[] = [];
        // Saldo a favor por repartir entre los pagos de las filas.
        let remainingCredit = Number(creditApplied.toFixed(2));
        let piAttached = false;

        for (let i = 0; i < assignments.length; i++) {
          const a = assignments[i];
          const bath = bathByPet.get(a.petId);
          const row = pricingByPet.get(a.petId)!;
          const medNotes = medicationNotesByPet.get(a.petId) ?? null;
          // La fee de domicilio se adjunta SOLO a la primera reserva del grupo
          // (un viaje cubre a todas las mascotas del mismo dueño).
          const isFirst = i === 0;
          const deliveryForThis = isFirst && deliveryActive ? deliveryFee : 0;
          const rowDiscount = row.discount;
          const reservationAmount = roundMoney(row.total + deliveryForThis);

          const res = await tx.reservation.create({
            data: {
              checkIn,
              checkOut,
              checkInTime: checkInTime ?? null,
              checkOutTime: checkOutTime ?? null,
              totalDays,
              totalAmount: new Prisma.Decimal(reservationAmount),
              // Desglose del cobro original — la misma foto que el cliente vio
              // al reservar. totalAmount muta después; esto no se recalcula.
              lodgingAmount: new Prisma.Decimal(row.lodging),
              ...(row.medicationFee > 0
                ? { medicationFee: new Prisma.Decimal(row.medicationFee) }
                : {}),
              ...(row.sameDayFee > 0
                ? { sameDayFee: new Prisma.Decimal(row.sameDayFee) }
                : {}),
              ...(discountCodeId
                ? { discountCodeId, discountTotal: new Prisma.Decimal(rowDiscount) }
                : {}),
              notes,
              medicationNotes: medNotes,
              legalAccepted,
              status: "CONFIRMED",
              groupId,
              paymentType,
              // Deposit deadline = check-in day. Owner can pay the balance in
              // the app or in person at the branch on arrival.
              depositDeadline: paymentType === "DEPOSIT" ? checkIn : null,
              ownerId,
              petId: a.petId,
              roomId: a.roomId,
              // Servicio a domicilio (persistido en la primera reserva del grupo).
              ...(isFirst && deliveryActive
                ? {
                    homeDelivery: true,
                    homeDeliveryAddress: homeDelivery!.address,
                    homeDeliveryDistanceKm: deliveryDistanceKm,
                    homeDeliveryFee: new Prisma.Decimal(deliveryFee),
                    homeDeliveryTrip: homeDelivery!.trip ?? "PICKUP",
                  }
                : {}),
            },
            include: { pet: true, room: true },
          });
          created.push(res);

          const paidAmount = isDeposit
            ? Number((Number(res.totalAmount) * 0.20).toFixed(2))
            : Number(res.totalAmount);
          // El pago de cada fila se reparte entre el saldo a favor aplicado (se
          // agota fila por fila) y lo que cobró Stripe. Así `payments.amount` de
          // un pago STRIPE es exactamente lo que Stripe cobró (bruto), y un
          // reembolso nunca pide a Stripe dinero que salió del saldo.
          const creditPart = creditOnly
            ? paidAmount
            : Number(Math.min(remainingCredit, paidAmount).toFixed(2));
          remainingCredit = Number((remainingCredit - creditPart).toFixed(2));
          const stripePart = Number((paidAmount - creditPart).toFixed(2));
          const paymentStatus = isDeposit ? "PARTIAL" : "PAID";
          let payment: { id: string } | null = null;
          if (creditPart > 0) {
            payment = await tx.payment.create({
              data: {
                amount: new Prisma.Decimal(creditPart),
                method: "CREDIT",
                status: paymentStatus,
                paidAt: new Date(),
                notes: isDeposit ? "Anticipo 20% (saldo a favor)" : "Pago con saldo a favor",
                reservationId: res.id,
                userId: ownerId,
              },
            });
          }
          if (stripePart > 0) {
            payment = await tx.payment.create({
              data: {
                amount: new Prisma.Decimal(stripePart),
                method: "STRIPE",
                status: paymentStatus,
                // El PI cuelga del PRIMER pago Stripe del grupo (idempotencia).
                stripePaymentIntentId: piAttached ? null : stripePaymentIntentId,
                paidAt: new Date(),
                notes: isDeposit ? "Anticipo 20%" : null,
                reservationId: res.id,
                userId: ownerId,
              },
            });
            piAttached = true;
          }

          // Persist bath addon attached to this reservation's payment
          if (bath) {
            await tx.reservationAddon.create({
              data: {
                reservationId: res.id,
                variantId: bath.variantId,
                unitPrice: new Prisma.Decimal(bath.price),
                paidWith: "BOOKING",
                paymentId: payment?.id ?? null,
              },
            });
          }
        }

        // Si Stripe cobró (aunque sean centavos por redondeo entre el ceil del
        // intent y el reparto por filas) y ningún pago se llevó el PI, el cargo
        // no puede quedar huérfano: sin fila STRIPE, un reintento del confirm no
        // encuentra la reserva y un reembolso nunca devuelve ese cargo.
        if (paymentIntent && !piAttached && created[0]) {
          await tx.payment.create({
            data: {
              amount: new Prisma.Decimal(paymentIntent.amount / 100),
              method: "STRIPE",
              status: isDeposit ? "PARTIAL" : "PAID",
              stripePaymentIntentId,
              paidAt: new Date(),
              notes: "Diferencia de redondeo cobrada con tarjeta",
              reservationId: created[0].id,
              userId: ownerId,
            },
          });
          piAttached = true;
        }

        // Deduct credit applied (if any) and write ledger entry — atómico con lo anterior.
        if (creditApplied > 0) {
          const updatedOwner = await tx.user.update({
            where: { id: ownerId },
            data: {
              creditBalance: { decrement: creditApplied },
              lastCreditEntryAt: new Date(),
            },
          });
          await tx.creditLedger.create({
            data: {
              userId: ownerId,
              type: "CREDIT_APPLIED",
              amount: -creditApplied,
              balanceAfter: Number(updatedOwner.creditBalance),
              description: `Saldo aplicado en nueva reservación`,
              reservationId: created[0]?.id ?? null,
            },
          });
        }

        // Incrementar el uso del código UNA vez por booking. Idempotente: un
        // reintento del mismo PI devuelve las reservas existentes (rama de arriba)
        // sin re-entrar a esta transacción.
        if (discountCodeId) {
          await tx.discountCode.update({
            where: { id: discountCodeId },
            data: { usesCount: { increment: 1 } },
          });
        }

        return created;
      });
      break;
    } catch (err) {
      if (!(err instanceof RoomTakenError)) throw err;
      request.log.warn(
        { tag: "multi-room-taken", ownerId, room: err.roomName, paymentIntentId: stripePaymentIntentId, attempt },
        "[reservas] el cuarto se ocupó entre la búsqueda y la transacción",
      );
      if (attempt < MAX_ROOM_ATTEMPTS) {
        const again = await assignRooms();
        if (again.error === undefined) {
          assignments = again.assignments;
          continue;
        }
        return await failWithoutRoom(again.error);
      }
      return await failWithoutRoom(
        `El cuarto ${err.roomName} ya fue ocupado por otra reserva en esas fechas.`,
      );
    }
    }

    // ─── Post-commit (no crítico): notificaciones y lecturas auxiliares ───
    // Baños contratados: avisar a staff/admin (fire-and-forget).
    for (const res of reservations) {
      const bath = bathByPet.get(res.petId);
      if (!bath) continue;
      const variantRow = await prisma.serviceVariant.findUnique({
        where: { id: bath.variantId },
      });
      if (variantRow) {
        notifyBathContracted(prisma, {
          reservationId: res.id,
          petName: res.pet.name,
          assignedStaffId: res.staffId,
          deslanado: variantRow.deslanado,
          corte: variantRow.corte,
          price: bath.price,
        }).catch((err) => fastify.log.error({ err }, "notifyBathContracted falló"));
      }
    }

    // Saldo a favor aplicado: avisar al dueño (fire-and-forget).
    if (creditApplied > 0) {
      notifyUser(prisma, {
        userId: ownerId,
        type: "CREDIT_APPLIED",
        title: "Saldo a favor aplicado 💰",
        body: `Se aplicaron $${creditApplied.toLocaleString("es-MX")} de tu saldo a la nueva reservación.`,
        data: { reservationId: reservations[0]?.id, amount: creditApplied },
      }).catch((err) => fastify.log.error({ err }, "notifyUser(credit) falló"));
    }

    // Aviso al equipo. Fire-and-forget: no debe bloquear la respuesta.
    void notifyNewReservation(prisma, {
      reservations,
      owner,
      source: request.userRole === "OWNER" ? "APP_CLIENTE" : "APP_ADMIN",
      createdByUserId: request.userId ?? null,
    });

    // Email de confirmación al dueño
    if (owner.email) {
      const depositAmount = paymentType === "DEPOSIT" ? grandTotal * 0.20 : grandTotal;
      const remainingAmount = grandTotal - depositAmount;
      const roomNames = [...new Set(reservations.map((r) => r.room?.name).filter(Boolean))];
      const tpl = reservationConfirmedTemplate({
        ownerFirstName: owner.firstName,
        petNames: reservations.map((r) => r.pet.name),
        checkIn,
        checkOut,
        roomName: roomNames.length === 1 ? (roomNames[0] as string) : null,
        totalAmount: grandTotal,
        paymentType: paymentType as "FULL" | "DEPOSIT",
        remainingAmount,
      });
      // Fire-and-forget: el correo (Resend, ~2-5 s) no debe bloquear la
      // respuesta; sendEmail ya es tolerante a fallas internamente.
      sendEmail({ to: owner.email, ...tpl }).catch((err) =>
        fastify.log.error({ err }, "sendEmail(confirmación) falló")
      );
    }

    return reply.status(201).send({ reservations, grandTotal, discountTotal, groupId, creditApplied });
  });

  // GET /reservations/:id/checklists — reportes diarios (owner o staff/admin)
  fastify.get<{ Params: { id: string } }>(
    "/reservations/:id/checklists",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
      });
      if (!reservation) {
        return reply
          .status(404)
          .send({ error: "Reservación no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!(await canAccessReservation(prisma, reservation, request))) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const checklists = await prisma.dailyChecklist.findMany({
        where: { reservationId: request.params.id },
        orderBy: { date: "desc" },
        include: {
          staff: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });
      // El relevo [HANDOFF] entre staff vive en additionalNotes: al dueño (o
      // co-dueño) solo le llega la parte pública; el equipo lo ve completo.
      return stripChecklistInternalFieldsList(checklists, isStaffOrAdmin);
    }
  );

  // POST /reservations/:id/cancel — cancelación total inmediata por owner
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/cancel",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CancelReservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { refundChoice } = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        select: { id: true, ownerId: true, petId: true, status: true },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      // Cancela quien reservó o quien comparte la mascota (staff no, a
      // propósito: el equipo cancela por otra ruta).
      if (
        reservation.ownerId !== request.userId &&
        !(await isCoOwner(prisma, reservation.petId, request.userId))
      ) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (reservation.status !== "CONFIRMED") {
        return reply.status(400).send({
          error: "Solo puedes cancelar reservaciones confirmadas",
        });
      }

      // Primero el reembolso, luego la cancelación: si Stripe rechaza el
      // reembolso, la reserva se queda CONFIRMED y el cliente puede volver a
      // intentar (antes quedaba CANCELLED sin reembolso).
      let result: Awaited<ReturnType<typeof processRefund>>;
      try {
        result = await processRefund(prisma, {
          reservationId: reservation.id,
          refundChoice,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error procesando reembolso";
        return reply.status(409).send({ error: message });
      }

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED" },
      });
      return reply.send({ success: true, ...result });
    }
  );

  // POST /reservations/:id/issue-refund — cliente elige reembolso después de
  // que el admin canceló la reserva. La reserva ya está CANCELLED y aún no
  // tiene un Payment con status REFUNDED.
  fastify.post<{ Params: { id: string } }>(
    "/reservations/:id/issue-refund",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CancelReservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { refundChoice } = parsed.data;

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: { payments: true },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (
        reservation.ownerId !== request.userId &&
        !(await isCoOwner(prisma, reservation.petId, request.userId))
      ) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (reservation.status !== "CANCELLED") {
        return reply.status(400).send({
          error: "Solo puedes elegir reembolso en reservas canceladas",
        });
      }
      if (reservation.payments.some((p) => p.status === "REFUNDED")) {
        return reply.status(409).send({
          error: "Ya se emitió un reembolso para esta reservación",
        });
      }

      try {
        const result = await processRefund(prisma, {
          reservationId: reservation.id,
          refundChoice,
        });
        return reply.send({ success: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error procesando reembolso";
        return reply.status(409).send({ error: message });
      }
    }
  );
}
