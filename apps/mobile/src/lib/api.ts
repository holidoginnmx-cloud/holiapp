import { BASE_URL, ENDPOINTS } from "@/constants/api";
import { useAuthStore } from "@/store/authStore";
import type {
  User,
  Pet,
  Vaccine,
  Reservation,
  StayUpdate,
  Notification,
  Room,
  Payment,
  DailyChecklist,
  BehaviorTag,
  StaffAlert,
  Review,
  CreateDailyChecklist,
  CreateBehaviorTag,
  CreateStaffAlert,
  CreateStayUpdate,
} from "@holidoginn/shared";

// ─── Extended types (API responses with relations) ───────

export type VaccineWithCatalog = Vaccine & {
  catalogId?: string | null;
  catalog?: {
    id: string;
    code: string;
    displayName: string;
  } | null;
};

export type PetWithVaccines = Pet & {
  vaccines: VaccineWithCatalog[];
  owner: { id: string; firstName: string; lastName: string; email: string };
};

export type ReservationListItem = Reservation & {
  pet: { id: string; name: string; breed: string | null; photoUrl: string | null };
  room: { id: string; name: string } | null;
  staff: { id: string; firstName: string; lastName: string } | null;
  owner: { id: string; firstName: string; lastName: string };
  hasBalance: boolean;
  hasPendingChangeRequest: boolean;
  lastUpdateAt: string | null;
  hasReview: boolean;
  reviewRating: number | null;
  hasDeslanado: boolean;
  hasCorte: boolean;
};

export type BathVariant = {
  id: string;
  serviceTypeId: string;
  petSize: "XS" | "S" | "M" | "L" | "XL";
  deslanado: boolean;
  corte: boolean;
  price: number;
  isActive: boolean;
};

export type ReservationAddonWithVariant = {
  id: string;
  reservationId: string;
  variantId: string;
  unitPrice: string;
  paidWith: "BOOKING" | "STANDALONE";
  paymentId: string | null;
  completedAt: string | null;
  // Extras (deslanado/corte) — el precio lo define staff post-servicio.
  // `extraPrice` es el total; `extraDeslanadoPrice`/`extraCortePrice` el desglose.
  extraPrice: string | null;
  extraDeslanadoPrice: string | null;
  extraCortePrice: string | null;
  extraDescription: string | null;
  extraPaymentStatus: "PENDING_PAYMENT" | "PAY_ON_PICKUP" | "PAID" | null;
  extraSetById: string | null;
  extraSetAt: string | null;
  extraPaidAt: string | null;
  extraStripePaymentIntentId: string | null;
  createdAt: string;
  variant: BathVariant & {
    serviceType: { id: string; code: string; name: string };
  };
};

export type StayUpdateWithStaff = StayUpdate & {
  staff: { id: string; firstName: string; lastName: string } | null;
};

export type ReservationDetail = Reservation & {
  pet: Pet;
  room: Room | null;
  payments: Payment[];
  updates: StayUpdateWithStaff[];
  owner: { id: string; firstName: string; lastName: string; email: string };
  staff: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  review?: Review | null;
  addons?: ReservationAddonWithVariant[];
};

// ─── Fetch wrapper ───────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { tokenResolver } = useAuthStore.getState();

  let authHeader: Record<string, string> = {};
  if (tokenResolver) {
    const token = await tokenResolver();
    if (token) {
      authHeader = { Authorization: `Bearer ${token}` };
    }
  }

  const hasBody = options?.body != null;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...authHeader,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.log("❌ API error:", res.status, JSON.stringify(body));
    const msg = typeof body.error === "string" ? body.error : `Error ${res.status}`;
    throw new Error(msg);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

// ─── Users ───────────────────────────────────────────────

export const getUsers = () => apiFetch<User[]>(ENDPOINTS.users);

export const getUserById = (id: string) =>
  apiFetch<User & { pets: Pet[] }>(`${ENDPOINTS.users}/${id}`);

// ─── Pets ────────────────────────────────────────────────

