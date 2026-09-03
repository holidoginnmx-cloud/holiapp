import { Prisma } from "@holidoginn/db";
import type { PrismaClient, ReservationStatus } from "@holidoginn/db";
import type { AdminCreateAddon, AdminUpdateReservation } from "@holidoginn/shared";
import {
  notifyUser,
  notifyUsers,
  notifyPetAudience,
  notifyTeamReservationUpdated,
} from "./notify";
import { petAudienceIds } from "./petAccess";
import {
  getLodgingPricing,
  computeChangeTotal,
  sizeFromWeight,
  dewormSizeFromWeight,
  allocateProportional,
  type ChangeTotalResult,
} from "./pricing";
import { planRefund, processRefund } from "./refund";

/**
 * Operaciones de administración de una reservación, extraídas de los handlers
 * de `routes/admin.ts` para que las llamen DOS entradas sin duplicar reglas:
 *
 *   · `/admin/*`     — la app del equipo (Clerk).
 *   · `/internal/*`  — el admin web (server-to-server con `x-cron-secret`),
 *                      ver routes/internalReservations.ts.
 *
 * Antes el panel web escribía directo en `reservations`/`payments`/
 * `reservation_addons` sin nada de esto: cancelaba sin reembolsar ni avisar,
 * movía fechas sin recalcular el desglose, tocaba una sola fila del grupo y
 * no mandaba ninguna notificación.
 *
 * Todas devuelven `OpResult`: la ruta solo traduce a HTTP. Los mensajes son
 * para el usuario (en español) y `code` es para que la UI decida.
 */

export type OpError = {
  ok: false;
  status: number;
  error: string;
  code?: string;
  extra?: Record<string, unknown>;
};
export type OpResult<T> = { ok: true; data: T } | OpError;

const fail = (
  status: number,
  error: string,
  code?: string,
  extra?: Record<string, unknown>
): OpError => ({ ok: false, status, error, code, extra });
const ok = <T>(data: T): OpResult<T> => ({ ok: true, data });

/**
 * Los mismos helpers para los libs hermanos que también devuelven `OpResult`
 * (deliveryUpdate.ts, daycareSchedule.ts). Se exportan con prefijo porque `ok`
 * a secas colisiona con el discriminante del propio tipo.
 */
export { fail as opFail, ok as opOk };

/** Quién ejecuta la operación (para atribuir y para no auto-notificarse). */
export type OpActor = {
  userId: string | null;
  /** Solo un admin toca dinero: precio manual, cortesía, reabrir. */
  isAdmin: boolean;
};

const money = (n: number) => n.toLocaleString("es-MX");

/** "Molly" · "Molly y Bailey" · "Molly, Bailey y Loki". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Audiencia del CLIENTE de varias filas (dueño + co-dueños de cada mascota), sin repetir. */
async function audienceOfRows(
  prisma: PrismaClient,
  rows: Array<{ petId: string; ownerId: string }>
): Promise<string[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const id of await petAudienceIds(prisma, r.petId, r.ownerId)) ids.add(id);
  }
  return [...ids];
}

// ── Reparto de montos en grupos multi-mascota ────────────────────────────────
// `splitGroupTotal` es copia de la función local (no exportada) de
// routes/reservations.ts; cuando se pueda, el handler debe importarla de aquí.

/** Reparte un total del grupo en partes iguales; la primera absorbe el residuo. */
export function splitGroupTotal(total: number, n: number): number[] {
  if (n <= 1) return [Number(total.toFixed(2))];
  const share = Math.floor((total / n) * 100) / 100;
  const first = Number((total - share * (n - 1)).toFixed(2));
  return [first, ...Array<number>(n - 1).fill(share)];
}

/**
 * Reparte un monto en proporción a los pesos (la última absorbe el residuo).
 * Es la misma `allocateProportional` de shared que usan create-intent y
 * POST /reservations para el anticipo y el descuento; aquí solo cambia el nombre.
 */
export const splitProportional = allocateProportional;

// ═════════════════════════════════════════════════════════════════════════════
//  Asignaciones
// ═════════════════════════════════════════════════════════════════════════════

export async function assignStaff(
  prisma: PrismaClient,
  params: { reservationId: string; staffId: string }
) {
  const { reservationId, staffId } = params;
  if (!staffId) return fail(400, "staffId requerido", "VALIDATION");

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { pet: { select: { name: true } } },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");

  const staffUser = await prisma.user.findUnique({ where: { id: staffId } });
  if (!staffUser || staffUser.role !== "STAFF") {
    return fail(400, "Usuario no es staff válido", "INVALID_STAFF");
  }

  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: { staffId },
    include: { staff: { select: { firstName: true, lastName: true } } },
  });

  await notifyUser(prisma, {
    userId: staffId,
    type: "STAFF_ASSIGNED",
    title: `Te asignaron a ${reservation.pet.name}`,
    body: `El admin te asignó como responsable de la estancia de ${reservation.pet.name}.`,
    data: { reservationId: reservation.id },
  });

  return ok(updated);
}

export async function assignRoom(
  prisma: PrismaClient,
  params: { reservationId: string; roomId: string }
) {
  const { reservationId, roomId } = params;
  if (!roomId) return fail(400, "roomId requerido", "VALIDATION");

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.reservationType !== "STAY" || !reservation.checkIn || !reservation.checkOut) {
    return fail(400, "Solo se pueden asignar cuartos a hospedajes", "NOT_A_STAY");
  }

  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || !room.isActive) return fail(400, "Cuarto no disponible", "ROOM_UNAVAILABLE");

  const taken = await prisma.reservation.count({
    where: {
      reservationType: "STAY",
      roomId,
      id: { not: reservation.id },
      status: { notIn: ["CANCELLED", "CHECKED_OUT"] as ReservationStatus[] },
      AND: [{ checkIn: { lt: reservation.checkOut } }, { checkOut: { gt: reservation.checkIn } }],
    },
  });
  if (taken + 1 > room.capacity) {
    return fail(
      409,
      `Cuarto ${room.name} sin capacidad en esas fechas (${taken}/${room.capacity} ocupado).`,
      "ROOM_AT_CAPACITY"
    );
  }

  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: { roomId },
    include: { room: true },
  });
  return ok(updated);
}

// ═════════════════════════════════════════════════════════════════════════════
//  Cambio de fechas (por DELTA de hospedaje, ver computeChangeTotal)
// ═════════════════════════════════════════════════════════════════════════════

export type DatesScope = "single" | "group";

type DatesRow = Prisma.ReservationGetPayload<{ include: { pet: true } }>;

export type DatesPreview = {
  newTotalDays: number;
  /** Sumas de las filas afectadas (una sola en scope "single"). */
  newTotal: number;
  currentTotal: number;
  delta: number;
  perReservation: Array<{
    reservationId: string;
    petName: string;
    currentTotal: number;
    newTotal: number;
    delta: number;
  }>;
};

export type DatesChangePlan = {
  reservation: DatesRow;
  rows: Array<{ row: DatesRow; change: ChangeTotalResult }>;
  preview: DatesPreview;
};

const ACTIVE: ReservationStatus[] = ["CONFIRMED", "CHECKED_IN"];

/**
 * Calcula el cambio sin escribir nada. El nuevo total se obtiene por DELTA
 * del hospedaje (noches × tarifa + recargo de medicamento) sobre el total
 * actual, así se preservan add-ons, domicilio y descuentos que ya están
 * dentro de `totalAmount`. Con scope "group" se recalcula CADA fila del grupo
 * (cada mascota tiene su peso y su desglose).
 */
export async function previewDatesChange(
  prisma: PrismaClient,
  params: { reservationId: string; newCheckIn: Date; newCheckOut: Date; scope: DatesScope }
): Promise<OpResult<DatesChangePlan>> {
  const { reservationId, newCheckIn, newCheckOut, scope } = params;
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { pet: true },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.reservationType !== "STAY" || !reservation.checkIn || !reservation.checkOut) {
    return fail(400, "Solo se pueden modificar fechas de hospedajes", "NOT_A_STAY");
  }
  if (!ACTIVE.includes(reservation.status)) {
    return fail(400, "Solo se pueden modificar reservas confirmadas o activas", "NOT_ACTIVE");
  }
  if (Number.isNaN(newCheckIn.getTime()) || Number.isNaN(newCheckOut.getTime())) {
    return fail(400, "Fechas inválidas", "VALIDATION");
  }
  if (newCheckOut <= newCheckIn) {
    return fail(400, "La fecha de salida debe ser posterior a la entrada", "VALIDATION");
  }

  const rows: DatesRow[] =
    scope === "group" && reservation.groupId
      ? (
          await prisma.reservation.findMany({
            where: { groupId: reservation.groupId, ownerId: reservation.ownerId },
            include: { pet: true },
            orderBy: { createdAt: "asc" },
          })
        ).filter(
          (r) => r.reservationType === "STAY" && r.checkIn && r.checkOut && ACTIVE.includes(r.status)
        )
      : [reservation];

  const config = await getLodgingPricing(prisma);
  const planned = rows.map((row) => ({
    row,
    change: computeChangeTotal({
      petWeightKg: row.pet.weight,
      currentCheckIn: row.checkIn!,
      currentCheckOut: row.checkOut!,
      newCheckIn,
      newCheckOut,
      hasMedication: !!row.medicationNotes,
      currentTotal: Number(row.totalAmount),
      currentLodgingAmount: row.lodgingAmount != null ? Number(row.lodgingAmount) : null,
      currentMedicationFee: row.medicationFee != null ? Number(row.medicationFee) : null,
      config,
    }),
  }));

  const currentTotal = Number(
    planned.reduce((s, p) => s + Number(p.row.totalAmount), 0).toFixed(2)
  );
  const newTotal = Number(planned.reduce((s, p) => s + p.change.newTotal, 0).toFixed(2));
  const preview: DatesPreview = {
    newTotalDays: planned[0]?.change.newTotalDays ?? 0,
    newTotal,
    currentTotal,
    delta: Number((newTotal - currentTotal).toFixed(2)),
    perReservation: planned.map((p) => ({
      reservationId: p.row.id,
      petName: p.row.pet.name,
      currentTotal: Number(p.row.totalAmount),
      newTotal: p.change.newTotal,
      delta: p.change.delta,
    })),
  };
  return ok({ reservation, rows: planned, preview });
}

