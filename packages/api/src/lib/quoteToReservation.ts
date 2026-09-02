/**
 * Cotización → reserva: el prefill.
 *
 * La conversión NO crea la reserva de golpe, y eso es deliberado. Una
 * cotización no puede producir una reserva válida sin que alguien decida cosas
 * que la cotización a propósito no aparta:
 *
 *   · STAY exige `roomId`, y POST /reservations tiene un guard de capacidad que
 *     puede responder 409 ROOM_AT_CAPACITY.
 *   · BATH exige un hueco real en la agenda; entre cotizar y cerrar pasan días
 *     y el horario cotizado casi seguro ya se ocupó (409 AGENDA_CONFLICT).
 *   · `legalAccepted` es obligatorio.
 *   · Un prospecto no tiene cuenta: materializarlo tiene consecuencias (aparece
 *     en el directorio de clientes) y no debe pasar en silencio.
 *
 * Un botón de "convertir" que creara la reserva sola tendría que INVENTAR esas
 * decisiones, y para hacerlo duplicaría medio handler. En vez de eso, esto
 * devuelve el formulario ya lleno: el operador confirma lo que falta y la
 * reserva la crea el mismo POST /reservations de siempre, con sus validaciones,
 * su transacción y sus notificaciones.
 */

import type { QuoteWithRelations } from "./quotes";

export interface QuotePrefill {
  quoteId: string;
  folio: number;
  reservationType: "STAY" | "BATH" | "DAYCARE" | "DELIVERY";
  /**
   * Si esta cotización puede volverse reservación.
   *
   * Una de solo traslado NO: el domicilio siempre viaja pegado a un servicio
   * (vive en las columnas homeDelivery* de `reservations`), así que no hay nada
   * que reservar hasta que el cliente cierre un hospedaje, un baño o una
   * guardería. La UI esconde el botón y explica por qué.
   */
  convertible: boolean;
  noConvertibleMotivo: string | null;

  /** null si la cotización era para un prospecto: hay que darlo de alta antes. */
  ownerId: string | null;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  /** true cuando falta crear al cliente y sus mascotas. */
  needsClient: boolean;

  /** Mascotas ya registradas, en el orden de captura. */
  petIds: string[];
  /** Perros que todavía no existen en la base (solo en cotizaciones a prospectos). */
  newPets: {
    name: string;
    weightKg: number | null;
    size: string | null;
    breed: string | null;
  }[];

  // Fechas listas para el formulario, como "YYYY-MM-DD" / "HH:mm".
  checkIn: string | null;
  checkOut: string | null;
  date: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;

  /** Add-ons cotizados, para volver a marcarlos en el formulario. */
  bath: { deslanado: boolean; corte: boolean } | null;
  deworming: boolean;
  extraHours: number | null;
  hasMedication: boolean;
  medicationNotes: string | null;

  homeDelivery: {
    address: string;
    lat: number;
    lng: number;
    placeId: string | null;
  } | null;

  /**
   * Precio prometido. Se manda como `totalAmountOverride` para que la reserva
   * cobre lo cotizado aunque las tarifas hayan subido en el ínterin.
   *
   * ⚠️ Efecto documentado: con `totalAmountOverride`, POST /reservations NO
   * escribe el desglose (lodgingAmount / medicationFee). No se pierde: el
   * desglose queda en la cotización, enlazada por quote.reservationId.
   */
  quotedTotal: number;
  depositSuggested: number | null;
  discountCode: string | null;

  notes: string | null;
  internalNotes: string | null;

  /** Vencida: los precios pueden haber cambiado. La UI debe advertirlo. */
  isExpired: boolean;
  validUntil: string;
  alreadyConverted: boolean;

  /**
   * Conceptos que YA están cobrados dentro del total pero que el formulario de
   * reserva no sabe crear (desparasitante, horas extra…).
   *
   * Son la trampa cara de la conversión: el total cotizado los incluye, pero la
   * reserva nace sin el add-on. Si nadie lo nota, el servicio no se presta; y si
   * el equipo lo agrega después desde el detalle, `totalAmount` SUBE y el
   * cliente termina pagando dos veces lo mismo. La UI tiene que decirlo, y el
   * texto de `internalNotesSugeridas` deja constancia en la propia reserva.
   */
  pendientes: { label: string; amount: number }[];
  /**
   * Nota interna lista para pegar en la reserva: qué incluye el total cotizado.
   * Va a `internalNotes` (nunca la ve el cliente) para que quien atienda el día
   * del servicio sepa qué está pagado y no lo vuelva a cobrar.
   */
  internalNotesSugeridas: string | null;
}

