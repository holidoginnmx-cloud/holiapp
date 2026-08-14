import type {
  Pet,
  Vaccine,
  Reservation,
  StayUpdate,
  Room,
  Payment,
  DailyChecklist,
  BehaviorTag,
  StaffAlert,
  CreateDailyChecklist,
  CreateBehaviorTag,
  CreateStaffAlert,
  CreateStayUpdate,
} from "@holidoginn/shared";
import { apiFetch } from "./client";
import type { ReservationAddonWithVariant } from "./types";
import type { ChangeRequest } from "./change-requests";

// ─── Staff: bath appointments ─────────────────────────────

export type StaffBath = Reservation & {
  pet: {
    id: string;
    name: string;
    breed: string | null;
    weight: number | null;
    photoUrl: string | null;
    size: "XS" | "S" | "M" | "L" | "XL";
    notes: string | null;
  };
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string;
  };
  addons: ReservationAddonWithVariant[];
  // StayUpdates con foto subida al completar el baño.
  updates: {
    id: string;
    mediaUrl: string;
    mediaType: string;
    caption: string | null;
    createdAt: string;
  }[];
  // Payments PAID (para calcular deposit remainder).
  payments: {
    id: string;
    amount: string;
    method: "CASH" | "CARD" | "TRANSFER" | "STRIPE" | "CREDIT";
    paidAt: string | null;
  }[];
  /** Minutos que toma el servicio (por talla y extras). */
  durationMinutes?: number;
  /** Hora a la que termina, ya calculada por la API. */
  appointmentEndAt?: string | null;
  /**
   * Solo en baños de perros hospedados: false = la hora mostrada es el
   * check-out, nadie le asignó horario de estética todavía.
   */
  groomingScheduled?: boolean;
};

export const getStaffBaths = (date?: string) =>
  apiFetch<{ date: string; baths: StaffBath[] }>(
    `/staff/baths${date ? `?date=${encodeURIComponent(date)}` : ""}`,
  );

// `mediaUrl` opcional: la foto es lo ideal, pero cuando no se alcanzó a tomar
// se prefiere cerrar la cita a subir una imagen cualquiera.
export const completeStaffBath = (id: string, mediaUrl?: string) =>
  apiFetch<{ success: boolean }>(`/staff/baths/${id}/complete`, {
    method: "POST",
    body: JSON.stringify(mediaUrl ? { mediaUrl } : {}),
  });

// ─── Extras de baño (deslanado/corte cobrado por staff post-servicio) ──

export type AddonExtraStatus =
  | "PENDING_PAYMENT"
  | "PAY_ON_PICKUP"
  | "PAID";