export async function applyDatesChange(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    newCheckIn: Date;
    newCheckOut: Date;
    scope: DatesScope;
    actor: OpActor;
  }
): Promise<OpResult<{ success: true } & DatesPreview>> {
  const planned = await previewDatesChange(prisma, params);
  if (!planned.ok) return planned;
  const { reservation, rows, preview } = planned.data;
  const { newCheckIn, newCheckOut } = params;
  const ids = rows.map((r) => r.row.id);

  // Si el cliente tiene una solicitud de cambio pendiente, procesarla primero
  // evita pisar los montos que ella ya calculó.
  const pendingCR = await prisma.reservationChangeRequest.findFirst({
    where: { reservationId: { in: ids }, status: "PENDING" },
  });
  if (pendingCR) {
    return fail(
      409,
      "El cliente tiene una solicitud de cambio pendiente. Apruébala o recházala antes de modificar las fechas.",
      "PENDING_CHANGE_REQUEST"
    );
  }

  // Capacidad de cada cuarto asignado en las nuevas fechas: lo ocupado por
  // OTRAS reservas + las filas del grupo que van a ese cuarto.
  const roomIds = [...new Set(rows.map((r) => r.row.roomId).filter((x): x is string => !!x))];
  for (const roomId of roomIds) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) continue;
    const delGrupo = rows.filter((r) => r.row.roomId === roomId).length;
    const taken = await prisma.reservation.count({
      where: {
        reservationType: "STAY",
        roomId,
        id: { notIn: ids },
        status: { notIn: ["CANCELLED", "CHECKED_OUT"] as ReservationStatus[] },
        AND: [{ checkIn: { lt: newCheckOut } }, { checkOut: { gt: newCheckIn } }],
      },
    });
    if (taken + delGrupo > room.capacity) {
      return fail(
        409,
        `Cuarto ${room.name} sin capacidad en las nuevas fechas (${taken}/${room.capacity} ocupado).`,
        "ROOM_AT_CAPACITY"
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const { row, change } of rows) {
      await tx.reservation.update({
        where: { id: row.id },
        data: {
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          totalDays: change.newTotalDays,
          totalAmount: new Prisma.Decimal(change.newTotal),
          // El desglose persistido sigue a las noches: si la reserva nació con
          // desglose automático se actualiza; si fue total manual (null) se
          // queda null, no hay foto que corregir.
          ...(row.lodgingAmount != null
            ? { lodgingAmount: new Prisma.Decimal(change.newLodging) }
            : {}),
          ...(row.medicationFee != null
            ? { medicationFee: new Prisma.Decimal(change.newMedicationSurcharge) }
            : {}),
          depositDeadline: row.paymentType === "DEPOSIT" ? newCheckIn : row.depositDeadline,
        },
      });
    }
  });

  // Las fechas se guardan como día UTC; formatear en UTC evita el
  // corrimiento de un día.
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  const range = `${fmtDay(newCheckIn)} al ${fmtDay(newCheckOut)}`;
  const nightsLabel = `${preview.newTotalDays} ${preview.newTotalDays === 1 ? "noche" : "noches"}`;
  const names = joinNames(rows.map((r) => r.row.pet.name));

  const audience = await audienceOfRows(
    prisma,
    rows.map((r) => ({ petId: r.row.petId, ownerId: r.row.ownerId }))
  );
  await notifyUsers(prisma, audience, {
    type: "GENERAL",
    title: "Fechas de estadía actualizadas 📅",
    body: `La estadía de ${names} ahora es del ${range} (${nightsLabel}). Nuevo total: $${money(preview.newTotal)}.`,
    data: { reservationId: reservation.id },
  });
  await notifyTeamReservationUpdated(prisma, {
    reservationId: reservation.id,
    petName: names,
    body: `Se movió la estadía al ${range} (${nightsLabel}). Nuevo total: $${money(preview.newTotal)}.`,
    actorUserId: params.actor.userId,
    assignedStaffId: reservation.staffId,
  });

  return ok({ success: true as const, ...preview });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Precio, notas y anticipo acordado
// ═════════════════════════════════════════════════════════════════════════════

export async function updateReservationBasics(
  prisma: PrismaClient,
  params: { reservationId: string; input: AdminUpdateReservation; actor: OpActor }
): Promise<
  OpResult<{
    success: true;
    totalAmount: number;
    previousTotal: number;
    delta: number;
    overpaid: number;
  }>
