import type { Room } from "@holidoginn/shared";
import { apiFetch } from "./client";
import type { ReservationAddonWithVariant } from "./types";

// ─── Admin ──────────────────────────────────────────────

export interface AdminStats {
  checkedInCount: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  availableRooms: number;
  totalActiveRooms: number;
  monthRevenue: number;
  expiringVaccines: {
    id: string;
    name: string;
    expiresAt: string;
    petName: string;
    petId: string;
    ownerName: string;
  }[];
  staysWithoutUpdates: {
    reservationId: string;
    petName: string;
    ownerName: string;
    checkIn: string;
  }[];
}

export interface RoomOccupant {
  reservationId: string;
  pet: {
    id: string;
    name: string;
    breed: string | null;
    size: "XS" | "S" | "M" | "L" | "XL";
    photoUrl: string | null;
  };
  owner: { id: string; name: string };
  staff: { id: string; name: string } | null;
  checkIn: string;
  checkOut: string;
  // legacy
  petName: string;
  ownerName: string;
}

export interface RoomWithStatus extends Room {
  currentReservations: RoomOccupant[];
  /** @deprecated usar `currentReservations`; queda por compat hasta migrar UI vieja. */
  currentReservation: RoomOccupant | null;
}

export const getAdminStats = () =>
  apiFetch<AdminStats>("/admin/stats");

export const getAdminRoomStatus = () =>
  apiFetch<RoomWithStatus[]>("/admin/rooms/status");

export type AdminRevenueBreakdown = {
  monthStart: string;
  monthEnd: string;
  total: number;
  gross: number;
  refunded: number;
  byMethod: Record<string, number>;
  byCategory: { hotel: number; bath: number; store: number };
  payments: {
    id: string;
    amount: string;
    method: string;
    status: string;
    kind: "PAYMENT" | "REFUND";
    paidAt: string | null;
    createdAt: string;
    // true = importado del Excel/web histórico; false = registrado en la app.
    originLegacy: boolean;
    // El servidor puede agregar categorías nuevas (STORE llegó después): la
    // pantalla indexa CATEGORY_STYLE con un fallback, no con una unión cerrada.
    category: "HOTEL" | "BATH" | "MIXED" | "STORE" | (string & {});
    hotelAmount: number;
    bathAmount: number;
    // Venta de tienda: el pago cuelga de un pedido en vez de una reservación.
    order: { id: string; orderNumber: number; channel: "ONLINE" | "COUNTER" } | null;
    reservation: {
      id: string;
      reservationType: "STAY" | "BATH" | "DAYCARE";
      status: string;
      pet: { name: string };
      owner: { firstName: string; lastName: string };
    } | null;
  }[];
};

export const getAdminRevenueBreakdown = (month?: string) => {
  const qs = month ? `?month=${month}` : "";
  return apiFetch<AdminRevenueBreakdown>(`/admin/revenue/breakdown${qs}`);
};

// ─── Depósitos de Stripe (SPEI) ─────────────────────────
// Stripe junta varios cobros en un solo depósito al banco, y el SPEI llega sin
// referencia. Esto reconstruye de qué reservas venía cada transferencia.

export type PayoutSummary = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: string;
  lineCount: number;
  /** Mascotas/clientes representativos, para reconocerlo de un vistazo. */
  preview: string[];
};

export type PayoutLineMatch = {
  /**
   * `SIN_REGISTRAR`: se sabe de quién es por la metadata de Stripe, pero el
   * cobro NO existe como pago en la base — el dinero entró y la reserva figura
   * debiéndolo.
   */
  kind: "RESERVATION" | "STORE_ORDER" | "REFUND" | "SIN_REGISTRAR";
  paymentId: string | null;
  reservationId: string | null;
  orderId: string | null;
  orderNumber: number | null;
  petNames: string[];
  ownerName: string | null;
  serviceLabel: string;
  paidAt: string | null;
};

export type PayoutLine = {
  id: string;
  type: string;
  gross: number;
  fee: number;
  net: number;
  description: string | null;
  stripePaymentIntentId: string | null;
  /** null = la línea no cruzó con ninguna reserva ni pedido (ajuste de Stripe). */
  match: PayoutLineMatch | null;
};

export type PayoutBreakdown = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: string;
  stripeCreatedAt: string;
  syncedAt: string;
  failureMessage: string | null;
  totals: {
    gross: number;
    fees: number;
    net: number;
    matched: number;
    unmatched: number;
    /** Cobros identificados por metadata pero sin pago registrado. */
    sinRegistrar: number;
    /** Suma bruta de esos cobros: dinero que no está en los ingresos. */
    sinRegistrarMonto: number;
  };
  /** La suma de las líneas da exactamente el monto depositado. */
  cuadra: boolean;
  diferencia: number;
  lines: PayoutLine[];
};

/** `amount` filtra por el monto exacto que llegó al banco (tolerancia ±$0.01). */
export const getAdminPayouts = (opts: { limit?: number; amount?: string } = {}) => {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.amount) qs.set("amount", opts.amount);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<{ payouts: PayoutSummary[] }>(`/admin/payouts${suffix}`);
};

