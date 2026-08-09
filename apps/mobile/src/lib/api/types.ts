import type {
  Pet,
  Vaccine,
  Reservation,
  StayUpdate,
  Room,
  Payment,
  Review,
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
  /** Hospedaje que incluye un baño (addon BATH). Lo envía el backend; si aún
   * no llega, el frontend cae a hasDeslanado/hasCorte como aproximación. */
  hasBath?: boolean;
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
  // Cantidad para addons cobrados por unidad (EXTRA_HOURS: nº de horas;
  // unitPrice = monto total). Null = 1 implícito.
  quantity: number | null;
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

export type BathSelectionsByPet = Record<string, { deslanado: boolean; corte: boolean }>;
export type MedicationByPet = Record<string, { notes: string }>;

// Servicio a domicilio — el cliente manda dirección + coordenadas (de Google
// Places vía proxy); el backend SIEMPRE recalcula la tarifa server-side.
export type HomeDeliveryInput = {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
};