> {
  const { totalAmount, internalNotes, notes, depositAgreed, priceChangeReason } = params.input;

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: { pet: { select: { name: true } }, payments: true },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");

  // A DIFERENCIA del cambio de fechas (que exige CONFIRMED/CHECKED_IN), aquí
  // se permite CHECKED_OUT a propósito: el equipo cobra o corrige días
  // después de la salida.
  if (reservation.status === "CANCELLED") {
    return fail(400, "No se puede editar una reserva cancelada", "CANCELLED");
  }

  // Solo cuando se toca el DINERO: la solicitud de cambio del cliente trae sus
  // propios montos y pisarlos descuadra.
  if (totalAmount !== undefined) {
    const pendingCR = await prisma.reservationChangeRequest.findFirst({
      where: { reservationId: reservation.id, status: "PENDING" },
    });
    if (pendingCR) {
      return fail(
        409,
        "El cliente tiene una solicitud de cambio pendiente. Apruébala o recházala antes de cambiar el precio.",
        "PENDING_CHANGE_REQUEST"
      );
    }
  }

  const previousTotal = Number(reservation.totalAmount);
  await prisma.reservation.update({
    where: { id: reservation.id },
    data: {
      ...(totalAmount !== undefined ? { totalAmount: new Prisma.Decimal(totalAmount) } : {}),
      ...(internalNotes !== undefined ? { internalNotes } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(depositAgreed !== undefined
        ? { depositAgreed: depositAgreed === null ? null : new Prisma.Decimal(depositAgreed) }
        : {}),
    },
  });

  const newTotal = totalAmount ?? previousTotal;
  const delta = newTotal - previousTotal;
  const totalChanged = Math.abs(delta) > 0.01;

  // Bajar el total por debajo de lo cobrado NO se rechaza (es justo el caso
  // "olvidé el descuento"): se reporta para que la UI avise del saldo a favor.
  const totalPaid = reservation.payments
    .filter((p) => p.status === "PAID" || p.status === "PARTIAL")
    .reduce((s, p) => s + Number(p.amount), 0);
  const overpaid = Math.max(0, Number((totalPaid - newTotal).toFixed(2)));

  if (totalChanged) {
    // Al dueño SOLO si el total bajó; una corrección al alza se habla con él.
    if (delta < 0) {
      const motivo = priceChangeReason ? ` (${priceChangeReason})` : "";
      await notifyPetAudience(
        prisma,
        { petId: reservation.petId, ownerId: reservation.ownerId },
        {
          type: "GENERAL",
          title: "Ajustamos el total de tu reserva 💛",
          body: `El total de ${reservation.pet.name} bajó a $${money(newTotal)}${motivo}.`,
          data: { reservationId: reservation.id },
        }
      );
    }
    const signo = delta > 0 ? "subió" : "bajó";
    const motivo = priceChangeReason ? ` — ${priceChangeReason}` : "";
    await notifyTeamReservationUpdated(prisma, {
      reservationId: reservation.id,
      petName: reservation.pet.name,
      body: `El total ${signo} a $${money(newTotal)}${motivo}.`,
      actorUserId: params.actor.userId,
      assignedStaffId: reservation.staffId,
    });
  } else {
    await notifyTeamReservationUpdated(prisma, {
      reservationId: reservation.id,
      petName: reservation.pet.name,
      body: "Se actualizaron las notas de la reserva.",
      actorUserId: params.actor.userId,
      assignedStaffId: reservation.staffId,
    });
  }

  return ok({
    success: true as const,
    totalAmount: newTotal,
    previousTotal,
    delta: Number(delta.toFixed(2)),
    overpaid,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Add-ons (baño, desparasitante, horas extra)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Cuánto aporta un add-on al total de la reserva.
 *
 * NO se multiplica por `quantity`: pese al nombre, `unitPrice` guarda el monto
 * TOTAL del add-on y `quantity` es solo el dato de cuántas unidades lo componen
 * (en EXTRA_HOURS, el nº de horas). Cero si es cortesía: ahí `unitPrice`
 * conserva el precio de catálogo para saber cuánto se regaló, pero no se cobra.
 */
export function addonContribution(addon: {
  unitPrice: Prisma.Decimal | number;
  isCourtesy: boolean;
}): number {
  if (addon.isCourtesy) return 0;
  return Number(addon.unitPrice);
}

export type AddonServiceCode = "BATH" | "DEWORMING" | "EXTRA_HOURS";

export type AddAddonInput = Omit<AdminCreateAddon, "variantId"> & {
  /** Variante explícita del catálogo… */
  variantId?: string;
  /** …o el servicio, y la variante se resuelve por el peso de la mascota. */
  serviceCode?: AddonServiceCode;
  deslanado?: boolean;
  corte?: boolean;
};

/** Resuelve la variante del catálogo a partir del servicio + peso de la mascota. */
async function resolveVariantForService(
  prisma: PrismaClient,
  input: { serviceCode: AddonServiceCode; deslanado?: boolean; corte?: boolean },
  pet: { name: string; weight: number | null }
): Promise<OpResult<{ id: string }>> {
  if (input.serviceCode === "BATH") {
    const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
    if (!bathType) return fail(500, "Servicio de baño no configurado", "SERVICE_MISSING");
    const variant = await prisma.serviceVariant.findUnique({
      where: {
        serviceTypeId_petSize_deslanado_corte: {
          serviceTypeId: bathType.id,
          petSize: sizeFromWeight(pet.weight ?? 0),
          deslanado: input.deslanado ?? false,
          corte: input.corte ?? false,
        },
      },
    });
    if (!variant || !variant.isActive) {
      return fail(400, `Variante de baño no disponible para ${pet.name}`, "VARIANT_UNAVAILABLE");
    }
    return ok({ id: variant.id });
  }
  if (input.serviceCode === "DEWORMING") {
    const petSize = dewormSizeFromWeight(pet.weight);
    if (!petSize) {
      return fail(
        400,
        `${pet.name} no tiene un peso registrado que permita cotizar el desparasitante`,
        "PET_WEIGHT_REQUIRED"
      );
    }
    const variant = await prisma.serviceVariant.findFirst({
      where: {
        petSize,
        deslanado: false,
        corte: false,
        isActive: true,
        serviceType: { code: "DEWORMING", isActive: true },
      },
    });
    if (!variant) {
      return fail(400, "No hay desparasitante configurado para esa talla", "VARIANT_UNAVAILABLE");
    }
    return ok({ id: variant.id });
  }
  const variant = await prisma.serviceVariant.findFirst({
    where: { isActive: true, serviceType: { code: "EXTRA_HOURS" } },
  });
  if (!variant) {
    return fail(400, "El servicio de horas extra no está configurado", "VARIANT_UNAVAILABLE");
  }
  return ok({ id: variant.id });
}

/**
 * Suma un servicio a una reserva que ya existe, sin pasar por Stripe. El
 * precio es autoridad del servidor (catálogo, o horas × tarifa en EXTRA_HOURS);
 * el override y la cortesía son decisión de admin.
 */
export async function addReservationAddon(
  prisma: PrismaClient,
  params: { reservationId: string; input: AddAddonInput; actor: OpActor }
) {
  const { input, actor } = params;
  const {
    quantity,
    unitPriceOverride,
    isCourtesy,
    courtesyReason,
    internalNote,
    scheduledAt,
    addToTotal,
  } = input;

  // `addToTotal: false` deja el servicio fuera del cobro igual que una
  // cortesía, así que va en el mismo candado.
  if (!actor.isAdmin && (unitPriceOverride != null || isCourtesy === true || addToTotal === false)) {
    return fail(
      403,
      "Solo un administrador puede cambiar el precio o marcarlo como cortesía",
      "ADMIN_ONLY"
    );
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: {
      pet: { select: { name: true, weight: true } },
      addons: { include: { variant: { include: { serviceType: true } } } },
    },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.status === "CANCELLED") {
    return fail(400, "No se puede agregar un servicio a una reserva cancelada", "CANCELLED");
  }

  let variantId = input.variantId;
  if (!variantId) {
    if (!input.serviceCode) {
      return fail(400, "Indica variantId o serviceCode", "VALIDATION");
    }
    const resolved = await resolveVariantForService(
      prisma,
      { serviceCode: input.serviceCode, deslanado: input.deslanado, corte: input.corte },
      reservation.pet
    );
    if (!resolved.ok) return resolved;
    variantId = resolved.data.id;
  }

  const variant = await prisma.serviceVariant.findUnique({
    where: { id: variantId },
    include: { serviceType: true },
  });
  if (!variant) return fail(404, "Variante no encontrada", "VARIANT_NOT_FOUND");

  // Un segundo baño COBRADO casi siempre es un doble clic; uno de cortesía
  // sobre uno pagado es un caso real (el baño salió mal, se repone gratis).
  if (variant.serviceType.code === "BATH" && !isCourtesy) {
    const yaTieneBano = reservation.addons.some(
      (a) => a.variant.serviceType.code === "BATH" && !a.isCourtesy
    );
    if (yaTieneBano) {
      return fail(409, "Esta reservación ya tiene un baño contratado", "BATH_ALREADY_ADDED");
    }
  }

  let unitPrice =
    !isCourtesy && unitPriceOverride != null ? unitPriceOverride : Number(variant.price);

  // Horas extra: la variante del catálogo es un ancla a $0 (solo satisface el
  // FK); el precio real es horas × la tarifa de Config → Tarifas.
  if (variant.serviceType.code === "EXTRA_HOURS") {
    if (!quantity || quantity < 1 || quantity > 24) {
      return fail(400, "Indica cuántas horas extra (1 a 24)", "VALIDATION");
    }
    if (isCourtesy || unitPriceOverride == null) {
      const pricing = await prisma.lodgingPricing.findFirst();
      const tarifa = Number(pricing?.daycareExtraHourPrice ?? 0);
      if (tarifa <= 0) {
        return fail(
          400,
          "Configura la tarifa de hora extra en Config → Tarifas antes de cobrarla",
          "EXTRA_HOUR_RATE_MISSING"
        );
      }
      unitPrice = Number((tarifa * quantity).toFixed(2));
    }
  }

  // `unitPrice` ya es el monto total del add-on (ver addonContribution).
  const contribution = isCourtesy || !addToTotal ? 0 : unitPrice;

  const result = await prisma.$transaction(async (tx) => {
    const addon = await tx.reservationAddon.create({
      data: {
        reservationId: reservation.id,
        variantId: variant.id,
        unitPrice: new Prisma.Decimal(unitPrice),
        quantity: quantity ?? null,
        // Cortesía sigue siendo BOOKING: se agenda y se ejecuta con la reserva.
        // `paidWith` dice CÓMO se pagó, no SI se pagó.
        paidWith: isCourtesy || addToTotal ? "BOOKING" : "STANDALONE",
        durationMinutes: variant.durationMinutes ?? null,
        scheduledAt: scheduledAt ?? null,
        internalNote: internalNote ?? null,
        isCourtesy,
        ...(isCourtesy
          ? {
              courtesyReason: courtesyReason ?? null,
              courtesySetById: actor.userId ?? null,
              courtesySetAt: new Date(),
            }
          : {}),
      },
      include: { variant: { include: { serviceType: true } } },
    });

    let newTotal = Number(reservation.totalAmount);
    if (contribution > 0) {
      newTotal = Number((newTotal + contribution).toFixed(2));
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { totalAmount: new Prisma.Decimal(newTotal) },
      });
    }
    return { addon, newTotal };
  });

  const etiqueta = isCourtesy ? " de CORTESÍA" : "";
  const detalleHoras =
    variant.serviceType.code === "EXTRA_HOURS" && quantity ? ` (${quantity} h)` : "";
  await notifyTeamReservationUpdated(prisma, {
    reservationId: reservation.id,
    petName: reservation.pet.name,
    body: `Se agregó ${variant.serviceType.name}${detalleHoras}${etiqueta} a la reserva.`,
    actorUserId: actor.userId,
    assignedStaffId: reservation.staffId,
  });

  return ok({
    success: true as const,
    addon: result.addon,
    totalAmount: result.newTotal,
    addedToTotal: contribution,
  });
}

/**
 * Quita un add-on y descuenta del total lo que había sumado. Un add-on que ya
 * tiene dinero encima (cobrado aparte, extras pagados) no se borra: la reversa
 * es un reembolso, no un DELETE.
 */
export async function removeReservationAddon(
  prisma: PrismaClient,
  params: { reservationId: string; addonId: string; actor: OpActor }
) {
  const addon = await prisma.reservationAddon.findUnique({
    where: { id: params.addonId },
    include: {
      variant: { include: { serviceType: true } },
      reservation: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          staffId: true,
          pet: { select: { name: true } },
        },
      },
    },
  });
  // El addon tiene que ser DE esta reserva: un id suelto no debe poder borrar
  // el add-on de cualquier otra.
  if (!addon || addon.reservation.id !== params.reservationId) {
    return fail(404, "Servicio no encontrado", "NOT_FOUND");
  }
  if (addon.reservation.status === "CANCELLED") {
    return fail(400, "No se puede editar un servicio de una reserva cancelada", "CANCELLED");
  }
  if (
    addon.paymentId ||
    addon.extraPaidAt ||
    addon.extraStripePaymentIntentId ||
    addon.extraPaymentStatus === "PAID"
  ) {
    return fail(
      409,
      "Este servicio ya tiene un cobro registrado y no se puede eliminar. Si fue un error, reembólsalo.",
      "ADDON_HAS_PAYMENT"
    );
  }

  // Solo se ajusta el total de los add-ons que SÍ estaban dentro de él; uno
  // STANDALONE se cobró aparte y nunca sumó.
  const delta = addon.paidWith === "BOOKING" ? -addonContribution(addon) : 0;

  const newTotal = await prisma.$transaction(async (tx) => {
    await tx.reservationAddon.delete({ where: { id: addon.id } });
    let total = Number(addon.reservation.totalAmount);
    if (delta !== 0) {
      total = Math.max(0, Number((total + delta).toFixed(2)));
      await tx.reservation.update({
        where: { id: addon.reservation.id },
        data: { totalAmount: new Prisma.Decimal(total) },
      });
    }
    return total;
  });

  await notifyTeamReservationUpdated(prisma, {
    reservationId: addon.reservation.id,
    petName: addon.reservation.pet.name,
    body: `Se quitó ${addon.variant.serviceType.name} de la reserva${
      delta !== 0 ? ` (total ahora $${money(newTotal)})` : ""
    }.`,
    actorUserId: params.actor.userId,
    assignedStaffId: addon.reservation.staffId,
  });

  return ok({ success: true as const, totalAmount: newTotal, delta: Number(delta.toFixed(2)) });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Cancelación (grupo completo) con reembolso
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Qué hacer con el dinero al cancelar:
 *   STRIPE_REFUND — a la tarjeta lo que la tarjeta pagó; el resto a saldo.
 *   CREDIT        — todo como saldo a favor.
 *   NONE          — sin reembolso (ya se resolvió en mostrador, no-show…).
 *   ASK_CLIENT    — cancelar y que el cliente elija en la app (lo que hace
 *                   hoy `/admin/reservations/:id/cancel`).
 */
export type CancelRefundChoice = "STRIPE_REFUND" | "CREDIT" | "NONE" | "ASK_CLIENT";

export type CancelRowInput = {
  id: string;
  petName: string;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    status: string;
    stripePaymentIntentId: string | null;
    /** Para elegir el PI del grupo (el más antiguo); null = sin fecha, va al final. */
    paidAt?: Date | null;
  }>;
};

