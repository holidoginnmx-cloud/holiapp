/**
 * Cotizaciones — lógica de negocio.
 *
 * Las funciones devuelven UNIONES DE RESULTADO en vez de lanzar o de responder
 * ellas mismas, siguiendo el molde de `applyBathReschedule` (routes/baths.ts):
 * así las tres puertas que las exponen (Clerk para la app móvil, x-cron-secret
 * para el admin web, y la ruta pública) comparten una sola implementación y
 * cada una mapea el resultado a su forma de responder.
 *
 * El cálculo NO vive aquí: es `computeQuote` en @holidoginn/shared, puro y
 * compartido con el preview en vivo del móvil. Aquí se resuelve lo que necesita
 * base de datos (catálogo, descuentos, domicilio) y se persiste.
 */

import { randomBytes } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  computeQuote,
  formatQuoteFolio,
  renderQuoteHtml,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  type CreateQuote,
  type PublicQuote,
  type PublicQuoteLine,
  type QuoteBreakdown,
  type QuoteItemKind,
  type QuotePreviewInput,
} from "@holidoginn/shared";
import { buildPricingSnapshot, loadQuoteCatalog } from "./quoteCatalog";
import { quoteDelivery } from "./delivery";
import { resolveDiscount } from "./discounts";
import { normalizePhone } from "./phone";

// ─── Resultados ──────────────────────────────────────────────

export type QuoteFailure =
  | { ok: false; kind: "BAD_REQUEST"; message: string; code?: string }
  | { ok: false; kind: "NOT_FOUND"; message: string; code?: string }
  | { ok: false; kind: "CONFLICT"; message: string; code?: string };

export type QuoteResult<T> = ({ ok: true } & T) | QuoteFailure;

/** Resultado sin payload (borrar, marcar). */
export type QuoteVoidResult = { ok: true } | QuoteFailure;

const badRequest = (message: string, code?: string): QuoteFailure => ({
  ok: false,
  kind: "BAD_REQUEST",
  message,
  code,
});

// ─── Preview ─────────────────────────────────────────────────

export interface QuotePreviewOutput {
  breakdown: QuoteBreakdown;
  /** Cómo quedó el domicilio tras recotizarlo server-side. */
  delivery: { active: boolean; distanceKm: number; fee: number } | null;
  /** Descuento resuelto, o el motivo por el que el código no aplicó. */
  discount: { code: string; amount: number } | null;
  discountError: string | null;
}

/**
 * Calcula el desglose SIN guardar nada. Es lo que alimenta el total en vivo del
 * formulario, y también el primer paso de `createQuote` — así el número que se
 * ve mientras se captura y el que se persiste salen del mismo camino.
 */
export async function previewQuote(
  prisma: PrismaClient,
  input: QuotePreviewInput
): Promise<QuoteResult<QuotePreviewOutput>> {
  const catalog = await loadQuoteCatalog(prisma);

  // El domicilio SIEMPRE se recotiza aquí desde lat/lng: nunca se confía en un
  // fee que mande el cliente (misma regla que en los endpoints de creación).
  let delivery: QuotePreviewOutput["delivery"] = null;
  if (input.homeDelivery) {
    const q = await quoteDelivery(
      prisma,
      input.homeDelivery.lat,
      input.homeDelivery.lng,
      input.homeDelivery.trip ?? "PICKUP"
    );
    delivery = q;
  }

  // Primera pasada: sin descuento, para conocer el subtotal sobre el que se
  // valida el código (resolveDiscount necesita el subtotal).
  const base = computeQuote(toComputeInput(input, delivery, null), catalog);
  if (!base.ok) return badRequest(base.message, base.code);

  let discount: QuotePreviewOutput["discount"] = null;
  let discountError: string | null = null;
  if (input.discountCode) {
    const resolved = await resolveDiscount(prisma, {
      code: input.discountCode,
      subtotal: base.breakdown.subtotal,
    });
    if (resolved.error) {
      // El código malo NO tumba la cotización: se cotiza sin él y se avisa.
      discountError = resolved.error;
    } else if (resolved.discountCodeId) {
      discount = {
        code: input.discountCode.trim().toUpperCase(),
        amount: resolved.discountTotal,
      };
    }
  }

  const finalResult = discount
    ? computeQuote(toComputeInput(input, delivery, discount), catalog)
    : base;
  if (!finalResult.ok) return badRequest(finalResult.message, finalResult.code);

  return { ok: true, breakdown: finalResult.breakdown, delivery, discount, discountError };
}

