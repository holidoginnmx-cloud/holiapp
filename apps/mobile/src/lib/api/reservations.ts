import { ENDPOINTS } from "@/constants/api";
import type { Reservation, DailyChecklist } from "@holidoginn/shared";
import { apiFetch } from "./client";
import type {
  ReservationListItem,
  ReservationDetail,
  BathSelectionsByPet,
  MedicationByPet,
  HomeDeliveryInput,
} from "./types";

// ─── Reservations ────────────────────────────────────────

export const getReservations = (params: {
  ownerId?: string;
  status?: string;
}) => {
  const query = new URLSearchParams();
  if (params.ownerId) query.set("ownerId", params.ownerId);
  if (params.status) query.set("status", params.status);
  return apiFetch<ReservationListItem[]>(
    `${ENDPOINTS.reservations}?${query.toString()}`
  );
};

export const getReservationById = (id: string) =>
  apiFetch<ReservationDetail>(`${ENDPOINTS.reservations}/${id}`);

export const createReservation = (data: Record<string, unknown>) =>
  apiFetch<ReservationDetail>(ENDPOINTS.reservations, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createMultiReservation = (data: {
  petIds: string[];
  checkIn: string;
  checkOut: string;
  // Hora estimada de llegada/recogida ("HH:mm" local), opcional al reservar.
  checkInTime?: string;
  checkOutTime?: string;
  notes?: string | null;
  legalAccepted: boolean;
  ownerId: string;
  roomPreference: "shared" | "separate";
  // null when the deposit/total was fully covered by saldo a favor and no
  // Stripe charge was created.
  stripePaymentIntentId: string | null;
  paymentType: "FULL" | "DEPOSIT";
  bathSelectionsByPet?: BathSelectionsByPet;
  medicationByPet?: MedicationByPet;
  homeDelivery?: HomeDeliveryInput;
  // Solo se usa en la ruta credit-only (sin PaymentIntent); en el flujo Stripe
  // el descuento se lee del metadata del PI en el servidor.
  discountCode?: string;
}) =>
  apiFetch<{ reservations: ReservationDetail[]; grandTotal: number; discountTotal?: number; groupId: string | null }>(
    `${ENDPOINTS.reservations}/multi`,
    { method: "POST", body: JSON.stringify(data) }
  );

// Validación en vivo del código de descuento al reservar (hotel o baño). Solo
// informativo; el create-intent es la autoridad del monto. Alcance RESERVATIONS/BOTH.
export const validateReservationDiscount = (data: { code: string; subtotal: number }) =>
  apiFetch<{ valid: boolean; discountTotal: number; message: string }>(
    `${ENDPOINTS.reservations}/discounts/validate`,
    { method: "POST", body: JSON.stringify(data) }
  );

export type ChecklistWithStaff = DailyChecklist & {
  staff: { id: string; firstName: string; lastName: string };
};

export const getOwnerChecklists = (reservationId: string) =>
  apiFetch<ChecklistWithStaff[]>(
    `${ENDPOINTS.reservations}/${reservationId}/checklists`
  );

export const updateReservationStatus = (id: string, status: string) =>
  apiFetch<ReservationDetail>(`${ENDPOINTS.reservations}/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

/** Hora estimada de llegada/recogida ("HH:mm" local; null la borra). El
 * backend la propaga a todo el grupo multi-mascota. */
export const updateReservationTimes = (
  id: string,
  data: { checkInTime?: string | null; checkOutTime?: string | null },
) =>
  apiFetch<Reservation>(`${ENDPOINTS.reservations}/${id}/times`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