/**
 * Lo que se hará con el dinero de UNA fila. Es `CancelRefundChoice` más
 * `ALREADY_REFUNDED`, que no se puede pedir: lo decide el plan cuando la fila
 * ya tiene un renglón REFUNDED (su dinero ya salió en un intento anterior).
 */
export type CancelRowChoice = CancelRefundChoice | "ALREADY_REFUNDED";

export type CancelRowPlan = {
  reservationId: string;
  petName: string;
  paid: number;
  /** Lo que ya se había devuelto ANTES de esta llamada (renglones REFUNDED). */
  alreadyRefunded: number;
  /** Lo que de verdad se hará con ESTA fila. */
  effectiveChoice: CancelRowChoice;
  toStripe: number;
  toCredit: number;
};

export type GroupCancellationPlan =
  | { ok: true; rows: CancelRowPlan[]; totalPaid: number; groupPaymentIntentId: string | null }
  | { ok: false; error: string; code: string };

/**
 * Reparto del reembolso entre las filas de un grupo. Pura (sin Stripe ni
 * base) para poder probarla.
 *
 * Regla por fila: a la tarjeta solo vuelve lo que la tarjeta pagó (ver
 * planRefund). Con STRIPE_REFUND, una fila hermana pagada en efectivo cae a
 * saldo a favor en vez de tumbar toda la cancelación; si NINGUNA fila tiene
 * cargo de tarjeta, no hay a dónde devolver y se pide elegir saldo.
 *
 * REINTENTO TRAS UN FALLO PARCIAL. Una fila que ya tiene renglón REFUNDED no
 * bloquea al grupo: se marca `ALREADY_REFUNDED` (su dinero ya salió) y se
 * cancela sin volver a tocar Stripe ni el saldo. Antes se abortaba el grupo
 * entero con 409 ALREADY_REFUNDED — incluso con CREDIT y con NONE — así que si
 * el reembolso de la primera mascota salía y el de la segunda fallaba, quedaba
 * dinero devuelto, reservas vivas ocupando cuarto y ninguna salida salvo SQL a
 * mano. `ALREADY_REFUNDED` ahora solo impide un SEGUNDO reembolso de la MISMA
 * fila, nunca la cancelación.
 *
 * Basta UN renglón REFUNDED para considerar la fila resuelta: `processRefund`
 * rechaza cualquier reserva que ya tenga uno, así que reintentarla no
 * devolvería el faltante, solo tumbaría la cancelación otra vez.
 */
export function planGroupCancellation(
  rows: CancelRowInput[],
  refundChoice: CancelRefundChoice
): GroupCancellationPlan {
  const paidOf = (r: CancelRowInput) =>
    r.payments.filter((p) => p.status === "PAID" || p.status === "PARTIAL");
  const refundedOf = (r: CancelRowInput) => r.payments.filter((p) => p.status === "REFUNDED");

  // Multi-mascota: el PI cuelga de la primera fila; las hermanas tienen pagos
  // STRIPE sin PI. El PI del booking es el MÁS ANTIGUO por `paidAt` del grupo
  // (una hermana pudo liquidar su saldo después con OTRO PI, que no cobró a
  // esta fila) — el mismo criterio que usa `processRefund` con su
  // `orderBy: { paidAt: "asc" }`. Sin fecha va al final, como los NULLs en
  // Postgres.
  const alFinal = Number.POSITIVE_INFINITY;
  const groupPaymentIntentId =
    rows
      .flatMap((r) => paidOf(r))
      .filter((p) => p.method === "STRIPE" && !!p.stripePaymentIntentId)
      .sort((a, b) => (a.paidAt?.getTime() ?? alFinal) - (b.paidAt?.getTime() ?? alFinal))[0]
      ?.stripePaymentIntentId ?? null;

  const planned: CancelRowPlan[] = rows.map((r) => {
    const paid = paidOf(r).map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      stripePaymentIntentId: p.stripePaymentIntentId,
    }));
    const total = Number(paid.reduce((s, p) => s + p.amount, 0).toFixed(2));
    const yaDevuelto = Number(
      refundedOf(r)
        .reduce((s, p) => s + p.amount, 0)
        .toFixed(2)
    );
    const base = { reservationId: r.id, petName: r.petName, paid: total, alreadyRefunded: yaDevuelto };

    if (refundedOf(r).length > 0) {
      return { ...base, effectiveChoice: "ALREADY_REFUNDED" as const, toStripe: 0, toCredit: 0 };
    }
    if (total <= 0 || refundChoice === "NONE") {
      return { ...base, effectiveChoice: "NONE" as const, toStripe: 0, toCredit: 0 };
    }
    if (refundChoice === "ASK_CLIENT") {
      return { ...base, effectiveChoice: "ASK_CLIENT" as const, toStripe: 0, toCredit: 0 };
    }
    if (refundChoice === "CREDIT") {
      return { ...base, effectiveChoice: "CREDIT" as const, toStripe: 0, toCredit: total };
    }
    const plan = planRefund(paid, "STRIPE_REFUND", groupPaymentIntentId);
    if (plan.toStripe.length === 0) {
      return { ...base, effectiveChoice: "CREDIT" as const, toStripe: 0, toCredit: total };
    }
    return {
      ...base,
      effectiveChoice: "STRIPE_REFUND" as const,
      toStripe: Number(plan.toStripe.reduce((s, x) => s + x.amount, 0).toFixed(2)),
      toCredit: plan.toCredit,
    };
  });

  const totalPaid = Number(planned.reduce((s, p) => s + p.paid, 0).toFixed(2));
  // El candado de "no hay a dónde devolver" mira SOLO lo que falta por
  // reembolsar, y NO aplica en un reintento: si la fila con tarjeta ya se
  // reembolsó, lo que queda es a fuerza saldo a favor y mantener el 409 aquí
  // dejaría el grupo atorado justo en el escenario que este arreglo destraba.
  const pendientes = planned.filter((p) => p.effectiveChoice !== "ALREADY_REFUNDED");
  const pendingPaid = Number(pendientes.reduce((s, p) => s + p.paid, 0).toFixed(2));
  const hayFilasYaResueltas = planned.length > pendientes.length;
  if (
    refundChoice === "STRIPE_REFUND" &&
    !hayFilasYaResueltas &&
    pendingPaid > 0 &&
    !pendientes.some((p) => p.toStripe > 0)
  ) {
    return {
      ok: false,
      error: "El pago original no fue con tarjeta; elige saldo a favor",
      code: "NO_CARD_PAYMENT",
    };
  }
  return { ok: true, rows: planned, totalPaid, groupPaymentIntentId };
}

/**
 * Qué pasó de verdad con el dinero de una fila EN ESTA llamada. Es lo que
 * necesita el operador para saber qué reintentar cuando Stripe tumba el
 * reembolso a medio grupo: viaja tanto en la respuesta OK como en el `extra`
 * del 409 REFUND_FAILED.
 */
export type CancelRowOutcome = CancelRowPlan & {
  /** Se reembolsó AHORA (no en un intento anterior). */
  refunded: boolean;
  /** Ya traía renglón REFUNDED de antes: no se volvió a tocar. */
  wasAlreadyRefunded: boolean;
  refundedToCard: number;
  creditedToBalance: number;
  /** Por qué falló el reembolso de ESTA fila (solo en el 409). */
  error?: string;
};

export type CancelResult = {
  success: true;
  reservationIds: string[];
  refundChoice: CancelRefundChoice;
  /** Suma de lo que se devolvió EN ESTA llamada (tarjeta + saldo). */
  refundAmount: number;
  refundedToCard: number;
  creditedToBalance: number;
  /** Hay dinero y se dejó la elección al cliente. */
  awaitingClientChoice: boolean;
  rows: CancelRowOutcome[];
};