/** Traduce el cuerpo HTTP a la entrada del módulo puro de cálculo. */
function toComputeInput(
  input: QuotePreviewInput,
  delivery: { active: boolean; distanceKm: number; fee: number } | null,
  discount: { code: string; amount: number } | null
) {
  return {
    serviceType: input.serviceType,
    pets: input.pets.map((p, i) => ({
      // La clave posicional funciona igual para mascotas reales y para perros
      // de un prospecto (que no tienen id).
      key: p.petId ?? `nuevo-${i}`,
      name: p.name,
      weightKg: p.weightKg ?? null,
      size: p.size ?? null,
      hasMedication: p.hasMedication ?? false,
    })),
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    date: input.date ?? null,
    checkInTime: input.checkInTime ?? null,
    checkOutTime: input.checkOutTime ?? null,
    nightsOverride: input.nightsOverride ?? null,
    bath: input.bath ?? null,
    deworming: input.deworming ?? false,
    probarf: input.probarf ?? false,
    extraHours: input.extraHours ?? null,
    homeDelivery:
      input.homeDelivery && delivery?.active
        ? {
            address: input.homeDelivery.address,
            distanceKm: delivery.distanceKm,
            fee: delivery.fee,
            trip: input.homeDelivery.trip ?? ("PICKUP" as const),
          }
        : null,
    discount,
    courtesy: input.courtesy ?? [],
    customItems: input.customItems ?? [],
    totalOverride: input.totalOverride ?? null,
  };
}

// ─── Crear ───────────────────────────────────────────────────

