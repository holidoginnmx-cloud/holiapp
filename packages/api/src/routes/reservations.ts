import { FastifyInstance } from "fastify";
import {
  CreateReservationSchema,
  CreateMultiReservationSchema,
  UpdateReservationStatusSchema,
  UpdateReservationTimesSchema,
  UpdateReservationDeliverySchema,
  ReservationStatus,
  CancelReservationSchema,
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
import { notifyUser, notifyTeamReservationUpdated } from "../lib/notify";
import { notifyNewReservation } from "../lib/notifyNewReservation";
import { markQuoteConverted } from "../lib/quotes";
import { processRefund } from "../lib/refund";
import { notifyExpiringVaccines } from "../lib/auto-actions";
import { triggerMaintenance } from "../lib/maintenance";
import {
  stripInternalFields,
  stripInternalFieldsList,
} from "../lib/stripInternal";
import { LEGAL_DOC_VERSIONS, REQUIRED_FOR_BOOKING } from "../lib/legal";
import {
  getLodgingPricing,
  pricePerDayForWeight,
  sizeFromWeight,
  computeDaycareHours,
} from "../lib/pricing";
import { chainStarts, evaluateStart, localYMD } from "../lib/bathAvailability";
import {
  loadScheduleCfg,
  loadBusyIntervals,
  resolveBathDuration,
} from "../lib/bathAvailabilityDb";
import { quoteDelivery } from "../lib/delivery";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-03-31.basil",
});

// Reparte un total de grupo pactado manualmente en n filas con 2 decimales;
// la primera fila absorbe el residuo de redondeo para que la suma sea exacta.
function splitGroupTotal(total: number, n: number): number[] {
  if (n <= 1) return [Number(total.toFixed(2))];
  const share = Math.floor((total / n) * 100) / 100;
  const first = Number((total - share * (n - 1)).toFixed(2));
  return [first, ...Array<number>(n - 1).fill(share)];
}

