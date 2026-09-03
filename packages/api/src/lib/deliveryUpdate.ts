import { Prisma } from "@holidoginn/db";
import type { PrismaClient } from "@holidoginn/db";
import type { UpdateReservationDelivery } from "@holidoginn/shared";
import { notifyUser, notifyTeamReservationUpdated } from "./notify";
import { quoteDelivery } from "./delivery";
import { opFail as fail, opOk as ok, type OpResult } from "./reservationAdminOps";

/**
 * Servicio a domicilio de una reserva YA creada (agregar, cambiar o quitar).
 *
 * Extraída de `PATCH /reservations/:id/delivery` (routes/reservations.ts) para
 * que la compartan esa ruta —dueño y equipo, desde la app— y
 * `PATCH /internal/reservations/:id/delivery` (admin web). Antes el panel
 * escribía las columnas `homeDelivery*` directo en Supabase: no recotizaba, no
 * movía el `totalAmount`, no respetaba la regla de "un solo domicilio por
 * grupo" y no avisaba ni al dueño ni al equipo.
 *
 * La tarifa la recotiza SIEMPRE el servidor salvo que el panel mande
 * `feeOverride` (tarifa pactada a mano: un viaje fuera de zona, un precio
 * cerrado con el cliente). El delta se aplica al total y se cobra al recoger:
 * aquí nunca se cobra en línea.
 */

/** La reserva tal como la lee el handler, para que el llamador autorice. */
export type DeliveryReservationRow = { id: string; ownerId: string; petId: string };

export type DeliveryUpdateInput = UpdateReservationDelivery & {
  /**
   * Tarifa manual (solo equipo/panel). Pisa la cotización por distancia; la
   * cortesía le gana (un viaje regalado cuesta 0 aunque se pacte otra cifra).
   */
  feeOverride?: number;
};

export type DeliveryUpdateResult = {
  success: true;
  /** Cuánto se movió el total (+ agregar, − quitar). */
  delta: number;
  newTotal: number;
  /** Cuánto quedó pagado de más tras el cambio (0 si no sobra). */
  overpaid: number;
  /** Tarifa vigente tras el cambio (0 si se quitó o es cortesía). */
  fee: number;
  isCourtesy: boolean;
};

export async function applyDeliveryUpdate(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    input: DeliveryUpdateInput;
    /** El equipo puede tocarlo con la estancia en curso y regalar el viaje. */
    isStaffOrAdmin: boolean;
    actorUserId: string | null;
    /** Se llama con la reserva ya leída; `false` ⇒ 403. Sin callback, pasa. */
    authorize?: (reservation: DeliveryReservationRow) => Promise<boolean> | boolean;
  }
): Promise<OpResult<DeliveryUpdateResult>> {
  const { input, isStaffOrAdmin } = params;

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: { pet: { select: { name: true } }, payments: true },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");

  if (params.authorize && !(await params.authorize(reservation))) {
    return fail(403, "No autorizado", "FORBIDDEN");
  }
  if (reservation.status === "CANCELLED" || reservation.status === "CHECKED_OUT") {
    return fail(400, "La reserva ya no se puede modificar", "NOT_ACTIVE");
  }
  // El equipo puede ajustarlo con la estancia en curso; el dueño solo antes de
  // que su mascota llegue.
  if (!isStaffOrAdmin && reservation.status !== "CONFIRMED") {
    return fail(
      400,
      "El domicilio solo se puede cambiar antes del check-in",
      "NOT_CONFIRMED"
    );
  }
  // Aquí siempre se mueve el total: mismo criterio que el PATCH de precio.
  const pendingChange = await prisma.reservationChangeRequest.findFirst({
    where: { reservationId: reservation.id, status: "PENDING" },
  });
  if (pendingChange) {
    return fail(
      409,
      "Hay una solicitud de cambio pendiente en esta reserva. Resuélvela antes de tocar el total.",
      "PENDING_CHANGE_REQUEST"
    );
  }

  const oldFee = reservation.homeDelivery ? Number(reservation.homeDeliveryFee ?? 0) : 0;
  let deliveryData: Prisma.ReservationUpdateInput;
  let newFee = 0;
  let address = "";
  let isCourtesy = false;

  if (input.enable) {
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
        return fail(
          409,
          `El domicilio de este grupo está en la reserva de ${sibling.pet.name}; edítalo desde ahí.`,
          "DELIVERY_ON_SIBLING",
          { siblingReservationId: sibling.id }
        );
      }
    }

    const trip = input.trip ?? "PICKUP";
    const quote = await quoteDelivery(prisma, input.lat, input.lng, trip);
    // Con tarifa manual el servicio puede estar apagado y aun así registrarse
    // (es un viaje pactado aparte); sin ella, apagado = no se puede cotizar.
    // Solo el equipo pacta una tarifa a mano; si la mandara el dueño, se ignora.
    const feeOverride =
      input.feeOverride != null && isStaffOrAdmin
        ? Number(input.feeOverride.toFixed(2))
        : null;
    if (!quote.active && feeOverride == null) {
      return fail(
        400,
        "El servicio a domicilio no está disponible por ahora",
        "DELIVERY_INACTIVE"
      );
    }
    // Regalar el viaje es decisión del equipo: si la bandera viene del dueño se
    // ignora. Se guarda como tarifa 0 —el viaje queda registrado en la reserva
    // pero no entra al total— igual que un add-on de cortesía.
    isCourtesy = !!input.isCourtesy && isStaffOrAdmin;
    newFee = isCourtesy ? 0 : feeOverride ?? quote.fee;
    address = input.address;
    deliveryData = {
      homeDelivery: true,
      homeDeliveryAddress: input.address,
      homeDeliveryDistanceKm: quote.active ? quote.distanceKm : null,
      homeDeliveryFee: new Prisma.Decimal(newFee),
      homeDeliveryTrip: trip,
    };
  } else {
    if (!reservation.homeDelivery) {
      return fail(400, "La reserva no tiene servicio a domicilio", "NO_DELIVERY");
    }
    deliveryData = {
      homeDelivery: false,
      homeDeliveryAddress: null,
      homeDeliveryDistanceKm: null,
      homeDeliveryFee: null,
    };
  }

  // Al quitar se descuenta la tarifa GUARDADA, no una recotización: se devuelve
  // exactamente lo que se cobró, aunque los precios hayan cambiado.
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
        title: input.enable ? "Servicio a domicilio agregado 🚗" : "Servicio a domicilio retirado",
        body: input.enable
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
      body: input.enable
        ? `Se agregó servicio a domicilio${isCourtesy ? " de CORTESÍA" : ` ($${newFee})`} — ${address}.`
        : `Se quitó el servicio a domicilio (−$${oldFee}).`,
      actorUserId: params.actorUserId,
      assignedStaffId: reservation.staffId,
    });
  } catch (err) {
    console.error("[delivery] avisos fallaron:", err);
  }

  return ok({ success: true as const, delta, newTotal, overpaid, fee: newFee, isCourtesy });
}