const QUOTE_INCLUDE = {
  pets: { orderBy: { position: "asc" }, include: { items: { orderBy: { position: "asc" } } } },
  items: { orderBy: { position: "asc" } },
  owner: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export type QuoteWithRelations = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

export async function createQuote(
  prisma: PrismaClient,
  input: CreateQuote,
  actorId: string
): Promise<QuoteResult<{ quote: QuoteWithRelations }>> {
  if (!input.ownerId && !input.clientName.trim()) {
    return badRequest("Indica a quién se le cotiza");
  }

  const preview = await previewQuote(prisma, input);
  if (!preview.ok) return preview;
  const { breakdown, delivery, discount } = preview;

  // El código se guarda referenciado pero NO se consume: incrementar usesCount
  // al cotizar quemaría usos de códigos que nunca cierran. Se revalida y se
  // consume al convertir.
  const discountCodeId = discount
    ? (await prisma.discountCode.findUnique({ where: { code: discount.code } }))?.id ?? null
    : null;

  const catalog = await loadQuoteCatalog(prisma);
  const { anchors, error } = buildDateAnchors(input);
  if (error) return badRequest(error);

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.quote.create({
      data: {
        token: newQuoteToken(),
        reservationType: input.serviceType,
        status: "DRAFT",
        ...anchors,
        totalDays: breakdown.totalDays,
        daycareHours: breakdown.daycareHours,
        ownerId: input.ownerId ?? null,
        clientName: input.clientName.trim(),
        clientPhone: input.clientPhone?.trim() || null,
        clientPhoneNormalized: normalizePhone(input.clientPhone),
        clientEmail: input.clientEmail?.trim() || null,
        subtotal: breakdown.subtotal,
        discountTotal: breakdown.discountTotal,
        deliveryFee: breakdown.deliveryFee,
        total: breakdown.total,
        depositSuggested: input.depositSuggested ?? null,
        discountCodeId,
        discountCodeSnapshot: discount?.code ?? null,
        homeDelivery: Boolean(input.homeDelivery && delivery?.active),
        homeDeliveryAddress: input.homeDelivery?.address ?? null,
        homeDeliveryLat: input.homeDelivery?.lat ?? null,
        homeDeliveryLng: input.homeDelivery?.lng ?? null,
        homeDeliveryPlaceId: input.homeDelivery?.placeId ?? null,
        homeDeliveryDistanceKm: delivery?.distanceKm ?? null,
        // El viaje se persiste porque la fee se RECALCULA al convertir: sin
        // esto, un redondo cotizado se volvería un traslado sencillo (mitad de
        // precio) en la reservación.
        homeDeliveryTrip: input.homeDelivery?.trip ?? "PICKUP",
        validUntil: resolveValidUntil(input.validUntil),
        notes: input.notes?.trim() || null,
        internalNotes: input.internalNotes?.trim() || null,
        pricingSnapshot: buildPricingSnapshot(catalog) as unknown as Prisma.InputJsonValue,
        createdById: actorId,
        source: input.source ?? null,
      },
    });

    // Un QuotePet por mascota, en el orden de captura (el mismo en que se
    // mandarán petIds/roomIds a POST /reservations, que es posicional).
    let itemPosition = 0;
    for (let i = 0; i < input.pets.length; i++) {
      const petInput = input.pets[i];
      const petBreakdown = breakdown.pets[i];
      const quotePet = await tx.quotePet.create({
        data: {
          quoteId: created.id,
          position: i,
          petId: petInput.petId ?? null,
          name: petInput.name.trim(),
          weightKg: petInput.weightKg ?? null,
          size: petBreakdown.size ?? null,
          breed: petInput.breed?.trim() || null,
          hasMedication: petInput.hasMedication ?? false,
          medicationNotes: petInput.medicationNotes?.trim() || null,
          subtotal: petBreakdown.subtotal,
        },
      });
      for (const line of petBreakdown.lines) {
        await tx.quoteItem.create({
          data: lineData(created.id, quotePet.id, line, itemPosition++),
        });
      }
    }

    // Líneas del grupo (domicilio, descuento, conceptos libres): sin quotePetId.
    for (const line of breakdown.lines.filter((l) => l.petKey === null)) {
      await tx.quoteItem.create({
        data: lineData(created.id, null, line, itemPosition++),
      });
    }

    return tx.quote.findUniqueOrThrow({
      where: { id: created.id },
      include: QUOTE_INCLUDE,
    });
  });

  return { ok: true, quote };
}

function lineData(
  quoteId: string,
  quotePetId: string | null,
  line: QuoteBreakdown["lines"][number],
  position: number
): Prisma.QuoteItemUncheckedCreateInput {
  return {
    quoteId,
    quotePetId,
    kind: line.kind,
    position,
    label: line.label,
    detail: line.detail ?? null,
    quantity: line.quantity,
    // OJO: aquí unitPrice es el precio POR UNIDAD. Al mapear a
    // reservation_addons hay que escribir `unitPrice: item.amount`, porque esa
    // tabla guarda el monto total de la línea en ese campo.
    unitPrice: line.unitPrice,
    amount: line.amount,
    listPrice: line.listPrice,
    isCourtesy: line.isCourtesy,
    serviceVariantId: line.serviceVariantId ?? null,
  };
}

/**
 * Token del link público: 128 bits. No es adivinable por fuerza bruta y, a
 * diferencia del folio, no revela el orden de creación (un token secuencial
 * dejaría enumerar las cotizaciones de todos los clientes).
 */
function newQuoteToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Fin del día indicado EN HORA DEL HOTEL, no en UTC.
 *
 * Hermosillo va en UTC-7 todo el año (Sonora no cambia de horario). Un
 * "23:59:59Z" son las 4:59 de la tarde de aquí: una cotización "vigente hasta
 * el 2 de septiembre" se marcaba vencida a media tarde de ese mismo día, con el
 * cliente mirando la fecha impresa en su documento.
 */
function resolveValidUntil(ymd?: string): Date {
  const dia = ymd ?? diaHotelMasDias(DEFAULT_QUOTE_VALIDITY_DAYS);
  // 23:59:59.999 del día `dia` en UTC-7 = 06:59:59.999Z del día siguiente.
  return new Date(`${dia}T23:59:59.999${HOTEL_UTC_OFFSET}`);
}