export const getAdminPayoutBreakdown = (payoutId: string) =>
  apiFetch<PayoutBreakdown>(`/admin/payouts/${payoutId}`);

export const syncAdminPayouts = (limit = 10) =>
  // `fallidos` son depósitos que ni se pudieron bajar de Stripe; `descuadrados`,
  // los que sí bajaron pero cuyo desglose no suma lo que llegó al banco. Son
  // cosas distintas y la pantalla tiene que poder decirlo.
  apiFetch<{ synced: number; descuadrados: string[]; fallidos: string[] }>("/admin/payouts/sync", {
    method: "POST",
    body: JSON.stringify({ limit }),
  });

/**
 * Cobros que Stripe depositó pero que nunca se registraron como pago: dinero
 * que entró al banco y que los ingresos no cuentan.
 */
export type CobroSinRegistrar = {
  lineId: string;
  payoutId: string;
  payoutArrivalDate: string;
  /** Bruto que pagó el cliente. */
  gross: number;
  fee: number;
  net: number;
  stripePaymentIntentId: string | null;
  /** null = la metadata no alcanzó para señalar una reserva concreta. */
  reservationId: string | null;
  petNames: string[];
  ownerName: string | null;
  serviceLabel: string;
};

export const getCobrosSinRegistrar = (limit = 30) =>
  apiFetch<{ cobros: CobroSinRegistrar[]; total: number }>(
    `/admin/payouts/sin-registrar?limit=${limit}`,
  );

/** Da de alta el cobro como pago de su reserva. Idempotente en el servidor. */
export const registrarCobroDeDeposito = (lineId: string, reservationId?: string) =>
  apiFetch<{
    paymentId: string;
    creado: boolean;
    reservationId: string;
    amount: number;
    fee: number;
  }>(`/admin/payouts/lines/${lineId}/register-payment`, {
    method: "POST",
    body: JSON.stringify(reservationId ? { reservationId } : {}),
  });

export type AdminAlert = {
  id: string;
  type: string;
  description: string;
  isResolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  pet: { id: string; name: string; photoUrl: string | null };
  reservation: {
    id: string;
    checkIn: string;
    checkOut: string;
    status: string;
    room: { name: string } | null;
    owner: { id: string; firstName: string; lastName: string };
  };
  staff: { id: string; firstName: string; lastName: string };
};

export const getAdminAlerts = (resolved = false) =>
  apiFetch<AdminAlert[]>(`/admin/alerts?resolved=${resolved}`);

export const resolveAdminAlert = (alertId: string) =>
  apiFetch<{ id: string }>(`/admin/alerts/${alertId}/resolve`, { method: "PATCH" });

export const adminAssignStaff = (reservationId: string, staffId: string) =>
  apiFetch(`/admin/reservations/${reservationId}/assign-staff`, {
    method: "PATCH",
    body: JSON.stringify({ staffId }),
  });

export const adminAssignRoom = (reservationId: string, roomId: string) =>
  apiFetch(`/admin/reservations/${reservationId}/assign-room`, {
    method: "PATCH",
    body: JSON.stringify({ roomId }),
  });

export type AdminDatesPreview = {
  newTotalDays: number;
  newTotal: number;
  currentTotal: number;
  delta: number;
};

export const adminPreviewReservationDates = (
  reservationId: string,
  data: { newCheckIn: string; newCheckOut: string }
) =>
  apiFetch<AdminDatesPreview>(
    `/admin/reservations/${reservationId}/dates/preview`,
    { method: "POST", body: JSON.stringify(data) }
  );

export const adminUpdateReservationDates = (
  reservationId: string,
  data: { newCheckIn: string; newCheckOut: string }
) =>
  apiFetch<{ success: boolean } & AdminDatesPreview>(
    `/admin/reservations/${reservationId}/dates`,
    { method: "PATCH", body: JSON.stringify(data) }
  );

// ─── Editar una reserva ya creada ───────────────────────────────

export type AdminUpdateReservationResult = {
  success: boolean;
  totalAmount: number;
  previousTotal: number;
  delta: number;
  /** Pagado de más tras bajar el total: hay que reembolsar o dejar a favor. */
  overpaid: number;
};

/**
 * Corrige precio y/o notas de una reserva existente.
 *
 * `totalAmount` es la COLUMNA, no lo que se pinta en pantalla: en los baños el
 * detalle muestra `totalAmount + extras del staff`, y mandar esa suma metería
 * los extras dentro de la columna y los duplicaría en cada guardado.
 */