/** "YYYY-MM-DD" de una fecha guardada en UTC (así se anclaron al cotizar). */
function toYMD(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function buildQuotePrefill(quote: QuoteWithRelations): QuotePrefill {
  // `quote.items` ya trae TODAS las líneas (las de cada perro y las del grupo);
  // `pet.items` es la misma relación vista desde el otro lado. Concatenarlas
  // duplicaba cada concepto — el aviso de pendientes llegaba a decir
  // "Desparasitante ($180), Desparasitante ($180)".
  const items = quote.items;
  const bathItem = items.find((i) => i.kind === "BATH");

  // Deslanado y corte no se guardan como banderas: se deducen de la etiqueta
  // congelada de la línea, que es la que vio el cliente. Leerlos de ahí
  // garantiza que el formulario reproduzca EXACTAMENTE lo cotizado.
  const bath = bathItem
    ? {
        deslanado: /deslanado/i.test(bathItem.label),
        corte: /corte/i.test(bathItem.label),
      }
    : null;

  const extraHoursItem = items.find((i) => i.kind === "EXTRA_HOURS");
  const conMedicamento = quote.pets.some((p) => p.hasMedication);

  // Conceptos cobrados en el total que el formulario de reserva no crea.
  // El baño NO entra: ese sí viaja como `bath` y la reserva lo materializa.
  const PENDIENTES: Record<string, string> = {
    DEWORMING: "Desparasitante",
    EXTRA_HOURS: "Horas extra",
    CUSTOM: "Concepto adicional",
  };
  const pendientes = items
    .filter((i) => PENDIENTES[i.kind] && !i.isCourtesy && Number(i.amount) > 0)
    .map((i) => ({ label: i.label, amount: Number(i.amount) }));

  const avisoPendientes =
    pendientes.length > 0
      ? "El total cotizado YA incluye: " +
        pendientes.map((p) => `${p.label} ($${p.amount})`).join(", ") +
        ". No los vuelvas a cobrar al agregarlos."
      : null;
  const internalNotesSugeridas =
    [quote.internalNotes, avisoPendientes].filter(Boolean).join("\n") || null;

  const soloDomicilio = quote.reservationType === "DELIVERY";

  return {
    quoteId: quote.id,
    folio: quote.folio,
    reservationType: quote.reservationType as QuotePrefill["reservationType"],
    convertible: !soloDomicilio,
    noConvertibleMotivo: soloDomicilio
      ? "Esta cotización es solo del traslado. Para agendarlo, crea la reservación del servicio (hospedaje, baño o guardería) y ahí activa el servicio a domicilio."
      : null,

    ownerId: quote.ownerId,
    clientName: quote.clientName,
    clientPhone: quote.clientPhone,
    clientEmail: quote.clientEmail,
    needsClient: quote.ownerId === null,

    petIds: quote.pets.map((p) => p.petId).filter((id): id is string => Boolean(id)),
    newPets: quote.pets
      .filter((p) => !p.petId)
      .map((p) => ({
        name: p.name,
        weightKg: p.weightKg,
        size: p.size,
        breed: p.breed,
      })),

    checkIn: toYMD(quote.checkIn),
    checkOut: toYMD(quote.checkOut),
    date: toYMD(quote.appointmentAt),
    checkInTime: quote.checkInTime,
    checkOutTime: quote.checkOutTime,

    bath,
    deworming: items.some((i) => i.kind === "DEWORMING"),
    extraHours: extraHoursItem ? Number(extraHoursItem.quantity) : null,
    hasMedication: conMedicamento,
    medicationNotes: quote.pets.find((p) => p.medicationNotes)?.medicationNotes ?? null,

    homeDelivery:
      quote.homeDelivery && quote.homeDeliveryLat != null && quote.homeDeliveryLng != null
        ? {
            address: quote.homeDeliveryAddress ?? "",
            lat: quote.homeDeliveryLat,
            lng: quote.homeDeliveryLng,
            placeId: quote.homeDeliveryPlaceId,
          }
        : null,

    quotedTotal: Number(quote.total),
    depositSuggested:
      quote.depositSuggested != null ? Number(quote.depositSuggested) : null,
    discountCode: quote.discountCodeSnapshot,

    notes: quote.notes,
    internalNotes: quote.internalNotes,

    isExpired: quote.validUntil.getTime() < Date.now(),
    validUntil: quote.validUntil.toISOString(),
    alreadyConverted: quote.status === "CONVERTED",

    pendientes,
    internalNotesSugeridas,
  };
}