/** Desfase fijo de la zona del hotel (Hermosillo, sin horario de verano). */
const HOTEL_UTC_OFFSET = "-07:00";

/** "YYYY-MM-DD" del día del hotel dentro de N días. */
function diaHotelMasDias(dias: number): string {
  const ahora = new Date();
  // Se lleva el instante a hora del hotel y se leen sus componentes de fecha.
  const enHotel = new Date(ahora.getTime() - 7 * 60 * 60 * 1000);
  enHotel.setUTCDate(enHotel.getUTCDate() + dias);
  return enHotel.toISOString().slice(0, 10);
}

/**
 * Fechas persistidas con la MISMA semántica que `reservations`, para que la
 * conversión sea un copiado y no una traducción:
 *   STAY    → checkIn/checkOut a 00:00 UTC (así el Math.ceil del handler de
 *             reservas cuenta las mismas noches que nightsBetweenYMD)
 *   BATH    → appointmentAt = inicio de la cita
 *   DAYCARE → appointmentAt anclado a MEDIODÍA UTC
 *   DELIVERY→ el día es opcional (se cotiza un precio, no se aparta agenda) y
 *             cuando viene se ancla a mediodía UTC como los otros puntuales.
 */
function buildDateAnchors(input: CreateQuote): {
  anchors: {
    checkIn: Date | null;
    checkOut: Date | null;
    appointmentAt: Date | null;
    checkInTime: string | null;
    checkOutTime: string | null;
  };
  error?: string;
} {
  const empty = {
    checkIn: null,
    checkOut: null,
    appointmentAt: null,
    checkInTime: input.checkInTime ?? null,
    checkOutTime: input.checkOutTime ?? null,
  };

  if (input.serviceType === "STAY") {
    if (!input.checkIn || !input.checkOut) return { anchors: empty };
    return {
      anchors: {
        ...empty,
        checkIn: new Date(`${input.checkIn}T00:00:00.000Z`),
        checkOut: new Date(`${input.checkOut}T00:00:00.000Z`),
      },
    };
  }

  if (!input.date) return { anchors: empty };
  if (input.serviceType === "DAYCARE") {
    return { anchors: { ...empty, appointmentAt: new Date(`${input.date}T12:00:00.000Z`) } };
  }
  // BATH y DELIVERY: la hora exacta se decide al reservar (la cotización no
  // aparta agenda). Se ancla a mediodía UTC para no sugerir una hora falsa.
  return { anchors: { ...empty, appointmentAt: new Date(`${input.date}T12:00:00.000Z`) } };
}

// ─── Lectura ─────────────────────────────────────────────────

export interface ListQuotesFilters {
  status?: "DRAFT" | "SENT" | "CONVERTED" | "CANCELLED";
  /** "vigentes" = abiertas y no vencidas; "vencidas" = abiertas y ya vencidas. */
  bucket?: "abiertas" | "vigentes" | "vencidas";
  search?: string;
  ownerId?: string;
  take?: number;
  skip?: number;
}

export async function listQuotes(prisma: PrismaClient, filters: ListQuotesFilters) {
  const now = new Date();
  const where: Prisma.QuoteWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.ownerId) where.ownerId = filters.ownerId;

  // La vigencia se DERIVA, no se persiste (no hay estado EXPIRED): filtrarla es
  // una condición sobre validUntil, no sobre status.
  if (filters.bucket === "abiertas") where.status = { in: ["DRAFT", "SENT"] };
  if (filters.bucket === "vigentes") {
    where.status = { in: ["DRAFT", "SENT"] };
    where.validUntil = { gte: now };
  }
  if (filters.bucket === "vencidas") {
    where.status = { in: ["DRAFT", "SENT"] };
    where.validUntil = { lt: now };
  }

  const search = filters.search?.trim();
  if (search) {
    // Buscar por folio numérico o por nombre de cliente/mascota. El folio se
    // teclea como "123" o como "COT-000123".
    //
    // El tope de INT4 no es cosmético: el buscador dice "Folio, cliente o
    // mascota…" y lo primero que pega el equipo ahí es un WhatsApp. Un
    // "662 123 4567" da 6621234567, que excede int4 y hace que Postgres tumbe
    // la consulta ENTERA con un 500 — la lista se queda vacía y no se puede
    // buscar por nada.
    const digits = search.replace(/\D/g, "");
    const folio = digits.length > 0 && digits.length <= 9 ? Number(digits) : NaN;
    where.OR = [
      { clientName: { contains: search, mode: "insensitive" } },
      { pets: { some: { name: { contains: search, mode: "insensitive" } } } },
      // Buscar por teléfono es lo natural con un prospecto: se guarda
      // normalizado justamente para esto.
      ...(digits.length >= 10 ? [{ clientPhoneNormalized: digits.slice(-10) }] : []),
      ...(Number.isSafeInteger(folio) && folio > 0 ? [{ folio }] : []),
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: Math.min(filters.take ?? 30, 100),
      skip: filters.skip ?? 0,
    }),
    prisma.quote.count({ where }),
  ]);

  return { quotes: rows, total };
}