export const adminUpdateReservation = (
  reservationId: string,
  data: {
    totalAmount?: number;
    internalNotes?: string | null;
    notes?: string | null;
    depositAgreed?: number | null;
    priceChangeReason?: string;
  }
) =>
  apiFetch<AdminUpdateReservationResult>(`/admin/reservations/${reservationId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export type AdminAddonResult = {
  success: boolean;
  addon: ReservationAddonWithVariant;
  totalAmount: number;
};

/**
 * Agrega un servicio a una reserva existente (baño de cortesía, desparasitante…).
 * Distinto de la ruta del cliente que paga con tarjeta.
 */
export const adminCreateReservationAddon = (
  reservationId: string,
  data: {
    variantId: string;
    quantity?: number;
    unitPriceOverride?: number;
    isCourtesy?: boolean;
    courtesyReason?: string;
    internalNote?: string | null;
    scheduledAt?: string;
    addToTotal?: boolean;
  }
) =>
  apiFetch<AdminAddonResult & { addedToTotal: number }>(
    `/admin/reservations/${reservationId}/addons`,
    { method: "POST", body: JSON.stringify(data) }
  );

/** Marca/desmarca cortesía o edita la nota de un servicio ya agregado. */
export const adminUpdateReservationAddon = (
  reservationId: string,
  addonId: string,
  data: {
    internalNote?: string | null;
    isCourtesy?: boolean;
    courtesyReason?: string | null;
    unitPrice?: number;
    scheduledAt?: string | null;
  }
) =>
  apiFetch<AdminAddonResult & { delta: number }>(
    `/admin/reservations/${reservationId}/addons/${addonId}`,
    { method: "PATCH", body: JSON.stringify(data) }
  );

export const adminAdjustCredit = (userId: string, amount: number, description: string) =>
  apiFetch<{ creditBalance: number }>(`/admin/users/${userId}/credit-adjust`, {
    method: "POST",
    body: JSON.stringify({ amount, description }),
  });

// ─── Admin Services ─────────────────────────────────────

export type AdminServiceType = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  variants: {
    id: string;
    petSize: string;
    deslanado: boolean;
    corte: boolean;
    price: number;
    isActive: boolean;
  }[];
};

export const getAdminServices = () =>
  apiFetch<AdminServiceType[]>("/admin/services");

export const createAdminService = (data: { code: string; name: string }) =>
  apiFetch("/admin/services", { method: "POST", body: JSON.stringify(data) });

export const updateAdminService = (id: string, data: { name?: string; isActive?: boolean }) =>
  apiFetch(`/admin/services/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const updateServiceVariant = (id: string, data: { price?: number; isActive?: boolean }) =>
  apiFetch(`/admin/services/variants/${id}`, { method: "PATCH", body: JSON.stringify(data) });

export const createServiceVariant = (data: {
  serviceTypeId: string;
  petSize: string;
  deslanado: boolean;
  corte: boolean;
  price: number;
}) =>
  apiFetch("/admin/services/variants", { method: "POST", body: JSON.stringify(data) });

// ─── Lodging pricing (admin) ─────────────────────────────
export interface AdminLodgingPricing {
  pricePerDaySmall: number;
  pricePerDayLarge: number;
  largeWeightKg: number;
  medicationSurchargePct: number;
  // Tarifa única por hora de guardería (y horas extra al exceder check-out).
  daycareHourPrice: number;
  updatedAt: string;
}

export const getAdminLodgingPricing = () =>
  apiFetch<AdminLodgingPricing>("/admin/lodging-pricing");

export const updateAdminLodgingPricing = (
  data: Partial<Omit<AdminLodgingPricing, "updatedAt">>
) =>
  apiFetch<AdminLodgingPricing>("/admin/lodging-pricing", {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// ─── Códigos de descuento (admin) ────────────────────────
export interface AdminDiscountCode {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";  value: number;
  minSubtotal: number | null;
  maxUses: number | null;
  usesCount: number;
  firstOrderOnly: boolean;
  isActive: boolean;
}

export const getAdminDiscountCodes = () =>
  apiFetch<AdminDiscountCode[]>("/admin/discount-codes");

export const createAdminDiscountCode = (data: {
  code: string;
  type: "PERCENT" | "FIXED";  value: number;
  minSubtotal?: number | null;
  maxUses?: number | null;
  isActive?: boolean;
}) =>
  apiFetch<{ id: string }>("/admin/discount-codes", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateAdminDiscountCode = (
  id: string,
  data: Partial<{
    code: string;
    type: "PERCENT" | "FIXED";    value: number;
    minSubtotal: number | null;
    maxUses: number | null;
    isActive: boolean;
  }>
) =>
  apiFetch<{ ok: true }>(`/admin/discount-codes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteAdminDiscountCode = (id: string) =>
  apiFetch<{ ok: true }>(`/admin/discount-codes/${id}`, { method: "DELETE" });

// ─── Delivery config (servicio a domicilio) ───────────────
export interface AdminDeliveryConfig {
  baseFee: number;
  pricePerKm: number;
  isActive: boolean;
  updatedAt: string;
}

export const getAdminDeliveryConfig = () =>
  apiFetch<AdminDeliveryConfig>("/admin/delivery-config");

export const updateAdminDeliveryConfig = (
  data: Partial<Omit<AdminDeliveryConfig, "updatedAt">>
) =>
  apiFetch<AdminDeliveryConfig>("/admin/delivery-config", {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const adminCancelReservation = (reservationId: string) =>
  apiFetch<{
    success: true;
    reservationId: string;
    refundAmount: number;
    awaitingClientChoice: boolean;
  }>(`/admin/reservations/${reservationId}/cancel`, {
    method: "POST",
  });