/**
 * Cancela la reserva (o el grupo completo) y resuelve el reembolso.
 *
 * Orden: primero el dinero, luego el estado. Si Stripe rechaza un reembolso,
 * las filas quedan CONFIRMED y se puede reintentar: lo ya reembolsado NO se
 * pierde ni se vuelve a emitir (la fila queda `ALREADY_REFUNDED` en el plan, y
 * la llave de idempotencia de `processRefund` cubre el caso de un refund que sí
 * salió en Stripe pero no alcanzó a escribirse). El operador reintenta con la
 * misma elección o cierra con `NONE`; el 409 trae en `extra.rows` qué filas se
 * reembolsaron y cuáles no.
 */
export async function cancelReservations(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    refundChoice: CancelRefundChoice;
    scope: DatesScope;
    actor: OpActor;
    /**
     * Avisar al cliente y al equipo. Default `true`. `false` = captura de
     * historial (una reserva vieja que ya se canceló en su momento): se aplica
     * la cancelación y el dinero, pero no sale ningún push ni correo.
     */
    notify?: boolean;
  }
): Promise<OpResult<CancelResult>> {
  const notify = params.notify !== false;
  const anchor = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: { pet: { select: { name: true } } },
  });
  if (!anchor) return fail(404, "Reservación no encontrada", "NOT_FOUND");

  const candidates =
    params.scope === "group" && anchor.groupId
      ? await prisma.reservation.findMany({
          where: { groupId: anchor.groupId, ownerId: anchor.ownerId },
          include: {
            pet: { select: { name: true } },
            payments: { orderBy: { paidAt: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        })
      : await prisma.reservation.findMany({
          where: { id: anchor.id },
          include: {
            pet: { select: { name: true } },
            payments: { orderBy: { paidAt: "asc" } },
          },
        });

  // Una hermana ya cancelada no estorba; una hospedada o finalizada sí.
  const rows = candidates.filter((r) => r.status !== "CANCELLED");
  if (rows.length === 0) {
    return fail(400, "La reserva ya está cancelada", "ALREADY_CANCELLED");
  }
  const noConfirmada = rows.find((r) => r.status !== "CONFIRMED");
  if (noConfirmada) {
    const quien = rows.length > 1 ? ` (${noConfirmada.pet.name})` : "";
    return fail(400, `Solo se pueden cancelar reservas confirmadas${quien}`, "NOT_CONFIRMED");
  }

  const plan = planGroupCancellation(
    rows.map((r) => ({
      id: r.id,
      petName: r.pet.name,
      payments: r.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        status: p.status,
        stripePaymentIntentId: p.stripePaymentIntentId,
        paidAt: p.paidAt,
      })),
    })),
    params.refundChoice
  );
  if (!plan.ok) return fail(409, plan.error, plan.code);

  // 1) Dinero. `processRefund` avisa al dueño y manda el correo de cada fila
  //    (salvo con `notify: false`). Cada fila lleva su resultado a `outcomes`:
  //    si Stripe tumba una a medio grupo, el 409 dice exactamente qué se
  //    devolvió y qué no, para que el reintento no sea a ciegas.
  let refundedToCard = 0;
  let creditedToBalance = 0;
  const outcomes: CancelRowOutcome[] = plan.rows.map((row) => ({
    ...row,
    refunded: false,
    wasAlreadyRefunded: row.effectiveChoice === "ALREADY_REFUNDED",
    refundedToCard: 0,
    creditedToBalance: 0,
  }));
  for (const out of outcomes) {
    if (out.effectiveChoice !== "STRIPE_REFUND" && out.effectiveChoice !== "CREDIT") continue;
    try {
      const res = await processRefund(prisma, {
        reservationId: out.reservationId,
        refundChoice: out.effectiveChoice,
        notify,
      });
      refundedToCard += res.refundedToCard;
      creditedToBalance += res.creditedToBalance;
      out.refunded = true;
      out.refundedToCard = res.refundedToCard;
      out.creditedToBalance = res.creditedToBalance;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error procesando reembolso";
      out.error = message;
      return fail(409, `${message} (${out.petName})`, "REFUND_FAILED", {
        refundedToCard: Number(refundedToCard.toFixed(2)),
        creditedToBalance: Number(creditedToBalance.toFixed(2)),
        rows: outcomes,
      });
    }
  }

  // 2) Estado, todo el grupo de una vez.
  const ids = rows.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    await tx.reservation.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
    await tx.reservationChangeRequest.updateMany({
      where: { reservationId: { in: ids }, status: "PENDING" },
      data: { status: "CANCELLED", rejectionReason: "Reservación cancelada" },
    });
  });

  // 3) Avisos al cliente. Con ASK_CLIENT cada fila con dinero lleva su propio
  //    "elige cómo recibir tu reembolso" (la elección en la app es por
  //    reservación); el resto va en un solo aviso.
  const askRows = plan.rows.filter((p) => p.effectiveChoice === "ASK_CLIENT");
  for (const p of notify ? askRows : []) {
    const r = rows.find((x) => x.id === p.reservationId)!;
    await notifyPetAudience(
      prisma,
      { petId: r.petId, ownerId: r.ownerId },
      {
        type: "GENERAL",
        title: "Tu reserva fue cancelada",
        body: `Cancelamos la reserva de ${r.pet.name}. Toca para elegir cómo recibir tu reembolso de $${money(p.paid)}.`,
        data: { action: "CHOOSE_REFUND", reservationId: r.id, refundAmount: p.paid },
      }
    );
  }
  const plainRows = rows.filter((r) => !askRows.some((p) => p.reservationId === r.id));
  if (notify && plainRows.length > 0) {
    const audience = await audienceOfRows(
      prisma,
      plainRows.map((r) => ({ petId: r.petId, ownerId: r.ownerId }))
    );
    await notifyUsers(prisma, audience, {
      type: "GENERAL",
      title: "Tu reserva fue cancelada",
      body: `Cancelamos la reserva de ${joinNames(plainRows.map((r) => r.pet.name))}.`,
      data: { reservationId: plainRows[0].id },
    });
  }

  // 4) Aviso al resto del equipo (refresca el caché de sus teléfonos).
  const detalle =
    askRows.length > 0
      ? "el cliente elige cómo recibir su reembolso"
      : refundedToCard > 0 || creditedToBalance > 0
        ? [
            refundedToCard > 0 ? `$${money(refundedToCard)} a tarjeta` : null,
            creditedToBalance > 0 ? `$${money(creditedToBalance)} a saldo a favor` : null,
          ]
            .filter(Boolean)
            .join(" y ")
        : "sin reembolso";
  if (notify) {
    await notifyTeamReservationUpdated(prisma, {
      reservationId: anchor.id,
      petName: joinNames(rows.map((r) => r.pet.name)),
      body: `Se canceló la reserva (${detalle}).`,
      actorUserId: params.actor.userId,
      assignedStaffId: anchor.staffId,
    });
  }

  return ok({
    success: true as const,
    reservationIds: ids,
    refundChoice: params.refundChoice,
    refundAmount: Number((refundedToCard + creditedToBalance).toFixed(2)),
    refundedToCard: Number(refundedToCard.toFixed(2)),
    creditedToBalance: Number(creditedToBalance.toFixed(2)),
    awaitingClientChoice: notify && askRows.length > 0,
    rows: outcomes,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Cobro manual (efectivo / transferencia / tarjeta en terminal)
// ═════════════════════════════════════════════════════════════════════════════

export type ManualPaymentMethod = "CASH" | "TRANSFER" | "CARD";
export type ManualPaymentKind = "ANTICIPO" | "ABONO" | "RESTANTE" | "FULL";

export type RegisterPaymentInput = {
  amount: number;
  method: ManualPaymentMethod;
  /** Solo CARD: marca y recargo aplicado (snapshot, lo calcula el panel). */
  cardBrand?: string | null;
  cardFeePct?: number | null;
  cardFeeAmount?: number | null;
  notes?: string | null;
  reference?: string | null;
  /** Cuándo se cobró; por default ahora. */
  paidAt?: Date | null;
  /** Si no viene, se infiere: RESTANTE si liquida, ANTICIPO si es el primero, ABONO si no. */
  kind?: ManualPaymentKind | null;
};

/** Misma regla que `/admin/payments/manual` y que `inferirTipoPago` del admin web. */
export function inferPaymentKind(total: number, pagado: number, monto: number): ManualPaymentKind {
  if (monto <= 0 || total <= 0) return "ABONO";
  const saldo = Math.round((total - pagado) * 100) / 100;
  if (monto >= saldo) return "RESTANTE";
  if (pagado === 0) return "ANTICIPO";
  return "ABONO";
}

/**
 * Registra un cobro manual. `amount` SIEMPRE es el bruto que entregó el
 * cliente; el recargo de tarjeta va aparte en `cardFee*`. No se rechaza un
 * sobrepago (el ledger manda), se reporta como `overpaid`. Avisa al cliente
 * (PAYMENT_RECEIVED) como lo hace el cobro desde la app.
 */
export async function registerManualPayment(
  prisma: PrismaClient,
  params: { reservationId: string; input: RegisterPaymentInput; actor: OpActor }
) {
  const { input } = params;
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return fail(400, "El monto debe ser un número mayor a 0", "VALIDATION");
  }
  if (!["CASH", "TRANSFER", "CARD"].includes(input.method)) {
    return fail(400, "Método inválido", "VALIDATION");
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    include: {
      pet: { select: { name: true } },
      payments: { where: { status: { in: ["PAID", "PARTIAL"] } } },
    },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.status === "CANCELLED") {
    return fail(400, "La reservación está cancelada", "CANCELLED");
  }

  const total = Number(reservation.totalAmount);
  const pagado = reservation.payments.reduce((s, p) => s + Number(p.amount), 0);
  const amount = Number(input.amount.toFixed(2));
  const kind = input.kind ?? inferPaymentKind(total, pagado, amount);
  const esTarjeta = input.method === "CARD";

  const payment = await prisma.payment.create({
    data: {
      amount: new Prisma.Decimal(amount),
      method: input.method,
      status: "PAID",
      kind,
      paidAt: input.paidAt ?? new Date(),
      reservationId: reservation.id,
      userId: reservation.ownerId,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || `Pago manual (${input.method}) registrado por el equipo`,
      cardBrand: esTarjeta ? input.cardBrand ?? null : null,
      cardFeePct: esTarjeta && input.cardFeePct != null ? new Prisma.Decimal(input.cardFeePct) : null,
      cardFeeAmount:
        esTarjeta && input.cardFeeAmount != null ? new Prisma.Decimal(input.cardFeeAmount) : null,
    },
  });

  const balance = Number((total - pagado - amount).toFixed(2));

  // Saldo del grupo completo (lo que el cliente ve como "lo que debo").
  let groupBalance = balance;
  if (reservation.groupId) {
    const siblings = await prisma.reservation.findMany({
      where: { groupId: reservation.groupId, ownerId: reservation.ownerId, status: { not: "CANCELLED" } },
      select: { totalAmount: true, payments: { where: { status: { in: ["PAID", "PARTIAL"] } }, select: { amount: true } } },
    });
    groupBalance = Number(
      siblings
        .reduce((s, r) => s + Number(r.totalAmount) - r.payments.reduce((a, p) => a + Number(p.amount), 0), 0)
        .toFixed(2)
    );
  }

  const servicio =
    reservation.reservationType === "BATH"
      ? "el baño"
      : reservation.reservationType === "DAYCARE"
        ? "la guardería"
        : "la estancia";
  await notifyPetAudience(
    prisma,
    { petId: reservation.petId, ownerId: reservation.ownerId },
    {
      type: "PAYMENT_RECEIVED",
      title: "Pago recibido",
      body: `Recibimos $${money(amount)} de ${servicio} de ${reservation.pet.name}. ¡Gracias!`,
      data: { reservationId: reservation.id, kind: "STAY_PAID" },
    }
  );

  return ok({
    success: true as const,
    payment,
    kind,
    balance: Math.max(0, balance),
    groupBalance: Math.max(0, groupBalance),
    overpaid: Math.max(0, -balance),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Borrado (con los mismos candados que el admin web: lib/cobros-protegidos.ts)
// ═════════════════════════════════════════════════════════════════════════════

// Solo estos cargos de terminal tomaron (o pueden tomar) dinero.
const TERMINAL_STATUS_CON_DINERO = ["PENDING", "APPROVED"];

export const MSG_RESERVACION_CON_TARJETA =
  "Esta reservación tiene cobros con tarjeta (Stripe o terminal) y no se puede eliminar. Cancélala para que el cliente reciba su aviso y su reembolso o saldo a favor.";

/**
 * Borra una reservación (o todo su grupo) y sus hijos. Nunca si hay dinero de
 * Stripe o de la terminal: borrar la fila solo esconde el ingreso y deja al
 * cliente pagado sin registro; la reversa es la cancelación con reembolso.
 */
export async function deleteReservation(
  prisma: PrismaClient,
  params: { reservationId: string; includeGroup: boolean; actor: OpActor }
) {
  const anchor = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    select: { id: true, groupId: true, ownerId: true, staffId: true, pet: { select: { name: true } } },
  });
  if (!anchor) return fail(404, "Reservación no encontrada", "NOT_FOUND");

  let rows = [anchor];
  if (anchor.groupId) {
    const group = await prisma.reservation.findMany({
      where: { groupId: anchor.groupId },
      select: { id: true, groupId: true, ownerId: true, staffId: true, pet: { select: { name: true } } },
    });
    if (params.includeGroup) {
      rows = group;
    } else if (group.length > 1) {
      return fail(
        409,
        "Esta reservación es parte de un grupo de varias mascotas y no se puede eliminar sola: el cobro y el domicilio son del grupo completo. Elimina o cancela el grupo entero.",
        "GROUP_MEMBER"
      );
    }
  }
  const ids = rows.map((r) => r.id);

  const [stripeCount, terminalCount] = await Promise.all([
    prisma.payment.count({
      where: { reservationId: { in: ids }, stripePaymentIntentId: { not: null } },
    }),
    prisma.terminalCharge.count({
      where: { reservationId: { in: ids }, status: { in: TERMINAL_STATUS_CON_DINERO } },
    }),
  ]);
  if (stripeCount > 0 || terminalCount > 0) {
    return fail(409, MSG_RESERVACION_CON_TARJETA, "RESERVATION_HAS_CARD_MONEY", {
      stripe: stripeCount > 0,
      terminal: terminalCount > 0,
    });
  }

  const deletedPayments = await prisma.$transaction(async (tx) => {
    const where = { reservationId: { in: ids } };
    // Los add-ons referencian pagos y los pagos referencian la reserva
    // (Restrict): el orden importa.
    await tx.reservationAddon.deleteMany({ where });
    await tx.terminalCharge.deleteMany({ where });
    const pagos = await tx.payment.deleteMany({ where });
    await tx.stayUpdate.deleteMany({ where });
    await tx.dailyChecklist.deleteMany({ where });
    await tx.staffAlert.deleteMany({ where });
    await tx.review.deleteMany({ where });
    await tx.reservationChangeRequest.deleteMany({ where });
    await tx.reservation.deleteMany({ where: { id: { in: ids } } });
    return pagos.count;
  });

  await notifyTeamReservationUpdated(prisma, {
    reservationId: anchor.id,
    petName: joinNames(rows.map((r) => r.pet.name)),
    body: "Se eliminó la reserva.",
    actorUserId: params.actor.userId,
    assignedStaffId: anchor.staffId,
  });

  return ok({ success: true as const, deletedIds: ids, deletedPayments });
}

/**
 * Borra un pago manual. Nunca uno de Stripe (`stripePaymentIntentId`), de la
 * terminal (cargo PENDING/APPROVED ligado), de una venta de tienda ni una fila
 * REFUNDED (es el candado contra reembolsar dos veces).
 *
 * Dos reversas que antes NO se hacían y dejaban el dinero descuadrado:
 *
 *   · `method: "CREDIT"` — es saldo a favor del cliente que se aplicó a esta
 *     reserva (ver el `CREDIT_APPLIED` de POST /reservations). Borrar el
 *     renglón sin devolverlo le evaporaba el saldo: la reserva volvía a deber
 *     y el cliente perdía su dinero. Ahora regresa a `User.creditBalance` con
 *     su asiento en `creditLedger`, en la MISMA transacción que el borrado.
 *   · add-on ligado — antes solo se soltaba `paymentId` y el add-on quedaba
 *     `extraPaymentStatus: PAID` con `extraPaidAt` puesto: marcado como pagado
 *     sin pago que lo respalde. Ahora el extra vuelve a PENDING_PAYMENT (sigue
 *     habiendo un cargo por cobrar, solo que ya no está pagado) y se limpia
 *     `extraPaidAt`.
 */
export async function deletePayment(
  prisma: PrismaClient,
  params: { paymentId: string; actor: OpActor }
) {
  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    include: {
      terminalCharges: { where: { status: { in: TERMINAL_STATUS_CON_DINERO } }, select: { id: true } },
      reservation: { select: { ownerId: true, pet: { select: { name: true } } } },
    },
  });
  if (!payment) return fail(404, "Pago no encontrado", "NOT_FOUND");
  if (payment.orderId) {
    return fail(
      409,
      "Este ingreso es de una venta de la tienda. Bórralo desde la venta para que el inventario vuelva a su lugar.",
      "PAYMENT_IS_STORE_SALE"
    );
  }
  if (payment.stripePaymentIntentId) {
    return fail(
      409,
      "Este ingreso lo cobró Stripe y no se puede borrar. Si fue un error, se reembolsa desde la app o desde Stripe.",
      "PAYMENT_STRIPE"
    );
  }
  if (payment.terminalCharges.length > 0) {
    return fail(
      409,
      "Este ingreso lo cobró la terminal y no se puede borrar. Si fue un error, la devolución se hace desde la app o desde la terminal.",
      "PAYMENT_TERMINAL"
    );
  }
  if (payment.status === "REFUNDED") {
    return fail(
      409,
      "Este renglón es un reembolso y no se puede borrar: es el registro de que el dinero ya se devolvió.",
      "PAYMENT_IS_REFUND"
    );
  }

  // Saldo a favor a devolver. `userId` puede ser null en pagos legacy: cae al
  // dueño de la reserva. Sin ninguno de los dos no hay a quién acreditarle
  // nada y el borrado sigue (el pago igual no debería existir).
  const creditOwnerId = payment.userId ?? payment.reservation?.ownerId ?? null;
  const creditToReturn =
    payment.method === "CREDIT" && creditOwnerId ? Number(payment.amount) : 0;

  await prisma.$transaction(async (tx) => {
    // El status ANTES de soltar `paymentId`: después ya no hay por dónde
    // encontrar los add-ons.
    await tx.reservationAddon.updateMany({
      where: { paymentId: payment.id, extraPaymentStatus: "PAID" },
      data: { extraPaymentStatus: "PENDING_PAYMENT" },
    });
    await tx.reservationAddon.updateMany({
      where: { paymentId: payment.id },
      data: { paymentId: null, extraPaidAt: null },
    });
    await tx.payment.delete({ where: { id: payment.id } });
    if (creditToReturn > 0 && creditOwnerId) {
      const updatedUser = await tx.user.update({
        where: { id: creditOwnerId },
        data: {
          creditBalance: { increment: creditToReturn },
          lastCreditEntryAt: new Date(),
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: creditOwnerId,
          type: "CREDIT_ADDED",
          amount: creditToReturn,
          balanceAfter: Number(updatedUser.creditBalance),
          description: payment.reservation
            ? `Devolución de saldo: se borró el cobro aplicado a la reserva de ${payment.reservation.pet.name}`
            : "Devolución de saldo: se borró el cobro que lo aplicaba",
          reservationId: payment.reservationId,
        },
      });
    }
  });

  let balance: number | null = null;
  if (payment.reservationId) {
    const r = await prisma.reservation.findUnique({
      where: { id: payment.reservationId },
      select: {
        totalAmount: true,
        payments: { where: { status: { in: ["PAID", "PARTIAL"] } }, select: { amount: true } },
      },
    });
    if (r) {
      balance = Math.max(
        0,
        Number((Number(r.totalAmount) - r.payments.reduce((s, p) => s + Number(p.amount), 0)).toFixed(2))
      );
    }
  }

  return ok({
    success: true as const,
    reservationId: payment.reservationId,
    balance,
    /** Saldo a favor devuelto al cliente (0 si el pago no era CREDIT). */
    creditReturned: Number(creditToReturn.toFixed(2)),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Edición de un cobro MANUAL
// ═════════════════════════════════════════════════════════════════════════════

export type UpdatePaymentInput = {
  /** SIEMPRE bruto (lo que entregó el cliente); el recargo va en `cardFee*`. */
  amount?: number;
  method?: ManualPaymentMethod;
  paidAt?: Date | null;
  notes?: string | null;
  reference?: string | null;
  cardBrand?: string | null;
  cardFeePct?: number | null;
  cardFeeAmount?: number | null;
  kind?: ManualPaymentKind;
};

export type UpdatePaymentResult = {
  success: true;
  payment: Awaited<ReturnType<PrismaClient["payment"]["update"]>>;
  /** Saldo de LA reserva del pago tras la edición (0 si sobrepagada). */
  balance: number | null;
  /** Saldo del grupo multi-mascota completo (= balance si no hay grupo). */
  groupBalance: number | null;
  /** Cuánto quedó pagado de más (0 si no sobra). */
  overpaid: number;
};

/**
 * Corrige un renglón de cobro capturado a mano (se tecleó 1.200 en vez de 1.020,
 * era transferencia y no efectivo, la fecha quedó mal…).
 *
 * Los candados son EXACTAMENTE los de `deletePayment`: un pago que no capturó
 * el equipo no se edita a mano, porque su monto es el reflejo de dinero que ya
 * se movió en otro sistema y editarlo solo descuadra la conciliación.
 *   · Stripe   → el bruto lo manda el PaymentIntent (ver "Pago de Stripe
 *                editado a mano = neto": teclear el neto encima descuenta la
 *                comisión dos veces).
 *   · Terminal → el monto lo manda el cargo de Getnet.
 *   · Tienda   → el ingreso es de una venta; se edita desde la venta.
 *   · REFUNDED → es el registro de un reembolso ya hecho, no un cobro.
 *
 * `amount` es SIEMPRE el bruto. Como en `registerManualPayment` no se rechaza
 * un sobrepago: el ledger manda y se reporta en `overpaid`.
 */
export async function updatePayment(
  prisma: PrismaClient,
  params: { paymentId: string; input: UpdatePaymentInput; actor: OpActor }
): Promise<OpResult<UpdatePaymentResult>> {
  const { input } = params;

  if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount <= 0)) {
    return fail(400, "El monto debe ser un número mayor a 0", "VALIDATION");
  }
  if (input.method !== undefined && !["CASH", "TRANSFER", "CARD"].includes(input.method)) {
    return fail(400, "Método inválido", "VALIDATION");
  }

  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    include: {
      terminalCharges: {
        where: { status: { in: TERMINAL_STATUS_CON_DINERO } },
        select: { id: true },
      },
    },
  });
  if (!payment) return fail(404, "Pago no encontrado", "NOT_FOUND");
  if (payment.orderId) {
    return fail(
      409,
      "Este ingreso es de una venta de la tienda. Edítalo desde la venta para que el inventario y el cobro no se separen.",
      "PAYMENT_IS_STORE_SALE"
    );
  }
  if (payment.stripePaymentIntentId) {
    return fail(
      409,
      "Este ingreso lo cobró Stripe y no se puede editar. El monto es el que Stripe cobró; si fue un error, se reembolsa desde la app o desde Stripe.",
      "PAYMENT_STRIPE"
    );
  }
  if (payment.terminalCharges.length > 0) {
    return fail(
      409,
      "Este ingreso lo cobró la terminal y no se puede editar. Si fue un error, la devolución se hace desde la app o desde la terminal.",
      "PAYMENT_TERMINAL"
    );
  }
  if (payment.status === "REFUNDED") {
    return fail(
      409,
      "Este renglón es un reembolso y no se puede editar: es el registro de que el dinero ya se devolvió.",
      "PAYMENT_IS_REFUND"
    );
  }

  // El método EFECTIVO tras el PATCH decide si las columnas de tarjeta viven o
  // se limpian: un pago que deja de ser CARD no debe conservar marca ni
  // recargo, o el desglose seguiría cobrando una comisión que ya no existe.
  const method = input.method ?? payment.method;
  const esTarjeta = method === "CARD";
  const pickCard = <T>(nuevo: T | undefined, actual: T): T | null =>
    esTarjeta ? (nuevo !== undefined ? nuevo : actual) : null;

  const cardBrand = pickCard(input.cardBrand, payment.cardBrand);
  const cardFeePctRaw = pickCard(input.cardFeePct, payment.cardFeePct ? Number(payment.cardFeePct) : null);
  const cardFeeAmountRaw = pickCard(
    input.cardFeeAmount,
    payment.cardFeeAmount ? Number(payment.cardFeeAmount) : null
  );

  const amount = input.amount !== undefined ? Number(input.amount.toFixed(2)) : Number(payment.amount);

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      ...(input.amount !== undefined ? { amount: new Prisma.Decimal(amount) } : {}),
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.paidAt !== undefined ? { paidAt: input.paidAt } : {}),
      ...(input.reference !== undefined ? { reference: input.reference?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      cardBrand,
      cardFeePct: cardFeePctRaw != null ? new Prisma.Decimal(cardFeePctRaw) : null,
      cardFeeAmount: cardFeeAmountRaw != null ? new Prisma.Decimal(cardFeeAmountRaw) : null,
    },
  });

  // Estado de pago tras la edición: mismo cálculo que `registerManualPayment`,
  // pero leyendo el ledger COMPLETO (el pago editado ya está escrito).
  let balance: number | null = null;
  let groupBalance: number | null = null;
  let overpaid = 0;

  if (payment.reservationId) {
    const reservation = await prisma.reservation.findUnique({
      where: { id: payment.reservationId },
      select: {
        id: true,
        groupId: true,
        ownerId: true,
        staffId: true,
        totalAmount: true,
        pet: { select: { name: true } },
        payments: { where: { status: { in: ["PAID", "PARTIAL"] } }, select: { amount: true } },
      },
    });
    if (reservation) {
      const total = Number(reservation.totalAmount);
      const pagado = reservation.payments.reduce((s, p) => s + Number(p.amount), 0);
      const raw = Number((total - pagado).toFixed(2));
      balance = Math.max(0, raw);
      overpaid = Math.max(0, -raw);
      groupBalance = balance;

      if (reservation.groupId) {
        const siblings = await prisma.reservation.findMany({
          where: {
            groupId: reservation.groupId,
            ownerId: reservation.ownerId,
            status: { not: "CANCELLED" },
          },
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
                (s, r) =>
                  s + Number(r.totalAmount) - r.payments.reduce((a, p) => a + Number(p.amount), 0),
                0
              )
              .toFixed(2)
          )
        );
      }

      // Al EQUIPO, no al cliente: "Pago recibido" ya se mandó cuando se
      // registró; un aviso por la corrección solo confundiría al dueño.
      await notifyTeamReservationUpdated(prisma, {
        reservationId: reservation.id,
        petName: reservation.pet.name,
        body: `Se corrigió un cobro: $${money(amount)} (${method}). Saldo: $${money(balance)}.`,
        actorUserId: params.actor.userId,
        assignedStaffId: reservation.staffId,
      });
    }
  }

  return ok({ success: true as const, payment: updated, balance, groupBalance, overpaid });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Edición de un add-on ya agregado