export async function getQuote(
  prisma: PrismaClient,
  id: string
): Promise<QuoteResult<{ quote: QuoteWithRelations }>> {
  const quote = await prisma.quote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
  if (!quote) return { ok: false, kind: "NOT_FOUND", message: "Cotización no encontrada" };
  return { ok: true, quote };
}

export async function getQuoteByToken(
  prisma: PrismaClient,
  token: string
): Promise<QuoteWithRelations | null> {
  return prisma.quote.findUnique({ where: { token }, include: QUOTE_INCLUDE });
}

// ─── Mutaciones de estado ────────────────────────────────────

export async function updateQuote(
  prisma: PrismaClient,
  id: string,
  patch: {
    status?: "DRAFT" | "SENT" | "CONVERTED" | "CANCELLED";
    validUntil?: string;
    notes?: string | null;
    internalNotes?: string | null;
    clientPhone?: string | null;
    clientEmail?: string | null;
    depositSuggested?: number | null;
  }
): Promise<QuoteResult<{ quote: QuoteWithRelations }>> {
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return { ok: false, kind: "NOT_FOUND", message: "Cotización no encontrada" };

  // Una cotización convertida es un documento histórico: ya hay una reserva
  // colgando de ella y su precio se cobró.
  if (existing.status === "CONVERTED") {
    return {
      ok: false,
      kind: "CONFLICT",
      message: "Esta cotización ya se convirtió en reservación y no se puede editar",
      code: "QUOTE_CONVERTED",
    };
  }
  // Marcar CONVERTED a mano saltaría la creación de la reserva.
  if (patch.status === "CONVERTED") {
    return badRequest("Para convertirla, crea la reservación desde la cotización");
  }

  const quote = await prisma.quote.update({
    where: { id },
    data: {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.validUntil !== undefined
        ? { validUntil: resolveValidUntil(patch.validUntil) }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.internalNotes !== undefined
        ? { internalNotes: patch.internalNotes?.trim() || null }
        : {}),
      ...(patch.clientPhone !== undefined
        ? {
            clientPhone: patch.clientPhone?.trim() || null,
            clientPhoneNormalized: normalizePhone(patch.clientPhone),
          }
        : {}),
      ...(patch.clientEmail !== undefined
        ? { clientEmail: patch.clientEmail?.trim() || null }
        : {}),
      ...(patch.depositSuggested !== undefined
        ? { depositSuggested: patch.depositSuggested }
        : {}),
    },
    include: QUOTE_INCLUDE,
  });
  return { ok: true, quote };
}

/** Sella el envío. Se llama cuando el operador comparte el link o el PDF. */
export async function markQuoteSent(
  prisma: PrismaClient,
  id: string
): Promise<QuoteResult<{ quote: QuoteWithRelations }>> {
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return { ok: false, kind: "NOT_FOUND", message: "Cotización no encontrada" };
  if (existing.status === "CANCELLED") {
    return badRequest("Esta cotización está cancelada");
  }

  const quote = await prisma.quote.update({
    where: { id },
    data: {
      // DRAFT → SENT solo la primera vez; reenviar una convertida no la
      // regresa a SENT.
      ...(existing.status === "DRAFT" ? { status: "SENT" as const } : {}),
      sentAt: existing.sentAt ?? new Date(),
      sentCount: { increment: 1 },
    },
    include: QUOTE_INCLUDE,
  });
  return { ok: true, quote };
}