// Reparte un monto entre las filas del grupo EN PROPORCIÓN a lo que cuesta
// cada una (la última absorbe el residuo). Se usa para el anticipo: es del
// grupo, pero cada reserva necesita su parte para que el saldo por mascota
// cuadre — colgarlo entero de la primera dejaba a las demás con su total
// íntegro pendiente. Con pesos en cero cae a partes iguales.
function splitProportional(amount: number, weights: number[]): number[] {
  const n = weights.length;
  if (n <= 1) return [Number(amount.toFixed(2))];
  const sum = weights.reduce((a, w) => a + w, 0);
  const parts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < n - 1; i++) {
    const part =
      sum > 0
        ? Number(((amount * (weights[i] ?? 0)) / sum).toFixed(2))
        : Math.floor((amount / n) * 100) / 100;
    parts.push(part);
    allocated += part;
  }
  parts.push(Number((amount - allocated).toFixed(2)));
  return parts;
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
  //  Nota: el admin web escribe estas mismas columnas directo en
  //  Supabase y admite tarifa manual; no chocan (columnas distintas
  //  del mismo registro), pero no hay que divergir a propósito.
  // ────────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    "/reservations/:id/delivery",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = UpdateReservationDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: request.params.id },
        include: {
          pet: { select: { name: true } },
          payments: true,
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
      if (reservation.status === "CANCELLED" || reservation.status === "CHECKED_OUT") {
        return reply.status(400).send({ error: "La reserva ya no se puede modificar" });
      }
      // El equipo puede ajustarlo con la estancia en curso; el dueño solo antes
      // de que su mascota llegue.
      if (!isStaffOrAdmin && reservation.status !== "CONFIRMED") {
        return reply
          .status(400)
          .send({ error: "El domicilio solo se puede cambiar antes del check-in" });
      }
      // Aquí siempre se mueve el total: mismo criterio que el PATCH de precio.
      const pendingChange = await prisma.reservationChangeRequest.findFirst({
        where: { reservationId: reservation.id, status: "PENDING" },
      });
      if (pendingChange) {
        return reply.status(409).send({
          error:
            "Hay una solicitud de cambio pendiente en esta reserva. Resuélvela antes de tocar el total.",
        });
      }

      const oldFee = reservation.homeDelivery ? Number(reservation.homeDeliveryFee ?? 0) : 0;
      let deliveryData: Prisma.ReservationUpdateInput;
      let newFee = 0;
      let address = "";
      let isCourtesy = false;

      if (parsed.data.enable) {
        // En un grupo multi-mascota el domicilio vive en UNA sola fila (es un
        // viaje, no uno por perro). Si otra hermana ya lo tiene, se edita ahí.
        if (reservation.groupId) {
          const sibling = await prisma.reservation.findFirst({
            where: {
              groupId: reservation.groupId,
              id: { not: reservation.id },
              homeDelivery: true,
              status: { not: "CANCELLED" },
            },
            include: { pet: { select: { name: true } } },
          });
          if (sibling) {
            return reply.status(409).send({
              error: `El domicilio de este grupo está en la reserva de ${sibling.pet.name}; edítalo desde ahí.`,
            });
          }
        }

        const quote = await quoteDelivery(prisma, parsed.data.lat, parsed.data.lng);
        if (!quote.active) {
          return reply
            .status(400)
            .send({ error: "El servicio a domicilio no está disponible por ahora" });
        }
        // Regalar el viaje es decisión del equipo: si la bandera viene del
        // dueño se ignora. Se guarda como tarifa 0 —el viaje queda registrado
        // en la reserva pero no entra al total— igual que un add-on de cortesía.
        isCourtesy = !!parsed.data.isCourtesy && isStaffOrAdmin;
        newFee = isCourtesy ? 0 : quote.fee;
        address = parsed.data.address;
        deliveryData = {
          homeDelivery: true,
          homeDeliveryAddress: parsed.data.address,
          homeDeliveryDistanceKm: quote.distanceKm,
          homeDeliveryFee: new Prisma.Decimal(newFee),
        };
      } else {
        if (!reservation.homeDelivery) {
          return reply
            .status(400)
            .send({ error: "La reserva no tiene servicio a domicilio" });
        }
        deliveryData = {
          homeDelivery: false,
          homeDeliveryAddress: null,
          homeDeliveryDistanceKm: null,
          homeDeliveryFee: null,
        };
      }

      // Al quitar se descuenta la tarifa GUARDADA, no una recotización: se
      // devuelve exactamente lo que se cobró, aunque los precios hayan cambiado.
      const delta = Number((newFee - oldFee).toFixed(2));
      const newTotal = Math.max(0, Number((Number(reservation.totalAmount) + delta).toFixed(2)));

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { ...deliveryData, totalAmount: new Prisma.Decimal(newTotal) },
      });

      const totalPaid = reservation.payments
        .filter((p) => p.status === "PAID" || p.status === "PARTIAL")
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const overpaid = Math.max(0, Number((totalPaid - newTotal).toFixed(2)));

      // Avisos best-effort: nunca tumban el cambio ya escrito.
      try {
        if (isStaffOrAdmin) {
          await notifyUser(prisma, {
            userId: reservation.ownerId,
            type: "GENERAL",
            title: parsed.data.enable
              ? "Servicio a domicilio agregado 🚗"
              : "Servicio a domicilio retirado",
            body: parsed.data.enable
              ? isCourtesy
                ? `Recogeremos y entregaremos a ${reservation.pet.name} en ${address}, sin costo. ¡Va por nuestra cuenta!`
                : `Recogeremos y entregaremos a ${reservation.pet.name} en ${address}. La tarifa de $${newFee} se suma al total y se paga al recoger.`
              : `Se quitó el servicio a domicilio de la reserva de ${reservation.pet.name}. El total bajó $${oldFee}.`,
            data: { reservationId: reservation.id, kind: "DELIVERY_UPDATED" },
          });
        }
        await notifyTeamReservationUpdated(prisma, {
          reservationId: reservation.id,
          petName: reservation.pet.name,
          body: parsed.data.enable
            ? `Se agregó servicio a domicilio${isCourtesy ? " de CORTESÍA" : ` ($${newFee})`} — ${address}.`
            : `Se quitó el servicio a domicilio (−$${oldFee}).`,
          actorUserId: request.userId,
          assignedStaffId: reservation.staffId,
        });
      } catch (err) {
        console.error("[delivery] avisos fallaron:", err);
      }

      return reply.send({ success: true, delta, newTotal, overpaid });
    }
  );

  // POST /reservations — crear (calcula totalDays y totalAmount)
  fastify.post("/reservations", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parsed = CreateReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const {
      reservationType,
      checkIn,
      checkOut,
      // STAY: hora estimada de llegada/recogida (opcional). En DAYCARE la rama
      // correspondiente las lee aparte de parsed.data porque ahí son requeridas.
      checkInTime,
      checkOutTime,
      ownerId,
      petId,
      petIds,
      roomId,
      roomIds,
      notes,
      internalNotes,
      legalAccepted,
      appointmentAt,
      deslanado,
      corte,
      bath,
      staffId,
      medicationNotes,
      depositAgreed,
      homeDelivery,
      totalAmountOverride,
      scheduleOverride,
      quoteId,
    } = parsed.data;

    // OWNER solo puede reservar para sí mismo; STAFF/ADMIN pueden reservar en nombre de cualquiera.
    const isStaffOrAdmin =
      request.userRole === "ADMIN" || request.userRole === "STAFF";
    if (!isStaffOrAdmin && ownerId !== request.userId) {
      return reply
        .status(403)
        .send({ error: "Solo puedes reservar para tu propia cuenta" });
    }

    if (!legalAccepted) {
      return reply
        .status(400)
        .send({ error: "Debes aceptar los términos legales para reservar" });
    }

    // Verify owner exists
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      return reply.status(404).send({ error: "Dueño no encontrado" });
    }

    // Lista de mascotas: petIds (multi-perro) o petId único (flujo clásico).
    // Se crea UNA reserva por mascota; con más de una comparten groupId.
    const petIdList = Array.from(
      new Set(petIds?.length ? petIds : petId ? [petId] : []),
    );
    if (petIdList.length === 0) {
      return reply.status(400).send({ error: "Selecciona al menos una mascota" });
    }
    if (petIdList.length > 1 && !isStaffOrAdmin) {
      return reply.status(403).send({
        error: "Solo staff/admin puede crear reservas multi-mascota por esta vía",
      });
    }
    // El total pactado manualmente es exclusivo de staff/admin (nunca se
    // confía en el cliente owner para fijar el precio).
    if (totalAmountOverride != null && !isStaffOrAdmin) {
      return reply.status(403).send({
        error: "Solo staff/admin puede fijar un total manual",
      });
    }
    // Saltarse la agenda ("agendar de todos modos") también es exclusivo de
    // staff/admin: el cliente nunca debe poder reservar un horario imposible.
    if (scheduleOverride && !isStaffOrAdmin) {
      return reply.status(403).send({
        error: "Solo staff/admin puede agendar fuera de la disponibilidad",
      });
    }

    // Verify pets exist and belong to owner (orden estable = orden pedido)
    const foundPets = await prisma.pet.findMany({
      where: { id: { in: petIdList } },
    });
    if (foundPets.length !== petIdList.length) {
      return reply.status(404).send({ error: "Mascota no encontrada" });
    }
    // Basta con que la mascota sea suya O se la hayan compartido: quien reserva
    // puede ser el co-dueño. La reserva se guarda a nombre de quien reserva
    // (`ownerId`), que es también quien paga y a quien se le abona un reembolso.
    const sharedForBooker = await sharedPetIds(prisma, ownerId);
    if (
      foundPets.some(
        (p) => p.ownerId !== ownerId && !sharedForBooker.includes(p.id)
      )
    ) {
      return reply.status(400).send({ error: "La mascota no pertenece al dueño indicado" });
    }
    const groupPets = petIdList.map((id) => foundPets.find((p) => p.id === id)!);
    const groupId = groupPets.length > 1 ? randomUUID() : null;

    // Validar staff asignado (opcional). Solo usuarios con rol STAFF.
    if (staffId) {
      const staffUser = await prisma.user.findUnique({ where: { id: staffId } });
      if (!staffUser || staffUser.role !== "STAFF") {
        return reply.status(400).send({ error: "El staff asignado no es válido" });
      }
    }

    const trimmedMedication = medicationNotes?.trim() || null;

    // Servicio a domicilio: la tarifa SIEMPRE se recalcula server-side desde lat/lng.
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    let deliveryAddress: string | null = null;
    if (
      homeDelivery &&
      Number.isFinite(homeDelivery.lat) &&
      Number.isFinite(homeDelivery.lng)
    ) {
      const quote = await quoteDelivery(prisma, homeDelivery.lat, homeDelivery.lng);
      if (quote.active) {
        deliveryFee = quote.fee;
        deliveryDistanceKm = quote.distanceKm;
        deliveryAddress = homeDelivery.address;
      }
    }
    const deliveryData = deliveryAddress
      ? {
          homeDelivery: true,
          homeDeliveryAddress: deliveryAddress,
          homeDeliveryDistanceKm: deliveryDistanceKm,
          homeDeliveryFee: new Prisma.Decimal(deliveryFee),
        }
      : {};

    // Campos comunes adicionales: staff y medicamento aplican a TODAS las
    // filas del grupo; el domicilio se registra una sola vez (un viaje por
    // grupo) y el anticipo se REPARTE entre las filas en proporción a lo que
    // cuesta cada mascota (ver splitProportional).
    const sharedData = {
      ...(staffId ? { staffId } : {}),
      ...(trimmedMedication ? { medicationNotes: trimmedMedication } : {}),
    };
    // Partes del anticipo, calculadas por cada rama con los totales de sus
    // filas (el fee de domicilio de la primera incluido).
    const splitDeposit = (rowTotals: number[]): number[] | null =>
      depositAgreed != null && depositAgreed > 0
        ? splitProportional(depositAgreed, rowTotals)
        : null;
    const rowExtraData = (isFirst: boolean, depositShare?: number | null) => ({
      ...sharedData,
      ...(depositShare != null && depositShare > 0
        ? { depositAgreed: new Prisma.Decimal(depositShare) }
        : {}),
      ...(isFirst ? deliveryData : {}),
    });

    // Respuesta: la primera reserva (misma forma que siempre, compatible con
    // clientes existentes) + resumen del grupo cuando se crearon varias filas.
    type CreatedReservation = Prisma.ReservationGetPayload<{
      include: { pet: true; room: true };
    }>;
    const sendCreated = (rows: CreatedReservation[]) => {
      // Aviso al equipo. Punto único para las tres ramas (BATH/DAYCARE/STAY),
      // que convergen aquí. Fire-and-forget: el helper no lanza y el equipo no
      // debe esperar al push para recibir su 201.
      void notifyNewReservation(prisma, {
        reservations: rows,
        owner,
        source: request.userRole === "OWNER" ? "APP_CLIENTE" : "APP_ADMIN",
        createdByUserId: request.userId ?? null,
      });

      // La reserva vino de una cotización: se cierra el círculo. También
      // fire-and-forget — que falle marcarla NUNCA debe tumbar la creación de
      // la reserva, que es lo que de verdad importa.
      if (quoteId) {
        void markQuoteConverted(
          prisma,
          quoteId,
          { id: rows[0].id, groupId: rows[0].groupId },
          request.userId ?? null,
        );
      }

      return reply.status(201).send(
        rows.length > 1
          ? {
              ...rows[0],
              groupReservations: rows.map((r) => ({
                id: r.id,
                petId: r.petId,
                petName: r.pet?.name ?? null,
                totalAmount: r.totalAmount,
              })),
            }
          : rows[0],
      );
    };

    // ── Rama BATH: cita puntual; el precio se resuelve server-side desde la
    // variante de cada mascota, o del total manual pactado (staff/admin).
    if (reservationType === "BATH") {
      if (!appointmentAt || Number.isNaN(appointmentAt.getTime())) {
        return reply
          .status(400)
          .send({ error: "appointmentAt es requerido para una cita de baño" });
      }

      const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bathType) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }

      // Variante por mascota (la talla puede diferir dentro del grupo).
      const bathVariants: { id: string; price: number; durationMinutes: number | null }[] = [];
      for (const p of groupPets) {
        const size = sizeFromWeight(p.weight ?? 0);
        const variant = await prisma.serviceVariant.findUnique({
          where: {
            serviceTypeId_petSize_deslanado_corte: {
              serviceTypeId: bathType.id,
              petSize: size,
              deslanado: deslanado ?? false,
              corte: corte ?? false,
            },
          },
        });
        if (!variant || !variant.isActive) {
          return reply
            .status(400)
            .send({ error: `Variante de baño no disponible para ${p.name}` });
        }
        bathVariants.push({
          id: variant.id,
          price: Number(variant.price),
          durationMinutes: variant.durationMinutes,
        });
      }

      // ── Agenda: cada mascota ocupa su propio bloque de tiempo ──────────────
      // Antes todas las filas de un grupo se guardaban con la MISMA hora, que
      // es justamente el encime que se reportó. Ahora se encadenan: el segundo
      // perro empieza cuando termina el primero.
      const schedule = await loadScheduleCfg(prisma);
      // Vía `resolveBathDuration` y no leyendo la variante a secas: así respeta
      // la duración propia del perro (`pets.groomingMinutes`) cuando la tiene.
      const bathDurations = await Promise.all(
        bathVariants.map(async (v, i) => {
          const { durationMinutes } = await resolveBathDuration(
            prisma,
            { variantId: v.id, petId: groupPets[i].id },
            schedule,
          );
          return durationMinutes;
        }),
      );
      const bathStarts = chainStarts(appointmentAt, bathDurations, schedule.bufferMinutes);
      const dateYMD = localYMD(appointmentAt);

      const agendaWarnings: string[] = [];
      {
        const busy = await loadBusyIntervals(prisma, dateYMD, schedule);
        for (let i = 0; i < bathStarts.length; i++) {
          const verdict = evaluateStart(bathStarts[i], bathDurations[i], schedule, busy);
          if (!verdict.ok) {
            agendaWarnings.push(`${groupPets[i].name}: ${verdict.message}`);
          }
          // La cita entra a la ocupación aunque haya avisado, para que el
          // siguiente perro de la cadena se evalúe contra la agenda real.
          busy.push({
            startMs: bathStarts[i].getTime(),
            endMs: bathStarts[i].getTime() + bathDurations[i] * 60_000,
            id: `pending-${i}`,
            label: groupPets[i].name,
          });
        }
      }

      // Sin override, el conflicto bloquea. El equipo puede forzar desde el
      // admin: la operación real tiene excepciones (favores, urgencias) y
      // quedan marcadas para verlas distinto en la agenda.
      if (agendaWarnings.length > 0 && !scheduleOverride) {
        return reply.status(409).send({
          error: agendaWarnings.join(" "),
          code: "AGENDA_CONFLICT",
          warnings: agendaWarnings,
        });
      }

      // Monto por fila: total manual repartido, o la variante de cada mascota.
      // El fee de domicilio va SOLO en la primera fila del grupo.
      const amounts =
        totalAmountOverride != null
          ? splitGroupTotal(totalAmountOverride, groupPets.length)
          : bathVariants.map((v) => v.price);
      const deposits = splitDeposit(
        amounts.map((a, i) => a + (i === 0 ? deliveryFee : 0)),
      );

      // Sin pago en creación manual: el total queda como saldo pendiente,
      // el admin registra el cobro después desde el detalle de la reserva.
      const reservations = await prisma.$transaction(async (tx) => {
        const created: CreatedReservation[] = [];
        for (let i = 0; i < groupPets.length; i++) {
          const isFirst = i === 0;
          const res = await tx.reservation.create({
            data: {
              reservationType: "BATH",
              appointmentAt: bathStarts[i],
              durationMinutes: bathDurations[i],
              ...(agendaWarnings.length > 0
                ? {
                    scheduleOverridden: true,
                    scheduleOverrideReason: agendaWarnings.join(" "),
                  }
                : {}),
              totalAmount: new Prisma.Decimal(amounts[i]).add(
                isFirst ? deliveryFee : 0,
              ),
              notes,
              internalNotes: internalNotes ?? null,
              legalAccepted,
              status: "CONFIRMED",
              groupId,
              ownerId,
              petId: groupPets[i].id,
              ...rowExtraData(isFirst, deposits?.[i]),
            },
            include: { pet: true, room: true },
          });
          // Addon para rastrear la variante contratada (el desglose conserva
          // el precio de lista de la variante aunque el total sea manual).
          await tx.reservationAddon.create({
            data: {
              reservationId: res.id,
              variantId: bathVariants[i].id,
              unitPrice: new Prisma.Decimal(bathVariants[i].price),
              paidWith: "BOOKING",
            },
          });
          created.push(res);
        }
        return created;
      });
      return sendCreated(reservations);
    }

    // ── Rama DAYCARE: día único cobrado por hora (tarifa única), sin cuarto
    // y sin cartilla. appointmentAt se normaliza a mediodía UTC (convención
    // del admin web); la hora real vive en checkInTime/checkOutTime.
    if (reservationType === "DAYCARE") {
      if (!appointmentAt || Number.isNaN(appointmentAt.getTime())) {
        return reply
          .status(400)
          .send({ error: "appointmentAt es requerido para una guardería" });
      }
      const inTime = parsed.data.checkInTime ?? null;
      const outTime = parsed.data.checkOutTime ?? null;
      if (!inTime || !outTime) {
        return reply.status(400).send({
          error: "checkInTime y checkOutTime son requeridos para una guardería",
        });
      }
      const hours = computeDaycareHours(inTime, outTime);
      if (hours <= 0) {
        return reply.status(400).send({
          error: "La hora de salida debe ser posterior a la de entrada",
        });
      }

      const dayAnchor = new Date(
        Date.UTC(
          appointmentAt.getUTCFullYear(),
          appointmentAt.getUTCMonth(),
          appointmentAt.getUTCDate(),
          12
        )
      );

      // Total sugerido = horas × tarifa única POR mascota; el admin puede
      // sobrescribirlo con un total de grupo pactado (walk-in). El domicilio
      // siempre se suma aparte, solo en la primera fila.
      const pricingConfig = await getLodgingPricing(prisma);
      const amounts =
        totalAmountOverride != null
          ? splitGroupTotal(totalAmountOverride, groupPets.length)
          : groupPets.map(() => hours * pricingConfig.daycareHourPrice);
      const deposits = splitDeposit(
        amounts.map((a, i) => a + (i === 0 ? deliveryFee : 0)),
      );

      // Sin pago en creación manual: el total queda como saldo pendiente y el
      // admin registra el cobro después (igual que la rama BATH).
      const reservations = await prisma.$transaction(async (tx) => {
        const created: CreatedReservation[] = [];
        for (let i = 0; i < groupPets.length; i++) {
          const isFirst = i === 0;
          const res = await tx.reservation.create({
            data: {
              reservationType: "DAYCARE",
              appointmentAt: dayAnchor,
              checkInTime: inTime,
              checkOutTime: outTime,
              totalAmount: new Prisma.Decimal(amounts[i]).add(
                isFirst ? deliveryFee : 0,
              ),
              notes,
              internalNotes: internalNotes ?? null,
              legalAccepted,
              status: "CONFIRMED",
              groupId,
              ownerId,
              petId: groupPets[i].id,
              ...rowExtraData(isFirst, deposits?.[i]),
            },
            include: { pet: true, room: true },
          });
          created.push(res);
        }
        return created;
      });
      return sendCreated(reservations);
    }

    // ── Rama STAY (default): estancia con rango de fechas y cuarto.
    if (!checkIn || !checkOut) {
      return reply
        .status(400)
        .send({ error: "checkIn y checkOut son requeridos para una estancia" });
    }
    if (checkOut <= checkIn) {
      return reply
        .status(400)
        .send({ error: "checkOut debe ser posterior a checkIn" });
    }

    // Cuarto por mascota: `roomIds` (uno por fila, en el orden de petIds) o el
    // `roomId` único para todo el grupo. Los perros de un grupo no siempre
    // caben juntos ni comparten talla, así que cada uno puede ir a su cuarto.
    if (roomIds && roomIds.length !== groupPets.length) {
      return reply.status(400).send({
        error: "Indica un cuarto por mascota (roomIds debe tener el mismo largo que petIds)",
      });
    }
    const roomIdByPet = roomIds ?? groupPets.map(() => roomId);
    if (roomIdByPet.some((id) => !id)) {
      return reply.status(400).send({ error: "roomId es requerido para una estancia" });
    }

    // Verify rooms exist (una consulta para los cuartos distintos del grupo)
    const uniqueRoomIds = Array.from(new Set(roomIdByPet as string[]));
    const rooms = await prisma.room.findMany({ where: { id: { in: uniqueRoomIds } } });
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    for (const id of uniqueRoomIds) {
      const room = roomById.get(id);
      if (!room) {
        return reply.status(404).send({ error: "Cuarto no encontrado" });
      }
      if (!room.isActive) {
        return reply.status(400).send({ error: `El cuarto ${room.name} no está activo` });
      }
    }

    // Capacity guard por cuarto: se cuenta cuántas mascotas del grupo entran a
    // cada uno (varias pueden compartir) más lo ya ocupado en esas fechas.
    for (const id of uniqueRoomIds) {
      const room = roomById.get(id)!;
      const delGrupo = roomIdByPet.filter((r) => r === id).length;
      const taken = await countOverlappingForRoom(room.id, checkIn, checkOut);
      if (taken + delGrupo > room.capacity) {
        return reply.status(409).send({
          error: `El cuarto ${room.name} no tiene capacidad disponible en esas fechas (${taken}/${room.capacity} ocupado).`,
          code: "ROOM_AT_CAPACITY",
        });
      }
    }

    // Hospedaje: precio por día según peso × noches, POR mascota.
    const diffMs = checkOut.getTime() - checkIn.getTime();
    const totalDays = Math.ceil(diffMs / 86_400_000);
    const pricingConfig = await getLodgingPricing(prisma);
    const lodgingByPet = groupPets.map(
      (p) => pricePerDayForWeight(p.weight, pricingConfig) * totalDays,
    );

    // Baño como complemento del hospedaje (opcional): variante por mascota.
    let stayBathVariants: { id: string; price: number }[] | null = null;
    if (bath) {
      const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
      if (!bathType) {
        return reply.status(500).send({ error: "Servicio de baño no configurado" });
      }
      stayBathVariants = [];
      for (const p of groupPets) {
        const size = sizeFromWeight(p.weight ?? 0);
        const variant = await prisma.serviceVariant.findUnique({
          where: {
            serviceTypeId_petSize_deslanado_corte: {
              serviceTypeId: bathType.id,
              petSize: size,
              deslanado: bath.deslanado,
              corte: bath.corte,
            },
          },
        });
        if (!variant || !variant.isActive) {
          return reply
            .status(400)
            .send({ error: `Variante de baño no disponible para ${p.name}` });
        }
        stayBathVariants.push({ id: variant.id, price: Number(variant.price) });
      }
    }

    // Monto por fila: total manual repartido, o el cálculo automático por
    // mascota (hospedaje + recargo de medicamento +10% + baño). El fee de
    // domicilio va SOLO en la primera fila del grupo.
    const amounts =
      totalAmountOverride != null
        ? splitGroupTotal(totalAmountOverride, groupPets.length)
        : lodgingByPet.map((lodging, i) => {
            const medicationSurcharge = trimmedMedication ? lodging * 0.1 : 0;
            const bathPrice = stayBathVariants?.[i]?.price ?? 0;
            return lodging + medicationSurcharge + bathPrice;
          });
    const deposits = splitDeposit(
      amounts.map((a, i) => a + (i === 0 ? deliveryFee : 0)),
    );

    const reservations = await prisma.$transaction(async (tx) => {
      const created: CreatedReservation[] = [];
      for (let i = 0; i < groupPets.length; i++) {
        const isFirst = i === 0;
        const res = await tx.reservation.create({
          data: {
            checkIn,
            checkOut,
            checkInTime: checkInTime ?? null,
            checkOutTime: checkOutTime ?? null,
            totalDays,
            totalAmount: new Prisma.Decimal(amounts[i]).add(
              isFirst ? deliveryFee : 0,
            ),
            // Desglose del cobro original (solo cuando el precio salió del
            // cálculo automático; con total manual no hay desglose que contar).
            ...(totalAmountOverride == null
              ? {
                  lodgingAmount: new Prisma.Decimal(lodgingByPet[i]),
                  ...(trimmedMedication
                    ? {
                        medicationFee: new Prisma.Decimal(
                          (lodgingByPet[i] * 0.1).toFixed(2),
                        ),
                      }
                    : {}),
                }
              : {}),
            notes,
            internalNotes: internalNotes ?? null,
            legalAccepted,
            status: "CONFIRMED",
            groupId,
            ownerId,
            petId: groupPets[i].id,
            roomId: roomIdByPet[i],
            ...rowExtraData(isFirst, deposits?.[i]),
          },
          include: { pet: true, room: true },
        });
        if (stayBathVariants) {
          await tx.reservationAddon.create({
            data: {
              reservationId: res.id,
              variantId: stayBathVariants[i].id,
              unitPrice: new Prisma.Decimal(stayBathVariants[i].price),
              paidWith: "BOOKING",
            },
          });
        }
        created.push(res);
      }
      return created;
    });
    return sendCreated(reservations);
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
      // La hora de llegada ya no tiene sentido después del check-in; la de
      // recogida se puede indicar hasta antes del check-out.
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

      const data = {
        ...(checkInTime !== undefined ? { checkInTime } : {}),
        ...(checkOutTime !== undefined ? { checkOutTime } : {}),
      };

      await prisma.reservation.updateMany({
        where: reservation.groupId
          ? { groupId: reservation.groupId, ownerId: reservation.ownerId }
          : { id: reservation.id },
        data,
      });

      const updated = await prisma.reservation.findUnique({
        where: { id: reservation.id },
      });
      return updated;
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

      const updated = await prisma.reservation.update({
        where: { id: request.params.id },
        data: { status: parsed.data.status },
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
      // ANTI-REPLAY: el PI debe pertenecer al mismo dueño que reserva (create-intent
      // guarda ownerId en metadata). Evita reusar el PI de otra cuenta/booking.
      if (paymentIntent.metadata?.ownerId && paymentIntent.metadata.ownerId !== ownerId) {
        return reply.status(403).send({ error: "El pago no corresponde a esta cuenta" });
      }
      creditApplied = Number(paymentIntent.metadata?.creditApplied ?? 0);
      discountTotal = Number(paymentIntent.metadata?.discountTotal ?? 0);
      discountCodeId = paymentIntent.metadata?.discountCodeId || null;
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

    const diffMs = checkOut.getTime() - checkIn.getTime();
    const totalDays = Math.ceil(diffMs / 86_400_000);
    const groupId = petIds.length > 1 ? randomUUID() : null;
    const pricingConfig = await getLodgingPricing(prisma);

    // Determine sizes
    const petSizes = pets.map((p) => ({
      pet: p,
      size: sizeFromWeight(p.weight ?? 0),
      pricePerDay: pricePerDayForWeight(p.weight, pricingConfig),
    }));

    // Find rooms
    const assignments: { petId: string; roomId: string | null; amount: number }[] = [];

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
        return reply.status(400).send({
          error: `No hay cuartos con capacidad para ${petSizes.length} perros (tamaño ${largestSize}) en las fechas seleccionadas`,
        });
      }
      for (const ps of petSizes) {
        assignments.push({
          petId: ps.pet.id,
          roomId: room.id,
          amount: ps.pricePerDay * totalDays,
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
          return reply.status(400).send({
            error: `No hay cuartos disponibles para ${ps.pet.name} (tamaño ${ps.size}) en las fechas seleccionadas`,
          });
        }
        assignments.push({
          petId: ps.pet.id,
          roomId: chosen.id,
          amount: ps.pricePerDay * totalDays,
        });
      }
    }

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

    // Medication: validate notes present per-pet, compute +10% surcharge on lodging
    const medicationSurchargeByPet = new Map<string, number>();
    const medicationNotesByPet = new Map<string, string>();
    if (medicationByPet && Object.keys(medicationByPet).length > 0) {
      for (const [petId, sel] of Object.entries(medicationByPet)) {
        const trimmed = sel?.notes?.trim() ?? "";
        if (trimmed.length === 0) {
          return reply.status(400).send({
            error: "Las instrucciones de administración del medicamento son obligatorias",
          });
        }
        const a = assignments.find((x) => x.petId === petId);
        if (!a) continue;
        medicationSurchargeByPet.set(petId, a.amount * 0.10);
        medicationNotesByPet.set(petId, trimmed);
      }
    }

    // Create all reservations + payments in a transaction
    const lodgingTotal = assignments.reduce((sum, a) => sum + a.amount, 0);
    const bathTotal = Array.from(bathByPet.values()).reduce((s, b) => s + b.price, 0);
    const medicationTotal = Array.from(medicationSurchargeByPet.values()).reduce((s, n) => s + n, 0);
    const baseTotal = lodgingTotal + bathTotal + medicationTotal;

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
    const discountedBase = baseTotal - discountTotal;

    // Same-day surcharge: OWNER booking < 24h before check-in pays +20%
    const hoursUntilCheckIn = (checkIn.getTime() - Date.now()) / (60 * 60 * 1000);
    const sameDaySurcharge = owner.role === "OWNER" && hoursUntilCheckIn < 24;
    const surchargeMultiplier = sameDaySurcharge ? 1.20 : 1;

    // Servicio a domicilio — fee RE-CALCULADA server-side desde lat/lng (igual
    // que en /payments/create-intent). Costo logístico fijo: NO lleva el
    // recargo mismo-día, pero SÍ entra en la base del anticipo. En grupos
    // multi-mascota se cobra UNA sola vez (se adjunta a la primera reserva).
    let deliveryFee = 0;
    let deliveryDistanceKm = 0;
    let deliveryActive = false;
    if (homeDelivery && Number.isFinite(homeDelivery.lat) && Number.isFinite(homeDelivery.lng)) {
      const quote = await quoteDelivery(prisma, homeDelivery.lat, homeDelivery.lng);
      if (quote.active) {
        deliveryActive = true;
        deliveryFee = quote.fee;
        deliveryDistanceKm = quote.distanceKm;
      }
    }

    const grandTotal = discountedBase * surchargeMultiplier + deliveryFee;

    // Credit-only path: owner's saldo covers the deposit/total and no Stripe
    // charge was created. Recompute creditApplied here so we register the
    // payment as CREDIT (not STRIPE) and decrement the user's balance.
    if (creditOnly) {
      const amountDue = paymentType === "DEPOSIT"
        ? Math.ceil(grandTotal * 0.20)
        : grandTotal;
      const ownerCredit = Number(owner.creditBalance || 0);
      creditApplied = Math.min(ownerCredit, amountDue);
    }

    // Reserva + pago + addon de baño + descuento de saldo en UNA transacción
    // interactiva: si algo falla a mitad, NADA se persiste (no quedan reservas
    // sin su registro de pago, ni saldo descontado sin reserva). Las
    // notificaciones (push) y lecturas auxiliares van DESPUÉS del commit.
    const isDeposit = paymentType === "DEPOSIT";
    const reservations = await prisma.$transaction(async (tx) => {
      const created: Prisma.ReservationGetPayload<{
        include: { pet: true; room: true };
      }>[] = [];
      // Reparto del descuento del booking entre las reservas (proporcional a la
      // base de cada una); la última fila absorbe el redondeo para que la suma
      // de discountTotal sea exactamente el descuento total.
      let allocatedDiscount = 0;

      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        const bath = bathByPet.get(a.petId);
        const medSurcharge = medicationSurchargeByPet.get(a.petId) ?? 0;
        const medNotes = medicationNotesByPet.get(a.petId) ?? null;
        // La fee de domicilio se adjunta SOLO a la primera reserva del grupo
        // (un viaje cubre a todas las mascotas del mismo dueño).
        const isFirst = i === 0;
        const deliveryForThis = isFirst && deliveryActive ? deliveryFee : 0;
        const rowBase = a.amount + (bath?.price ?? 0) + medSurcharge;
        const isLast = i === assignments.length - 1;
        const rowDiscount =
          discountTotal <= 0 || baseTotal <= 0
            ? 0
            : isLast
              ? Math.max(0, Number((discountTotal - allocatedDiscount).toFixed(2)))
              : Number(((discountTotal * rowBase) / baseTotal).toFixed(2));
        allocatedDiscount += rowDiscount;
        const reservationAmount =
          (rowBase - rowDiscount) * surchargeMultiplier + deliveryForThis;

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
            lodgingAmount: new Prisma.Decimal(a.amount),
            ...(medSurcharge > 0
              ? { medicationFee: new Prisma.Decimal(medSurcharge.toFixed(2)) }
              : {}),
            ...(sameDaySurcharge
              ? {
                  sameDayFee: new Prisma.Decimal(
                    ((rowBase - rowDiscount) * 0.2).toFixed(2),
                  ),
                }
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
                }
              : {}),
          },
          include: { pet: true, room: true },
        });
        created.push(res);

        const paidAmount = isDeposit
          ? new Prisma.Decimal(Number(res.totalAmount) * 0.20)
          : res.totalAmount;
        const payment = await tx.payment.create({
          data: {
            amount: paidAmount,
            // CREDIT when no Stripe charge was created (saldo a favor cubrió todo).
            method: creditOnly ? "CREDIT" : "STRIPE",
            status: isDeposit ? "PARTIAL" : "PAID",
            stripePaymentIntentId: i === 0 && !creditOnly ? stripePaymentIntentId : null,
            paidAt: new Date(),
            notes: isDeposit
              ? (creditOnly ? "Anticipo 20% (saldo a favor)" : "Anticipo 20%")
              : (creditOnly ? "Pago con saldo a favor" : null),
            reservationId: res.id,
            userId: ownerId,
          },
        });

        // Persist bath addon attached to this reservation's payment
        if (bath) {
          await tx.reservationAddon.create({
            data: {
              reservationId: res.id,
              variantId: bath.variantId,
              unitPrice: new Prisma.Decimal(bath.price),
              paidWith: "BOOKING",
              paymentId: payment.id,
            },
          });
        }
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
      return checklists;
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

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED" },
      });

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