export type PetForBooking = Pet & {
  vaccines: VaccineWithCatalog[];
  reservations: {
    id: string;
    checkIn: string;
    checkOut: string;
    status: "CONFIRMED" | "CHECKED_IN";
    paymentType: "FULL" | "DEPOSIT" | null;
    totalAmount: string;
    hasBalance: boolean;
  }[];
};

export const getPetsByOwner = (ownerId: string) =>
  apiFetch<PetForBooking[]>(`${ENDPOINTS.pets}?ownerId=${ownerId}`);

export const getPetById = (id: string) =>
  apiFetch<PetWithVaccines>(`${ENDPOINTS.pets}/${id}`);

export const createPet = (data: Record<string, unknown>) =>
  apiFetch<Pet>(ENDPOINTS.pets, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updatePet = (id: string, data: Record<string, unknown>) =>
  apiFetch<Pet>(`${ENDPOINTS.pets}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// ─── Dewormings ─────────────────────────────────────────

export type DewormingType = "INTERNAL" | "EXTERNAL" | "BOTH";

export type Deworming = {
  id: string;
  type: DewormingType;
  productName: string | null;
  appliedAt: string;
  expiresAt: string | null;
  vetName: string | null;
  fileUrl: string | null;
  notes: string | null;
  petId: string;
  createdAt: string;
};

export const getDewormings = (petId: string) =>
  apiFetch<Deworming[]>(`${ENDPOINTS.pets}/${petId}/dewormings`);

export const addDeworming = (
  petId: string,
  data: {
    type: DewormingType;
    productName?: string | null;
    appliedAt: string;
    expiresAt?: string | null;
    vetName?: string | null;
    fileUrl?: string | null;
    notes?: string | null;
  },
) =>
  apiFetch<Deworming>(`${ENDPOINTS.pets}/${petId}/dewormings`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteDeworming = (petId: string, id: string) =>
  apiFetch<void>(`${ENDPOINTS.pets}/${petId}/dewormings/${id}`, {
    method: "DELETE",
  });

export const addVaccine = (petId: string, data: Record<string, unknown>) =>
  apiFetch<Vaccine>(`${ENDPOINTS.pets}/${petId}/vaccines`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export type PetHistory = {
  pet: Pet;
  reservations: (Reservation & {
    room: { id: string; name: string } | null;
    updates: StayUpdate[];
    checklists: DailyChecklist[];
    review: Review | null;
  })[];
  behaviorTags: (BehaviorTag & {
    staff: { firstName: string; lastName: string };
  })[];
};

export const getPetHistory = (petId: string) =>
  apiFetch<PetHistory>(`${ENDPOINTS.pets}/${petId}/history`);

export type PetAlert = StaffAlert & {
  staff: { id: string; firstName: string; lastName: string };
  reservation: {
    id: string;
    checkIn: string | null;
    checkOut: string | null;
    reservationType: "STAY" | "BATH";
    appointmentAt: string | null;
    room: { id: string; name: string } | null;
  };
};

export const getPetAlerts = (petId: string, resolved?: boolean) => {
  const qs = resolved === undefined ? "" : `?resolved=${resolved}`;
  return apiFetch<PetAlert[]>(`${ENDPOINTS.pets}/${petId}/alerts${qs}`);
};

// ─── Rooms ───────────────────────────────────────────────

export const getRooms = (size?: string) =>
  apiFetch<Room[]>(`${ENDPOINTS.rooms}${size ? `?size=${size}` : ""}`);

export const getAvailableRooms = (params: {
  checkIn: string;
  checkOut: string;
  petSize: string;
}) => {
  const query = new URLSearchParams(params);
  return apiFetch<Room[]>(`${ENDPOINTS.rooms}/available?${query.toString()}`);
};

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

export type BathSelectionsByPet = Record<string, { deslanado: boolean; corte: boolean }>;
export type MedicationByPet = Record<string, { notes: string }>;

export const createMultiReservation = (data: {
  petIds: string[];
  checkIn: string;
  checkOut: string;
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
}) =>
  apiFetch<{ reservations: ReservationDetail[]; grandTotal: number; groupId: string | null }>(
    `${ENDPOINTS.reservations}/multi`,
    { method: "POST", body: JSON.stringify(data) }
  );

export const createPaymentIntent = (data: {
  petIds: string[];
  checkIn: string;
  checkOut: string;
  ownerId: string;
  roomPreference: "shared" | "separate";
  paymentType?: "FULL" | "DEPOSIT";
  bathSelectionsByPet?: BathSelectionsByPet;
  medicationByPet?: MedicationByPet;
}) =>
  apiFetch<{
    // Both null when saldo a favor covered the entire deposit/total — no
    // Stripe charge created.
    clientSecret: string | null;
    paymentIntentId: string | null;
    coveredByCredit: boolean;
    creditApplied: number;
    grandTotal: number;
    depositAmount: number;
    remainingAmount: number;
    depositDeadline: string | null;
    paymentType: string;
    breakdown: { petId: string; petName: string; weight: number; pricePerDay: number; subtotal: number }[];
    bathBreakdown: { petId: string; variantId: string; price: number }[];
    bathTotal: number;
    totalDays: number;
    medicationBreakdown: { petId: string; surcharge: number }[];
    medicationTotal: number;
  }>(`${ENDPOINTS.payments}/create-intent`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createBalancePayment = (reservationId: string) =>
  apiFetch<{ clientSecret: string; paymentIntentId: string; remaining: number }>(
    `${ENDPOINTS.payments}/pay-balance`,
    { method: "POST", body: JSON.stringify({ reservationId }) }
  );

export const confirmBalancePayment = (reservationId: string, stripePaymentIntentId: string) =>
  apiFetch<{ success: boolean }>(
    `${ENDPOINTS.payments}/confirm-balance`,
    { method: "POST", body: JSON.stringify({ reservationId, stripePaymentIntentId }) }
  );

export const registerManualPayment = (data: {
  reservationId: string;
  amount: number;
  method: "CASH" | "TRANSFER";
  notes?: string;
}) =>
  apiFetch<Payment>("/admin/payments/manual", {
    method: "POST",
    body: JSON.stringify(data),
  });

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
  closeHour: number;
  slotMinutes: number;
  maxConcurrentBaths: number;
  isActive: boolean;
  updatedAt: string;
};

export type BathSlot = {
  startUtc: string;
  available: boolean;
  remaining: number;
  inPast: boolean;
};

export const getBathConfig = () =>
  apiFetch<BathConfig>(`${ENDPOINTS.baths}/config`);

export const updateBathConfig = (data: Partial<Omit<BathConfig, "id" | "updatedAt">>) =>
  apiFetch<BathConfig>(`/admin${ENDPOINTS.baths}/config`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const getBathSlots = (date: string) =>
  apiFetch<{ config: BathConfig; slots: BathSlot[] }>(
    `${ENDPOINTS.baths}/slots?date=${encodeURIComponent(date)}`,
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
}) =>
  apiFetch<{ success: boolean; reservation: Reservation }>(
    `${ENDPOINTS.baths}/confirm`,
    { method: "POST", body: JSON.stringify(data) },
  );

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
};

export const getStaffBaths = (date?: string) =>
  apiFetch<{ date: string; baths: StaffBath[] }>(
    `/staff/baths${date ? `?date=${encodeURIComponent(date)}` : ""}`,
  );

export const completeStaffBath = (id: string, mediaUrl: string) =>
  apiFetch<{ success: boolean }>(`/staff/baths/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ mediaUrl }),
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