/**
 * Cierra el círculo cuando la cotización produjo una reserva. La llama
 * POST /reservations cuando el cuerpo trae `quoteId`, en fire-and-forget: que
 * falle marcar la cotización NUNCA debe tumbar la creación de la reserva, que
 * es lo que de verdad importa.
 */
export async function markQuoteConverted(
  prisma: PrismaClient,
  quoteId: string,
  reservation: { id: string; groupId: string | null },
  actorId: string | null
): Promise<void> {
  try {
    const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
    if (!existing || existing.status === "CONVERTED") return;
    await prisma.quote.update({
      where: { id: quoteId },
      data: {
        status: "CONVERTED",
        convertedAt: new Date(),
        // El admin web crea la reserva por su cuenta y no aporta el id; lo que
        // importa es que la cotización deje de estar vigente.
        reservationId: reservation.id || null,
        reservationGroupId: reservation.groupId,
        convertedById: actorId,
      },
    });
  } catch (err) {
    console.error(`[quotes] no se pudo marcar ${quoteId} como convertida:`, err);
  }
}

export async function deleteQuote(
  prisma: PrismaClient,
  id: string
): Promise<QuoteVoidResult> {
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return { ok: false, kind: "NOT_FOUND", message: "Cotización no encontrada" };
  if (existing.status === "CONVERTED") {
    return {
      ok: false,
      kind: "CONFLICT",
      message: "No se puede borrar una cotización que ya generó una reservación",
      code: "QUOTE_CONVERTED",
    };
  }
  await prisma.quote.delete({ where: { id } });
  return { ok: true };
}

// ─── Vistas del cliente ──────────────────────────────────────

// El scraper de WhatsApp abre el link para armar la tarjeta de preview. Contar
// eso como "el cliente la vio" convierte la señal de venta en ruido.
const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram|twitter|linkedin|embed/i;

export function isBotUserAgent(ua?: string | null): boolean {
  return !ua || BOT_UA.test(ua);
}

/** Registra una visita real (no de bot). Nunca bloquea la respuesta. */
export async function registerQuoteView(
  prisma: PrismaClient,
  quoteId: string,
  hadFirstView: boolean
): Promise<void> {
  try {
    await prisma.quote.update({
      where: { id: quoteId },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
        ...(hadFirstView ? {} : { firstViewedAt: new Date() }),
      },
    });
  } catch (err) {
    console.error(`[quotes] no se pudo registrar la vista de ${quoteId}:`, err);
  }
}

// ─── DTO público ─────────────────────────────────────────────

export interface PublicQuoteContext {
  hotelName: string;
  hotelPhone: string;
  whatsappNumber: string;
}

/**
 * Lo ÚNICO que sale hacia el cliente, construido campo por campo.
 *
 * Es una ALLOWLIST a propósito, no un borrado como el de stripInternal.ts. Esa
 * política (quitar campos del objeto) es correcta en rutas autenticadas donde
 * el include es grande y cambia seguido; aquí la ruta es ANÓNIMA, así que una
 * columna nueva en `quotes` viajaría al público por default. Con allowlist, lo
 * nuevo no sale a menos que alguien lo agregue aquí a propósito.
 *
 * Nunca agregar: internalNotes, courtesyReason, pricingSnapshot, createdById,
 * ownerId, clientEmail, ni ids internos.
 */
