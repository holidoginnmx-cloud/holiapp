import { ENDPOINTS } from "@/constants/api";
import { apiFetch } from "./client";
import type {
  QuoteBreakdown,
  QuoteItemKind,
  QuotePreviewInput,
} from "@holidoginn/shared";

// ─── Cotizaciones ────────────────────────────────────────────
// El precio SIEMPRE lo calcula el servidor (POST /quotes/preview): la pantalla
// no suma nada por su cuenta. Es lo que garantiza que el número que ve el
// operador mientras captura sea el mismo que se guarda y el que se le promete
// al cliente en el PDF.

export type QuoteStatus = "DRAFT" | "SENT" | "CONVERTED" | "CANCELLED";

export type QuotePetRow = {
  id: string;
  position: number;
  petId: string | null;
  name: string;
  weightKg: number | null;
  size: string | null;
  breed: string | null;
  hasMedication: boolean;
  medicationNotes: string | null;
  subtotal: string;
  items: QuoteItemRow[];
};

export type QuoteItemRow = {
  id: string;
  quotePetId: string | null;
  kind: QuoteItemKind;
  position: number;
  label: string;
  detail: string | null;
  quantity: string;
  unitPrice: string;
  amount: string;
  listPrice: string;
  isCourtesy: boolean;
  serviceVariantId: string | null;
};

export type QuoteRow = {
  id: string;
  folio: number;
  token: string;
  status: QuoteStatus;
  reservationType: "STAY" | "BATH" | "DAYCARE";
  checkIn: string | null;
  checkOut: string | null;
  appointmentAt: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  totalDays: number | null;
  daycareHours: number | null;
  ownerId: string | null;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  depositSuggested: string | null;
  homeDelivery: boolean;
  homeDeliveryAddress: string | null;
  validUntil: string;
  notes: string | null;
  internalNotes: string | null;
  sentAt: string | null;
  sentCount: number;
  firstViewedAt: string | null;
  viewCount: number;
  convertedAt: string | null;
  reservationId: string | null;
  createdAt: string;
  pets: QuotePetRow[];
  items: QuoteItemRow[];
  owner: { id: string; firstName: string; lastName: string; phone: string | null } | null;
};

/**
 * Formulario de reserva ya lleno con lo cotizado. Lo arma el SERVIDOR (ver
 * packages/api/src/lib/quoteToReservation.ts) para que móvil y web precarguen
 * exactamente lo mismo. Lo que NO trae es lo que la cotización a propósito no
 * aparta: cuarto y hora exacta de la cita.
 */
export type QuotePrefill = {
  quoteId: string;
  folio: number;
  reservationType: "STAY" | "BATH" | "DAYCARE";
  ownerId: string | null;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  /** true = era un prospecto; hay que darlo de alta antes de reservar. */
  needsClient: boolean;
  petIds: string[];
  newPets: { name: string; weightKg: number | null; size: string | null; breed: string | null }[];
  checkIn: string | null;
  checkOut: string | null;
  date: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  bath: { deslanado: boolean; corte: boolean } | null;
  deworming: boolean;
  extraHours: number | null;
  hasMedication: boolean;
  medicationNotes: string | null;
  homeDelivery: { address: string; lat: number; lng: number; placeId: string | null } | null;
  /** Precio prometido: viaja como totalAmountOverride al crear la reserva. */
  quotedTotal: number;
  depositSuggested: number | null;
  discountCode: string | null;
  notes: string | null;
  internalNotes: string | null;
  isExpired: boolean;
  validUntil: string;
  alreadyConverted: boolean;
  /** Conceptos ya cobrados en el total que la reserva no crea sola. */
  pendientes: { label: string; amount: number }[];
  /** Nota interna sugerida: deja constancia de qué incluye el total cotizado. */
  internalNotesSugeridas: string | null;
};

/** Detalle: la cotización más lo que la pantalla necesita para compartirla. */
export type QuoteDetail = {
  quote: QuoteRow;
  publicUrl: string;
  /** Texto ya armado por el servidor: móvil y web mandan el mismo mensaje. */
  whatsappMessage: string;
  isExpired: boolean;
  prefill: QuotePrefill;
};

export type QuoteListItem = QuoteRow & { publicUrl: string; isExpired: boolean };

export type QuotePreviewResult = {
  breakdown: QuoteBreakdown;
  delivery: { active: boolean; distanceKm: number; fee: number } | null;
  discount: { code: string; amount: number } | null;
  /** El código no aplicó: se cotiza sin él y se le avisa al operador. */
  discountError: string | null;
};

export const previewQuote = (input: QuotePreviewInput) =>
  apiFetch<QuotePreviewResult>(`${ENDPOINTS.quotes}/preview`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const createQuote = (input: Record<string, unknown>) =>
  apiFetch<QuoteDetail>(ENDPOINTS.quotes, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getQuotes = (params?: {
  bucket?: "abiertas" | "vigentes" | "vencidas";
  status?: QuoteStatus;
  q?: string;
}) => {
  const query = new URLSearchParams();
  if (params?.bucket) query.set("bucket", params.bucket);
  if (params?.status) query.set("status", params.status);
  if (params?.q) query.set("q", params.q);
  const qs = query.toString();
  return apiFetch<{ total: number; quotes: QuoteListItem[] }>(
    `${ENDPOINTS.quotes}${qs ? `?${qs}` : ""}`,
  );
};

export const getQuote = (id: string) =>
  apiFetch<QuoteDetail>(`${ENDPOINTS.quotes}/${id}`);

export const updateQuote = (id: string, patch: Record<string, unknown>) =>
  apiFetch<QuoteDetail>(`${ENDPOINTS.quotes}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

/** Sella el envío (DRAFT → SENT). Se llama al compartir el link o el PDF. */
export const markQuoteSent = (id: string) =>
  apiFetch<QuoteDetail>(`${ENDPOINTS.quotes}/${id}/send`, { method: "POST" });

export const cancelQuote = (id: string) =>
  apiFetch<QuoteDetail>(`${ENDPOINTS.quotes}/${id}/cancel`, { method: "POST" });

export const deleteQuote = (id: string) =>
  apiFetch<void>(`${ENDPOINTS.quotes}/${id}`, { method: "DELETE" });

/**
 * El documento tal como lo ve el cliente. `target: "pdf"` esconde los botones.
 * El HTML lo renderiza la API (no la app) para que el diseño se pueda iterar
 * con un deploy y un binario viejo nunca produzca un PDF con otro formato.
 */
export const getQuoteHtml = (id: string, target: "web" | "pdf" = "pdf") =>
  apiFetch<{ quote: unknown; html: string; publicUrl: string }>(
    `${ENDPOINTS.quotes}/${id}/html?target=${target}`,
  );