export const setBathExtrasPrice = (
  addonId: string,
  payload: { extraDeslanadoPrice?: number; extraCortePrice?: number },
) =>
  apiFetch<ReservationAddonWithVariant>(
    `/staff/addons/${addonId}/set-extras`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

export const confirmExtrasPaidAtPickup = (
  addonId: string,
  payload: { method?: "CASH" | "TRANSFER" } = {},
) =>
  apiFetch<ReservationAddonWithVariant>(
    `/staff/addons/${addonId}/confirm-pickup-paid`,
    { method: "POST", body: JSON.stringify(payload) },
  );

// Staff registra un pago manual (efectivo/transferencia) con monto específico.
// Soporta pagos parciales. Cuando el acumulado cubre todo el saldo, el
// endpoint marca extras como PAID y concluye el baño.
export const registerBathManualPayment = (
  reservationId: string,
  payload: {
    amount: number;
    method?: "CASH" | "TRANSFER";
    notes?: string;
  },
) =>
  apiFetch<{ success: boolean; amount: number; concluded: boolean }>(
    `/staff/baths/${reservationId}/register-manual-payment`,
    { method: "POST", body: JSON.stringify(payload) },
  );

// ─── Guardería (staff) ───────────────────────────────────
// Mismo shape que StaffBath (pet, owner, addons, payments) + horas estimadas.
export type StaffDaycare = StaffBath;

export const getStaffDaycares = (date?: string) =>
  apiFetch<{ date: string; daycares: StaffDaycare[] }>(
    `/staff/daycares${date ? `?date=${encodeURIComponent(date)}` : ""}`,
  );

export const checkInStaffDaycare = (id: string) =>
  apiFetch<{ success: boolean }>(`/staff/daycares/${id}/check-in`, {
    method: "POST",
  });

export const checkOutStaffDaycare = (id: string, pickupTime?: string) =>
  apiFetch<{
    success: boolean;
    extraHours: number;
    extraAmount: number;
    newTotal: number;
    balance: number;
    concluded: boolean;
  }>(`/staff/daycares/${id}/check-out`, {
    method: "POST",
    body: JSON.stringify(pickupTime ? { pickupTime } : {}),
  });

export const registerDaycareManualPayment = (
  reservationId: string,
  payload: { amount: number; method?: "CASH" | "TRANSFER"; notes?: string },
) =>
  apiFetch<{ success: boolean; amount: number; concluded: boolean }>(
    `/staff/daycares/${reservationId}/register-manual-payment`,
    { method: "POST", body: JSON.stringify(payload) },
  );

// ─── Staff ────────────────────────────────────────────

export type StaffStay = Reservation & {
  pet: Pet & {
    vaccines: Vaccine[];
    owner: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  };
  room: Room | null;
  owner: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  checklists: DailyChecklist[];
  updates: StayUpdate[];
  staff: { id: string; firstName: string; lastName: string } | null;
  addons?: ReservationAddonWithVariant[];
};

export type StaffStayDetail = Reservation & {
  pet: Pet & {
    vaccines: Vaccine[];
    behaviorTags: (BehaviorTag & { staff: { id: string; firstName: string; lastName: string } })[];
    owner: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  };
  room: Room | null;
  owner: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
  checklists: (DailyChecklist & { staff: { id: string; firstName: string; lastName: string } })[];
  updates: StayUpdate[];
  alerts: (StaffAlert & { staff: { id: string; firstName: string; lastName: string } })[];
  staff: { id: string; firstName: string; lastName: string } | null;
  addons?: ReservationAddonWithVariant[];
  changeRequests?: ChangeRequest[];
  // Pagos cobrados (PAID o PARTIAL=anticipo) — para calcular saldo pendiente.
  payments: {
    id: string;
    amount: string;
    method: "CASH" | "CARD" | "TRANSFER" | "STRIPE" | "CREDIT";
    status: "PAID" | "PARTIAL";
    paidAt: string | null;
  }[];
};

export type StaffStats = {
  memberSince: string | null;
  totalStays: number;
  monthStays: number;
  checklists: number;
  updates: number;
  alertsReported: number;
  alertsResolved: number;
};

export const getStaffStats = () =>
  apiFetch<StaffStats>("/staff/me/stats");

export const getStaffStays = (status?: string) =>
  apiFetch<StaffStay[]>(`/staff/stays${status ? `?status=${status}` : ""}`);

// Todas las estancias (sin filtrar por staffId, todos los status excepto
// CANCELLED). Para el calendario de staff donde cualquier staff ve agenda
// completa de hotel.
export const getStaffStaysAll = () =>
  apiFetch<StaffStay[]>("/staff/stays?all=true");

export const getStaffStaysUnassigned = () =>
  apiFetch<StaffStay[]>("/staff/stays/unassigned");

export const getStaffStayById = (id: string) =>
  apiFetch<StaffStayDetail>(`/staff/stays/${id}`);

export const assignStay = (id: string) =>
  apiFetch<Reservation>(`/staff/stays/${id}/assign`, { method: "POST", body: JSON.stringify({}) });

export const staffCheckin = (id: string) =>
  apiFetch<Reservation>(`/staff/stays/${id}/checkin`, { method: "POST", body: JSON.stringify({}) });

export const staffCheckout = (id: string) =>
  apiFetch<{ reservation: Reservation; warnings: string[] }>(
    `/staff/stays/${id}/checkout`,
    { method: "POST", body: JSON.stringify({}) }
  );

// Staff registra pago manual (efectivo/transferencia) para una estancia.
// Útil cuando el owner liquida el saldo del anticipo al check-in.
export const registerStayManualPayment = (
  reservationId: string,
  payload: {
    amount: number;
    method?: "CASH" | "TRANSFER";
    notes?: string;
  },
) =>
  apiFetch<{ success: boolean; amount: number; payment: Payment }>(
    `/staff/stays/${reservationId}/register-manual-payment`,
    { method: "POST", body: JSON.stringify(payload) },
  );

export const createDailyChecklist = (
  data: CreateDailyChecklist & {
    mediaItems: Array<{ url: string; type: "image" | "video" }>;
  }
) =>
  apiFetch<DailyChecklist>("/staff/checklists", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getChecklists = (reservationId: string) =>
  apiFetch<(DailyChecklist & { staff: { id: string; firstName: string; lastName: string } })[]>(
    `/staff/checklists/${reservationId}`
  );

export const updateChecklist = (id: string, data: Partial<CreateDailyChecklist>) =>
  apiFetch<DailyChecklist>(`/staff/checklists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const createStaffUpdate = (data: CreateStayUpdate) =>
  apiFetch<StayUpdate>("/staff/stay-updates", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createStaffAlert = (data: CreateStaffAlert) =>
  apiFetch<StaffAlert>("/staff/alerts", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const addBehaviorTag = (data: CreateBehaviorTag) =>
  apiFetch<BehaviorTag>("/staff/behavior-tags", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getBehaviorTags = (petId: string) =>
  apiFetch<(BehaviorTag & { staff: { id: string; firstName: string; lastName: string } })[]>(
    `/staff/behavior-tags/${petId}`
  );

export const deleteBehaviorTag = (tagId: string) =>
  apiFetch<{ ok: true }>(`/staff/behavior-tags/${tagId}`, {
    method: "DELETE",
  });

export const resolveStaffAlert = (alertId: string) =>
  apiFetch<StaffAlert>(`/staff/alerts/${alertId}/resolve`, {
    method: "PATCH",
  });

export const completeAddon = (addonId: string, mediaUrl?: string) =>
  apiFetch<ReservationAddonWithVariant>(`/staff/addons/${addonId}/complete`, {
    method: "PATCH",
    body: JSON.stringify(mediaUrl ? { mediaUrl } : {}),
  });