export type ChecklistWithStaff = DailyChecklist & {
  staff: { id: string; firstName: string; lastName: string };
};

export const getOwnerChecklists = (reservationId: string) =>
  apiFetch<ChecklistWithStaff[]>(
    `${ENDPOINTS.reservations}/${reservationId}/checklists`
  );

// ─── Stay Updates ────────────────────────────────────────

export const getStayUpdates = (reservationId: string) =>
  apiFetch<StayUpdate[]>(`${ENDPOINTS.stayUpdates}/${reservationId}`);

export const deleteStayUpdate = (id: string) =>
  apiFetch<void>(`${ENDPOINTS.stayUpdates}/${id}`, { method: "DELETE" });

// ─── Payments ────────────────────────────────────────────

export const getPayments = (reservationId: string) =>
  apiFetch<Payment[]>(`${ENDPOINTS.payments}/${reservationId}`);

// ─── Notifications ───────────────────────────────────────

export const getNotifications = (userId: string) =>
  apiFetch<Notification[]>(`${ENDPOINTS.notifications}/${userId}`);

export const markNotificationAsRead = (id: string) =>
  apiFetch<Notification>(`${ENDPOINTS.notifications}/${id}/read`, {
    method: "PATCH",
  });

export const markAllNotificationsAsRead = (userId: string) =>
  apiFetch<{ updated: number }>(
    `${ENDPOINTS.notifications}/read-all/${userId}`,
    { method: "PATCH" }
  );

