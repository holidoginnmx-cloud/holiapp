import { apiFetch } from "./client";
import type { DeliveryTrip } from "./delivery";

// ─── Citas recurrentes (equipo) ─────────────────────────
// Una serie crea sola cada cita unos días antes (baño o guardería). Ver
// packages/api/src/lib/recurringBookings.ts y routes/recurringBookings.ts.

export type RecurringUpcoming = {
  /** "YYYY-MM-DD" (día del hotel) que le toca según la serie. */
  date: string;
  /** La cita ya se creó (null = todavía no entra a la ventana). */
  reservationId: string | null;
  status: string | null;
  /** Cuándo quedó realmente (el equipo pudo moverla). */
  appointmentAt: string | null;
};

export type RecurringBooking = {
  id: string;
  reservationType: "BATH" | "DAYCARE";
  ownerId: string;
  owner: { id: string; firstName: string; lastName: string; phone: string | null };
  petIds: string[];
  pets: { id: string; name: string; isActive: boolean; photoUrl: string | null }[];
  intervalWeeks: number;
  weekdays: number[];
  anchorDate: string;
  endDate: string | null;
  startTime: string | null;
  deslanado: boolean;
  corte: boolean;
  checkInTime: string | null;
  checkOutTime: string | null;
  homeDelivery: boolean;
  homeDeliveryAddress: string | null;
  homeDeliveryLat: number | null;
  homeDeliveryLng: number | null;
  homeDeliveryPlaceId: string | null;
  homeDeliveryTrip: DeliveryTrip;
  chargeDelivery: boolean;
  /** Solo llega a ADMIN. */
  totalAmountOverride?: number | null;
  internalNotes: string | null;
  staffId: string | null;
  leadDays: number;
  skipDates: string[];
  generatedThrough: string | null;
  active: boolean;
  pausedReason: string | null;
  summary: string;
  upcoming: RecurringUpcoming[];
};

export type RecurringBookingBody = {
  reservationType: "BATH" | "DAYCARE";
  ownerId: string;
  petIds: string[];
  intervalWeeks: number;
  weekdays: number[];
  anchorDate: string;
  endDate?: string | null;
  startTime?: string | null;
  deslanado?: boolean;
  corte?: boolean;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  homeDelivery?: {
    address: string;
    lat: number;
    lng: number;
    placeId?: string;
    trip?: DeliveryTrip;
  } | null;
  chargeDelivery?: boolean;
  totalAmountOverride?: number | null;
  internalNotes?: string | null;
  staffId?: string | null;
  leadDays?: number;
};

export type RecurringSaveResult = RecurringBooking & {
  generated: { date: string; reservationIds: string[] }[];
  failed: { date: string; error: string }[];
};

export const getRecurringBookings = (ownerId?: string) =>
  apiFetch<RecurringBooking[]>(
    `/recurring-bookings${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`
  );

export const getRecurringBooking = (id: string) =>
  apiFetch<RecurringBooking>(`/recurring-bookings/${id}`);

export const createRecurringBooking = (body: RecurringBookingBody) =>
  apiFetch<RecurringSaveResult>("/recurring-bookings", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateRecurringBooking = (
  id: string,
  body: Partial<Omit<RecurringBookingBody, "ownerId">> & { active?: boolean }
) =>
  apiFetch<RecurringSaveResult>(`/recurring-bookings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const skipRecurringDate = (id: string, date: string, skip = true) =>
  apiFetch<RecurringBooking>(`/recurring-bookings/${id}/skip`, {
    method: "POST",
    body: JSON.stringify({ date, skip }),
  });

export const deleteRecurringBooking = (id: string) =>
  apiFetch<{ success: true }>(`/recurring-bookings/${id}`, { method: "DELETE" });