// ═════════════════════════════════════════════════════════════════════════════

export type UpdateAddonInput = {
  /** Cambiar la variante del catálogo (p.ej. baño → baño con corte). */
  variantId?: string;
  /** TOTAL del add-on, no precio por unidad (ver `addonContribution`). */
  unitPrice?: number;
  isCourtesy?: boolean;
  courtesyReason?: string | null;
  internalNote?: string | null;
  scheduledAt?: Date | null;
  durationMinutes?: number | null;
  quantity?: number | null;
  /** Extras definidos por el staff tras el servicio (deslanado/corte). */
  extraPaymentStatus?: "PENDING_PAYMENT" | "PAY_ON_PICKUP" | "PAID" | null;
  extraPaidAt?: Date | null;
};

/**
 * Edita un add-on ya agregado y ajusta el total de la reserva por el DELTA.
 *
 * Extraída de `PATCH /admin/reservations/:id/addons/:addonId` para que la
 * compartan la app del equipo y el admin web: antes el panel tenía que
 * quitar el add-on y volver a agregarlo para cambiarle la variante o el
 * precio, lo que perdía el `scheduledAt`, la nota interna y la auditoría de
 * la cortesía, y fallaba con 409 en cuanto el add-on tenía un cobro encima.
 *
 * Precio efectivo tras el PATCH manda: si se cambian precio y cortesía a la
 * vez, el delta se calcula con el precio NUEVO. Cambiar `variantId` sin
 * mandar `unitPrice` reprecia desde el catálogo de la variante nueva (misma
 * semántica que quitar y volver a agregar); mandar `unitPrice` gana siempre.
 */