// ─── Reviews ───────────────────────────────────────────

export const createReview = (data: {
  rating: number;
  comment: string | null;
  reservationId: string;
}) =>
  apiFetch<Review>(ENDPOINTS.reviews, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getReviewByReservation = (reservationId: string) =>
  apiFetch<Review>(`${ENDPOINTS.reviews}/${reservationId}`);

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

export type PetWithOwner = Pet & {
  owner: { id: string; firstName: string; lastName: string; email: string };
};

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
  byCategory: { hotel: number; bath: number };
  payments: {
    id: string;
    amount: string;
    method: string;
    status: string;
    kind: "PAYMENT" | "REFUND";
    paidAt: string | null;
    createdAt: string;
    category: "HOTEL" | "BATH" | "MIXED";
    hotelAmount: number;
    bathAmount: number;
    reservation: {
      id: string;
      reservationType: "STAY" | "BATH";
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

export const sendAdminNotification = (data: {
  userIds: string[] | "all";
  title: string;
  body: string;
  type?: string;
}) =>
  apiFetch<{ sent: number }>("/admin/notifications/send", {
    method: "POST",
    body: JSON.stringify(data),
  });

// ─── Cartillas (admin) ───────────────────────────────────

export type CartillaStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type CartillaVaccine = {
  id: string;
  name: string;
  appliedAt: string;
  expiresAt: string | null;
  vetName: string | null;
  catalogId: string | null;
  catalog: {
    id: string;
    code: string;
    displayName: string;
  } | null;
};

export type PetWithCartilla = Pet & {
  cartillaUrl: string | null;
  cartillaPhotos: string[];
  cartillaStatus: CartillaStatusValue | null;
  cartillaReviewedAt: string | null;
  cartillaReviewedById: string | null;
  cartillaRejectionReason: string | null;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  cartillaReviewedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  vaccines?: CartillaVaccine[];
  dewormings?: Deworming[];
};

export const getCartillas = (status: CartillaStatusValue = "PENDING") =>
  apiFetch<PetWithCartilla[]>(`/admin/cartillas?status=${status}`);

export const getPendingCartillasCount = () =>
  apiFetch<{ pending: number }>("/admin/cartillas/pending-count");

export type VaccineCatalogEntry = {
  id: string;
  code: string;
  displayName: string;
  defaultDurationDays: number;
  description: string | null;
  isActive: boolean;
};

export const getVaccineCatalog = () =>
  apiFetch<VaccineCatalogEntry[]>("/vaccine-catalog");

export type ReviewCartillaPayload =
  | {
      action: "APPROVE";
      vaccines?: {
        catalogId: string;
        appliedAt: string;
        expiresAt: string;
        vetName?: string;
      }[];
      dewormings?: {
        type: DewormingType;
        productName?: string | null;
        appliedAt: string;
        expiresAt?: string | null;
        notes?: string | null;
      }[];
    }
  | { action: "REJECT"; reason?: string };

export const reviewCartilla = (petId: string, data: ReviewCartillaPayload) =>
  apiFetch<Pet>(`/admin/pets/${petId}/cartilla`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export type UpdateVaccinePayload = {
  catalogId?: string;
  appliedAt?: string;
  expiresAt?: string;
  vetName?: string | null;
};

export const updateAdminVaccine = (
  vaccineId: string,
  data: UpdateVaccinePayload
) =>
  apiFetch<CartillaVaccine>(`/admin/vaccines/${vaccineId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteAdminVaccine = (vaccineId: string) =>
  apiFetch<{ id: string }>(`/admin/vaccines/${vaccineId}`, {
    method: "DELETE",
  });

export const updateReservationStatus = (id: string, status: string) =>
  apiFetch<ReservationDetail>(`${ENDPOINTS.reservations}/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const updateRoom = (id: string, data: Partial<Room>) =>
  apiFetch<Room>(`${ENDPOINTS.rooms}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const createRoom = (data: Omit<Room, "id" | "createdAt" | "updatedAt">) =>
  apiFetch<Room>(ENDPOINTS.rooms, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteRoom = (id: string) =>
  apiFetch<void>(`${ENDPOINTS.rooms}/${id}`, {
    method: "DELETE",
  });

export const updateUser = (id: string, data: Partial<User>) =>
  apiFetch<User>(`${ENDPOINTS.users}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const updateMyRole = (role: User["role"]) =>
  apiFetch<User>(`${ENDPOINTS.users}/me/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });

export const getAllPets = () =>
  apiFetch<PetWithOwner[]>(ENDPOINTS.pets);

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

export const completeAddon = (addonId: string, mediaUrl: string) =>
  apiFetch<ReservationAddonWithVariant>(`/staff/addons/${addonId}/complete`, {
    method: "PATCH",
    body: JSON.stringify({ mediaUrl }),
  });

// ─── Change Requests & Credit ─────────────────────────────

export type ChangePreview = {
  newTotalDays: number;
  newTotal: number;
  currentTotal: number;
  delta: number;
  requiresApproval: boolean;
  lastPaymentMethod: "CASH" | "CARD" | "TRANSFER" | "STRIPE" | "CREDIT" | null;
};

export type ChangeRequest = {
  id: string;
  reservationId: string;
  requestedById: string;
  newCheckIn: string;
  newCheckOut: string;
  newTotalDays: number;
  newTotalAmount: string;
  deltaAmount: string;
  refundChoice: "STRIPE_REFUND" | "CREDIT" | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  rejectionReason: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  payOnPickup: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChangeRequestWithReservation = ChangeRequest & {
  reservation: ReservationDetail & {
    owner: { id: string; firstName: string; lastName: string; email: string };
    room: { id: string; name: string } | null;
  };
  requestedBy: { id: string; firstName: string; lastName: string };
  approvedBy: { id: string; firstName: string; lastName: string } | null;
};

export const previewChangeRequest = (
  reservationId: string,
  data: { newCheckIn: string; newCheckOut: string }
) =>
  apiFetch<ChangePreview>(`/reservations/${reservationId}/change-requests/preview`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createChangeRequest = (
  reservationId: string,
  data: {
    newCheckIn: string;
    newCheckOut: string;
    refundChoice?: "STRIPE_REFUND" | "CREDIT" | null;
  }
) =>
  apiFetch<{
    request: ChangeRequest;
    requiresApproval: boolean;
    applied?: boolean;
  }>(`/reservations/${reservationId}/change-requests`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const listChangeRequests = (reservationId: string) =>
  apiFetch<ChangeRequest[]>(`/reservations/${reservationId}/change-requests`);

export const listAdminChangeRequests = (status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING") =>
  apiFetch<ChangeRequestWithReservation[]>(`/admin/change-requests?status=${status}`);

export const approveChangeRequest = (id: string) =>
  apiFetch<{ success: true }>(`/admin/change-requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });

export const rejectChangeRequest = (id: string, reason: string) =>
  apiFetch<{ success: true }>(`/admin/change-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const changeRequestPayNowIntent = (
  reservationId: string,
  changeRequestId: string,
) =>
  apiFetch<{ clientSecret: string; paymentIntentId: string }>(
    `/reservations/${reservationId}/change-requests/${changeRequestId}/pay-now-intent`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const changeRequestPayNowConfirm = (
  reservationId: string,
  changeRequestId: string,
  stripePaymentIntentId: string,
) =>
  apiFetch<{ success?: boolean; alreadyConfirmed?: boolean }>(
    `/reservations/${reservationId}/change-requests/${changeRequestId}/pay-now-confirm`,
    {
      method: "POST",
      body: JSON.stringify({ stripePaymentIntentId }),
    },
  );

export const changeRequestPayOnPickup = (
  reservationId: string,
  changeRequestId: string,
) =>
  apiFetch<ChangeRequest>(
    `/reservations/${reservationId}/change-requests/${changeRequestId}/pay-on-pickup`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const staffConfirmChangeRequestPickupPaid = (changeRequestId: string) =>
  apiFetch<{ success: true }>(
    `/staff/change-requests/${changeRequestId}/confirm-pickup-paid`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const cancelReservation = (
  reservationId: string,
  refundChoice: "STRIPE_REFUND" | "CREDIT"
) =>
  apiFetch<{ success: true; refundAmount: number; refundChoice: string }>(
    `/reservations/${reservationId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ refundChoice }),
    }
  );

export const issueRefund = (
  reservationId: string,
  refundChoice: "STRIPE_REFUND" | "CREDIT"
) =>
  apiFetch<{ success: true; refundAmount: number; refundChoice: string }>(
    `/reservations/${reservationId}/issue-refund`,
    {
      method: "POST",
      body: JSON.stringify({ refundChoice }),
    }
  );

export const adminCancelReservation = (reservationId: string) =>
  apiFetch<{
    success: true;
    reservationId: string;
    refundAmount: number;
    awaitingClientChoice: boolean;
  }>(`/admin/reservations/${reservationId}/cancel`, {
    method: "POST",
  });

export type CreditLedgerEntry = {
  id: string;
  type: "CREDIT_ADDED" | "CREDIT_APPLIED" | "CREDIT_ADJUSTED";
  amount: string;
  balanceAfter: string;
  description: string;
  createdAt: string;
  reservationId: string | null;
  changeRequestId: string | null;
};

export const getCreditLedger = () =>
  apiFetch<CreditLedgerEntry[]>(`/users/me/credit-ledger`);

export type MeResponse = User & { creditBalance: string };

export const getMe = () => apiFetch<MeResponse>(`/users/me`);

export const updateMe = (data: { firstName?: string; lastName?: string; phone?: string | null }) =>
  apiFetch<User>(`/users/me`, { method: "PATCH", body: JSON.stringify(data) });

export const exportMyData = () => apiFetch<Record<string, unknown>>(`/users/me/export`);

export const deleteMyAccount = () =>
  apiFetch<{ ok: true }>(`/users/me`, { method: "DELETE" });

// ─── Push tokens ──────────────────────────────────────────

export const registerPushToken = (token: string, platform: "ios" | "android") =>
  apiFetch<{ id: string }>(ENDPOINTS.pushTokens, {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });

export const unregisterPushToken = (token: string) =>
  apiFetch<{ deleted: number }>(
    `${ENDPOINTS.pushTokens}?token=${encodeURIComponent(token)}`,
    { method: "DELETE" }
  );

// ─── Legal / consentimientos ──────────────────────────────

export type LegalDocType =
  | "TOS"
  | "PRIVACY"
  | "IMAGE_USE"
  | "VET_AUTH"
  | "INCIDENT_POLICY";

export type LegalDocument = {
  type: LegalDocType;
  version: string;
  required: boolean;
};

export type LegalAcceptance = {
  id: string;
  userId: string;
  documentType: LegalDocType;
  version: string;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type LegalStatus = {
  canBook: boolean;
  missing: LegalDocType[];
  versions: Record<LegalDocType, string>;
};

export const getLegalDocuments = () =>
  apiFetch<LegalDocument[]>(`${ENDPOINTS.legal}/documents`);

export const getMyLegalStatus = () =>
  apiFetch<LegalStatus>(`${ENDPOINTS.legal}/me/status`);

export const getMyLegalAcceptances = () =>
  apiFetch<LegalAcceptance[]>(`${ENDPOINTS.legal}/me/acceptances`);

export const acceptLegalDocument = (
  documentType: LegalDocType,
  version: string
) =>
  apiFetch<LegalAcceptance>(`${ENDPOINTS.legal}/acceptances`, {
    method: "POST",
    body: JSON.stringify({ documentType, version }),
  });