export function buildPublicQuote(
  quote: QuoteWithRelations,
  ctx: PublicQuoteContext
): PublicQuote {
  const isExpired = quote.validUntil.getTime() < Date.now();
  const folio = formatQuoteFolio(quote.folio);

  return {
    folio: quote.folio,
    serviceType: quote.reservationType as PublicQuote["serviceType"],
    status: quote.status,
    clientName: quote.clientName,
    createdAt: quote.createdAt.toISOString(),
    validUntil: quote.validUntil.toISOString(),
    isExpired,

    checkIn: quote.checkIn?.toISOString() ?? null,
    checkOut: quote.checkOut?.toISOString() ?? null,
    appointmentAt: quote.appointmentAt?.toISOString() ?? null,
    checkInTime: quote.checkInTime,
    checkOutTime: quote.checkOutTime,
    totalDays: quote.totalDays,
    daycareHours: quote.daycareHours,

    pets: quote.pets.map((pet) => ({
      name: pet.name,
      breed: pet.breed,
      weightKg: pet.weightKg,
      subtotal: Number(pet.subtotal),
      lines: pet.items.map(toPublicLine),
    })),
    groupLines: quote.items.filter((i) => i.quotePetId === null).map(toPublicLine),

    subtotal: Number(quote.subtotal),
    discountTotal: Number(quote.discountTotal),
    deliveryFee: Number(quote.deliveryFee),
    total: Number(quote.total),
    depositSuggested: quote.depositSuggested != null ? Number(quote.depositSuggested) : null,

    notes: quote.notes,

    hotelName: ctx.hotelName,
    hotelPhone: ctx.hotelPhone,
    whatsappUrl: buildClientWhatsappUrl(ctx.whatsappNumber, folio),
  };
}

/** Línea pública: sin `courtesyReason`, que es del equipo. */
function toPublicLine(item: QuoteWithRelations["items"][number]): PublicQuoteLine {
  return {
    kind: item.kind as QuoteItemKind,
    label: item.label,
    detail: item.detail,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    amount: Number(item.amount),
    isCourtesy: item.isCourtesy,
    listPrice: Number(item.listPrice),
  };
}

/** CTA de la página pública: el CLIENTE le escribe AL HOTEL, citando el folio. */
function buildClientWhatsappUrl(hotelNumber: string, folio: string): string {
  const texto = `Hola, quiero reservar con la cotización ${folio}`;
  return `https://wa.me/${hotelNumber}?text=${encodeURIComponent(texto)}`;
}

/** HTML del documento, listo para servir o para pasarle a expo-print. */
export function renderQuote(
  quote: QuoteWithRelations,
  ctx: PublicQuoteContext,
  target: "web" | "pdf" = "web"
): { dto: PublicQuote; html: string } {
  const dto = buildPublicQuote(quote, ctx);
  return { dto, html: renderQuoteHtml(dto, { target }) };
}

// ─── Mensaje para el operador ────────────────────────────────

/**
 * Mensaje que el EQUIPO le manda al cliente por WhatsApp (destinatario
 * prellenado, link incluido). Distinto de `buildClientWhatsappUrl`, que es el
 * botón dentro de la página pública y va en sentido contrario.
 */
export function buildWhatsappMessage(quote: {
  folio: number;
  clientName: string;
  total: number | string;
  serviceType: string;
}, publicUrl: string): string {
  const nombre = quote.clientName.split(" ")[0] || quote.clientName;
  const servicio =
    quote.serviceType === "STAY"
      ? "del hospedaje"
      : quote.serviceType === "BATH"
        ? "de la estética"
        : quote.serviceType === "DELIVERY"
          ? "del servicio a domicilio"
          : "de la guardería";
  // Una cotización de solo traslado puede ir dirigida a alguien que todavía no
  // tiene perro con nosotros: "para tu peludo" ahí suena a mensaje equivocado.
  const cierrePeludo = quote.serviceType === "DELIVERY" ? "" : " para tu peludo 🐾";
  return [
    `¡Hola ${nombre}! Te comparto la cotización ${servicio}${cierrePeludo}`,
    "",
    `${formatQuoteFolio(quote.folio)} · Total $${Number(quote.total).toLocaleString("es-MX")}`,
    publicUrl,
    "",
    "Cualquier duda, aquí estoy. — Holidog Inn",
  ].join("\n");
}

/** URL pública de la cotización, en el dominio del hotel. */
export function publicQuoteUrl(token: string): string {
  const base = (process.env.PUBLIC_SITE_URL ?? "https://holidoginn.com.mx").replace(/\/$/, "");
  return `${base}/cotizacion/${token}`;
}