export async function updateReservationAddon(
  prisma: PrismaClient,
  params: { reservationId: string; addonId: string; input: UpdateAddonInput; actor: OpActor }
) {
  const { input, actor } = params;
  const { internalNote, isCourtesy, courtesyReason, scheduledAt } = input;

  // Mismo candado que `addReservationAddon`: solo un admin toca dinero.
  if (!actor.isAdmin && (input.unitPrice !== undefined || isCourtesy !== undefined)) {
    return fail(
      403,
      "Solo un administrador puede cambiar el precio o marcarlo como cortesía",
      "ADMIN_ONLY"
    );
  }

  const addon = await prisma.reservationAddon.findUnique({
    where: { id: params.addonId },
    include: {
      variant: { include: { serviceType: true } },
      reservation: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          ownerId: true,
          staffId: true,
          pet: { select: { name: true } },
        },
      },
    },
  });
  // El addon tiene que ser DE esta reserva: sin esta comprobación un id suelto
  // permitiría editar el add-on de cualquier otra.
  if (!addon || addon.reservation.id !== params.reservationId) {
    return fail(404, "Servicio no encontrado", "NOT_FOUND");
  }
  if (addon.reservation.status === "CANCELLED") {
    return fail(400, "No se puede editar un servicio de una reserva cancelada", "CANCELLED");
  }

  // Variante nueva: se valida y, si no vino precio, repone el de catálogo y su
  // duración (la variante es la que define cuánto dura y cuánto cuesta).
  let nuevaVariante: { id: string; price: Prisma.Decimal; durationMinutes: number | null } | null =
    null;
  if (input.variantId !== undefined && input.variantId !== addon.variantId) {
    const variant = await prisma.serviceVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true, price: true, durationMinutes: true, isActive: true },
    });
    if (!variant) return fail(404, "Variante no encontrada", "VARIANT_NOT_FOUND");
    if (!variant.isActive) {
      return fail(400, "Esa variante del catálogo ya no está disponible", "VARIANT_UNAVAILABLE");
    }
    nuevaVariante = variant;
  }

  const unitPrice =
    input.unitPrice !== undefined
      ? input.unitPrice
      : nuevaVariante
        ? Number(nuevaVariante.price)
        : undefined;

  // Delta del total por el toggle de cortesía y/o el precio. El precio
  // efectivo tras el PATCH manda.
  const efectivoUnit = unitPrice ?? Number(addon.unitPrice);
  const antes = addonContribution(addon);
  const despues = (isCourtesy ?? addon.isCourtesy) ? 0 : efectivoUnit;
  // Solo se ajusta el total de los add-ons que SÍ estaban dentro de él; uno
  // STANDALONE se cobró aparte y nunca sumó.
  const ajustaTotal = addon.paidWith === "BOOKING";
  const delta = ajustaTotal ? Number((despues - antes).toFixed(2)) : 0;

  const marcaCortesia = isCourtesy === true && !addon.isCourtesy;
  const quitaCortesia = isCourtesy === false && addon.isCourtesy;

  // `extraPaymentStatus: "PAID"` sella la fecha si no la mandaron: un extra
  // marcado como pagado sin `extraPaidAt` no aparece en ningún corte.
  const extraPaidAt =
    input.extraPaidAt !== undefined
      ? input.extraPaidAt
      : input.extraPaymentStatus === "PAID" && !addon.extraPaidAt
        ? new Date()
        : undefined;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.reservationAddon.update({
      where: { id: addon.id },
      data: {
        ...(nuevaVariante ? { variantId: nuevaVariante.id } : {}),
        ...(unitPrice !== undefined ? { unitPrice: new Prisma.Decimal(unitPrice) } : {}),
        ...(internalNote !== undefined ? { internalNote } : {}),
        ...(scheduledAt !== undefined ? { scheduledAt } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.durationMinutes !== undefined
          ? { durationMinutes: input.durationMinutes }
          : nuevaVariante
            ? { durationMinutes: nuevaVariante.durationMinutes }
            : {}),
        ...(input.extraPaymentStatus !== undefined
          ? { extraPaymentStatus: input.extraPaymentStatus }
          : {}),
        ...(extraPaidAt !== undefined ? { extraPaidAt } : {}),
        ...(isCourtesy !== undefined ? { isCourtesy } : {}),
        ...(courtesyReason !== undefined ? { courtesyReason } : {}),
        ...(marcaCortesia ? { courtesySetById: actor.userId ?? null, courtesySetAt: new Date() } : {}),
        // Al quitar la cortesía se limpia la auditoría: dejar el sello de quién
        // la puso en un add-on que ya se cobra confunde el reporte.
        ...(quitaCortesia
          ? { courtesyReason: null, courtesySetById: null, courtesySetAt: null }
          : {}),
      },
      include: { variant: { include: { serviceType: true } } },
    });

    let newTotal = Number(addon.reservation.totalAmount);
    if (delta !== 0) {
      newTotal = Math.max(0, Number((newTotal + delta).toFixed(2)));
      await tx.reservation.update({
        where: { id: addon.reservation.id },
        data: { totalAmount: new Prisma.Decimal(newTotal) },
      });
    }
    return { addon: updated, newTotal };
  });

  if (delta !== 0) {
    const signo = delta > 0 ? "subió" : "bajó";
    const motivo = marcaCortesia ? ` (${result.addon.variant.serviceType.name} de cortesía)` : "";
    await notifyTeamReservationUpdated(prisma, {
      reservationId: addon.reservation.id,
      petName: addon.reservation.pet.name,
      body: `El total ${signo} a $${money(result.newTotal)}${motivo}.`,
      actorUserId: actor.userId,
      assignedStaffId: addon.reservation.staffId,
    });
  }

  return ok({
    success: true as const,
    addon: result.addon,
    totalAmount: result.newTotal,
    delta,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  Cambio de mascota
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Corrige la mascota de una reserva capturada con el perro equivocado (dos
 * perros de la misma dueña, un walk-in tecleado a las prisas).
 *
 * Solo dentro de la MISMA cuenta: mover la reserva a la mascota de otra dueña
 * cambiaría de quién es el cobro, quién recibe los avisos y en qué expediente
 * queda la estancia — eso es una reserva nueva, no una corrección.
 *
 * Tampoco se toca una fila que vive en un grupo multi-mascota: ahí el precio,
 * el domicilio y el anticipo están repartidos entre las hermanas y cambiar una
 * mascota sola descuadraría el reparto.
 */
export async function changeReservationPet(
  prisma: PrismaClient,
  params: { reservationId: string; petId: string; actor: OpActor }
) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    select: {
      id: true,
      petId: true,
      ownerId: true,
      groupId: true,
      staffId: true,
      status: true,
      pet: { select: { name: true } },
    },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.status === "CANCELLED") {
    return fail(400, "No se puede cambiar la mascota de una reserva cancelada", "CANCELLED");
  }

  if (reservation.groupId) {
    const enGrupo = await prisma.reservation.count({ where: { groupId: reservation.groupId } });
    if (enGrupo > 1) {
      return fail(
        409,
        "Esta reservación es parte de un grupo de varias mascotas: el cobro y el domicilio son del grupo completo. Elimina el grupo y créalo de nuevo con las mascotas correctas.",
        "GROUP_MEMBER"
      );
    }
  }

  if (reservation.petId === params.petId) {
    return ok({
      success: true as const,
      reservationId: reservation.id,
      petId: reservation.petId,
      petName: reservation.pet.name,
      previousPetId: reservation.petId,
      previousPetName: reservation.pet.name,
      changed: false,
    });
  }

  const pet = await prisma.pet.findUnique({
    where: { id: params.petId },
    select: { id: true, name: true, ownerId: true, isActive: true },
  });
  if (!pet) return fail(404, "Mascota no encontrada", "PET_NOT_FOUND");
  // Dueña titular, no co-dueña: el pagador de la reserva es `ownerId` y no se
  // mueve aquí (ver la regla del pagador en `petAccess`).
  if (pet.ownerId !== reservation.ownerId) {
    return fail(
      400,
      "Esa mascota es de otra cuenta. Solo se puede cambiar por otra mascota de la misma dueña.",
      "PET_NOT_OWNED"
    );
  }

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: { petId: pet.id },
  });

  await notifyTeamReservationUpdated(prisma, {
    reservationId: reservation.id,
    petName: pet.name,
    body: `La reserva pasó de ${reservation.pet.name} a ${pet.name}.`,
    actorUserId: params.actor.userId,
    assignedStaffId: reservation.staffId,
  });

  return ok({
    success: true as const,
    reservationId: reservation.id,
    petId: pet.id,
    petName: pet.name,
    previousPetId: reservation.petId,
    previousPetName: reservation.pet.name,
    changed: true,
  });
}
