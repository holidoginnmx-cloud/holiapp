import { ENDPOINTS } from "@/constants/api";
import type { Reservation } from "@holidoginn/shared";
import { apiFetch } from "./client";
import type {
  BathVariant,
  ReservationAddonWithVariant,
  HomeDeliveryInput,
} from "./types";

// ─── Bath addon ──────────────────────────────────────────

export const getBathVariants = () =>
  apiFetch<BathVariant[]>(`${ENDPOINTS.services}/bath/variants`);

export const createBathAddonPayment = (
  reservationId: string,
  data: { petId: string; deslanado: boolean; corte: boolean }
) =>
  apiFetch<{
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
    variantId: string;
  }>(`${ENDPOINTS.reservations}/${reservationId}/addons/bath`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const confirmBathAddonPayment = (reservationId: string, paymentIntentId: string) =>
  apiFetch<{ success: boolean; addon: ReservationAddonWithVariant }>(
    `${ENDPOINTS.reservations}/${reservationId}/addons/bath/confirm`,
    { method: "POST", body: JSON.stringify({ paymentIntentId }) }
  );

// ─── Bath standalone (citas sin hotel) ───────────────────

export type BathConfig = {
  id: string;
  openHour: number;
  /** Hora a la que sale la estilista: ninguna cita puede terminar después. */
  closeHour: number;
  /** DEPRECADA: era la duración única de todo baño (hoy vive por variante). */
  slotMinutes: number;
  maxConcurrentBaths: number;
  isActive: boolean;
  /** Cada cuánto se ofrece un inicio de cita. */
  slotStepMinutes: number;
  /** Duración de respaldo cuando no se resuelve la variante. */
  defaultBathDurationMinutes: number;
  /** Tope duro opcional del último inicio del día. */
  lastStartHour: number | null;
  /** Limpieza entre perro y perro. */
  bufferMinutes: number;
  updatedAt: string;
};

export type BathSlotReason =
  | "PAST"
  | "CAPACITY"
  | "CLOSES_TOO_LATE"
  | "AFTER_LAST_START"
  | "OUT_OF_WINDOW";

export type BathSlot = {
  startUtc: string;
  /** A qué hora terminaría el servicio. */
  endUtc?: string;
  available: boolean;
  remaining: number;
  inPast: boolean;
  /** Por qué no se puede tomar, cuando no está disponible. */
  reason?: BathSlotReason;
};

export type BathSlotsResponse = {
  config: BathConfig;
  /** Minutos que toma el servicio consultado. */
  durationMinutes: number;
  /** false = la API usó su duración de respaldo. */
  durationResolved: boolean;
  slots: BathSlot[];
};

export const getBathConfig = () =>
  apiFetch<BathConfig>(`${ENDPOINTS.baths}/config`);

export const updateBathConfig = (data: Partial<Omit<BathConfig, "id" | "updatedAt">>) =>
  apiFetch<BathConfig>(`/admin${ENDPOINTS.baths}/config`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// Los horarios dependen del servicio: un baño con corte tarda más y por tanto
// cabe en menos huecos. Sin `opts` la API responde con su duración de respaldo.
export const getBathSlots = (
  date: string,
  opts?: {
    petId?: string;
    deslanado?: boolean;
    corte?: boolean;
    excludeReservationId?: string;
  },
) => {
  const params = new URLSearchParams({ date });
  if (opts?.petId) params.set("petId", opts.petId);
  if (opts?.deslanado != null) params.set("deslanado", String(opts.deslanado));
  if (opts?.corte != null) params.set("corte", String(opts.corte));
  if (opts?.excludeReservationId)
    params.set("excludeReservationId", opts.excludeReservationId);
  return apiFetch<BathSlotsResponse>(`${ENDPOINTS.baths}/slots?${params}`);
};

// Reagendar una cita suelta (STAFF/ADMIN). Solo mueve la hora; con `force`
// guarda aunque se encime o esté en el pasado ("Agendar de todos modos").
export type UpdateBathAppointmentResult = {
  success: boolean;
  appointmentAt: string;
  scheduleOverridden: boolean;
  warning: string | null;
};

export const updateBathAppointment = (
  reservationId: string,
  data: { appointmentAt: string; force?: boolean; overrideReason?: string },
) =>
  apiFetch<UpdateBathAppointmentResult>(
    `/staff${ENDPOINTS.baths}/${reservationId}/appointment`,
    { method: "PATCH", body: JSON.stringify(data) },
  );

export const BATH_DEPOSIT_AMOUNT = 150;
export const BATH_LATE_TOLERANCE_MIN = 15;

export const createBathIntent = (data: {
  petId: string;
  deslanado: boolean;
  corte: boolean;
  appointmentAt: string;
  notes?: string;
  paymentType?: "DEPOSIT" | "FULL";
  homeDelivery?: HomeDeliveryInput;
  discountCode?: string;
}) =>
  apiFetch<{
    clientSecret: string | null;
    paymentIntentId: string | null;
    coveredByCredit: boolean;
    creditApplied: number;
    price: number;
    depositAmount: number;
    remainingAmount: number;
    paymentType: "DEPOSIT" | "FULL";
    variantId: string;
    deliveryFee: number;
    deliveryDistanceKm: number;
    deliveryActive: boolean;
    discountTotal: number;
    discountCode?: string | null;
  }>(`${ENDPOINTS.baths}/create-intent`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const confirmBath = (data: {
  paymentIntentId?: string;
  petId?: string;
  variantId?: string;
  appointmentAt?: string;
  notes?: string;
  homeDelivery?: HomeDeliveryInput;
  discountCode?: string;
}) =>
  apiFetch<{ success: boolean; reservation: Reservation }>(
    `${ENDPOINTS.baths}/confirm`,
    { method: "POST", body: JSON.stringify(data) },
  );

export const createExtrasPaymentIntent = (
  reservationId: string,
  addonId: string,
) =>
  apiFetch<{
    clientSecret: string;
    paymentIntentId: string;
    amount: number;
  }>(`/reservations/${reservationId}/addons/${addonId}/extras/intent`, {
    method: "POST",
  });

export const confirmExtrasPayment = (
  reservationId: string,
  addonId: string,
  paymentIntentId: string,
) =>
  apiFetch<{ success: boolean }>(
    `/reservations/${reservationId}/addons/${addonId}/extras/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ paymentIntentId }),
    },
  );

export const chooseExtrasPayOnPickup = (
  reservationId: string,
  addonId: string,
) =>
  apiFetch<{ success: boolean }>(
    `/reservations/${reservationId}/addons/${addonId}/extras/pay-on-pickup`,
    { method: "POST" },
  );
