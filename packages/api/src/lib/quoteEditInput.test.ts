import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { buildQuoteEditInput } from "./quoteToReservation";
import type { QuoteWithRelations } from "./quotes";

/**
 * `buildQuoteEditInput` es lo que hidrata el formulario al EDITAR una
 * cotización (PUT /quotes/:id, mismo folio y mismo link). Su contrato es un
 * round-trip: lo que devuelve, mandado tal cual de vuelta, tiene que reproducir
 * la cotización que se leyó. Si un campo se pierde aquí, el equipo abre la
 * cotización para corregir la fecha y GUARDA una distinta —sin el desparasitante,
 * sin el domicilio— sobre el link que el cliente ya tiene abierto.
 */

const D = (n: number) => new Prisma.Decimal(n);

function item(over: Partial<QuoteWithRelations["items"][number]>) {
  return {
    id: "it_" + Math.random().toString(36).slice(2),
    quoteId: "q1",
    quotePetId: null,
    kind: "LODGING",
    position: 0,
    label: "Hospedaje · 2 noches",
    detail: null,
    quantity: D(1),
    unitPrice: D(350),
    amount: D(700),
    listPrice: D(700),
    isCourtesy: false,
    ...over,
  } as QuoteWithRelations["items"][number];
}

/** La cotización de Mariana Ramos: hospedaje 2 noches + domicilio redondo. */
function quoteBase(over: Partial<QuoteWithRelations> = {}): QuoteWithRelations {
  return {
    id: "q1",
    folio: 7,
    token: "tok",
    status: "SENT",
    reservationType: "STAY",
    checkIn: new Date("2026-10-06T00:00:00.000Z"),
    checkOut: new Date("2026-10-08T00:00:00.000Z"),
    appointmentAt: null,
    checkInTime: null,
    checkOutTime: null,
    totalDays: 2,
    daycareHours: null,
    ownerId: null,
    clientName: "Mariana Ramos",
    clientPhone: "6624763144",
    clientPhoneNormalized: "6624763144",
    clientEmail: null,
    subtotal: D(700),
    discountTotal: D(0),
    deliveryFee: D(505.64),
    total: D(1205.64),
    depositSuggested: D(350),
    discountCodeId: null,
    discountCodeSnapshot: null,
    discountPercent: null,
    homeDelivery: true,
    homeDeliveryAddress: "Chardonnay 23, Villa de Parras, Hermosillo",
    homeDeliveryLat: 29.05,
    homeDeliveryLng: -110.95,
    homeDeliveryPlaceId: "place_1",
    homeDeliveryDistanceKm: 10.1,
    homeDeliveryTrip: "ROUND_TRIP",
    validUntil: new Date("2026-10-05T00:00:00.000Z"),
    notes: "Incluye transporte",
    internalNotes: "Prospecto de Instagram",
    pricingSnapshot: null,
    createdById: "u1",
    source: "APP_ADMIN",
    sentAt: new Date("2026-09-28T19:27:00.000Z"),
    sentCount: 1,
    firstViewedAt: null,
    lastViewedAt: null,
    viewCount: 2,
    revisedAt: null,
    revisionCount: 0,
    revisedById: null,
    convertedAt: null,
    reservationId: null,
    reservationGroupId: null,
    convertedById: null,
    createdAt: new Date("2026-09-28T19:20:00.000Z"),
    updatedAt: new Date("2026-09-28T19:27:00.000Z"),
    pets: [
      {
        id: "qp1",
        quoteId: "q1",
        position: 0,
        petId: "pet_hodi",
        name: "Hodi Ramos",
        weightKg: 19,
        size: "S",
        breed: null,
        hasMedication: false,
        medicationNotes: null,
        subtotal: D(700),
        items: [],
      },
    ],
    items: [
      item({ kind: "LODGING", quotePetId: "qp1" }),
      item({
        kind: "HOME_DELIVERY",
        position: 1,
        label: "Servicio a domicilio · redondo",
        amount: D(505.64),
        listPrice: D(505.64),
        unitPrice: D(505.64),
      }),
    ],
    owner: null,
    createdBy: { id: "u1", firstName: "Javi", lastName: "Oviedo" },
    ...over,
  } as unknown as QuoteWithRelations;
}

describe("buildQuoteEditInput — el formulario vuelve tal como se cotizó", () => {
  it("conserva servicio, fechas, perro y contacto", () => {
    const input = buildQuoteEditInput(quoteBase());
    expect(input.serviceType).toBe("STAY");
    expect(input.checkIn).toBe("2026-10-06");
    expect(input.checkOut).toBe("2026-10-08");
    expect(input.clientName).toBe("Mariana Ramos");
    expect(input.clientPhone).toBe("6624763144");
    expect(input.pets).toEqual([
      expect.objectContaining({ petId: "pet_hodi", name: "Hodi Ramos", weightKg: 19, size: "S" }),
    ]);
  });

  it("conserva el domicilio CON su viaje: un redondo no puede volver sencillo", () => {
    // El redondo vale el doble. Si el viaje se perdiera al reeditar, corregir la
    // fecha le bajaría a la mitad el traslado sin que nadie lo pidiera.
    const input = buildQuoteEditInput(quoteBase());
    expect(input.homeDelivery).toMatchObject({
      address: "Chardonnay 23, Villa de Parras, Hermosillo",
      lat: 29.05,
      lng: -110.95,
      placeId: "place_1",
      trip: "ROUND_TRIP",
    });
  });

  it("NO repone el total pactado a mano", () => {
    // Un totalOverride viejo sobre servicios nuevos congelaría un precio que ya
    // no corresponde. Se deja vacío a propósito: el operador lo reescribe.
    expect(buildQuoteEditInput(quoteBase()).totalOverride).toBeNull();
  });

  it("lee el deslanado y el corte de la etiqueta congelada del baño", () => {
    const q = quoteBase({
      items: [item({ kind: "BATH", label: "Baño con deslanado y corte de uñas" })],
    } as Partial<QuoteWithRelations>);
    expect(buildQuoteEditInput(q).bath).toEqual({ deslanado: true, corte: true });
  });

  it("recupera el desparasitante y los conceptos libres", () => {
    const q = quoteBase({
      items: [
        item({ kind: "DEWORMING", label: "Desparasitante" }),
        item({
          kind: "CUSTOM",
          label: "Traslado al veterinario",
          detail: "ida y vuelta",
          quantity: D(2),
          unitPrice: D(150),
          amount: D(300),
        }),
      ],
    } as Partial<QuoteWithRelations>);
    const input = buildQuoteEditInput(q);
    expect(input.deworming).toBe(true);
    expect(input.customItems).toEqual([
      { label: "Traslado al veterinario", detail: "ida y vuelta", quantity: 2, unitPrice: 150 },
    ]);
  });

  it("recupera las cortesías, que viven como línea en $0 y no como bandera", () => {
    const q = quoteBase({
      items: [item({ kind: "BATH", label: "Baño", amount: D(0), isCourtesy: true })],
    } as Partial<QuoteWithRelations>);
    expect(buildQuoteEditInput(q).courtesy).toEqual(["BATH"]);
  });

  it("solo manda las noches a mano cuando NO hay fechas", () => {
    // Con fechas, las noches se derivan; repetirlas como override las fijaría y
    // cambiar la salida ya no movería el precio — que es justo lo que se corrige.
    expect(buildQuoteEditInput(quoteBase()).nightsOverride).toBeNull();

    const sinFechas = quoteBase({ checkIn: null, checkOut: null, totalDays: 5 } as Partial<QuoteWithRelations>);
    expect(buildQuoteEditInput(sinFechas).nightsOverride).toBe(5);
  });

  it("repone el descuento por porcentaje como número, no como Decimal", () => {
    // Sin esto, editar una cotización con 10% para mover la fecha la guardaría
    // SIN descuento sobre la liga que el cliente ya tiene.
    expect(buildQuoteEditInput(quoteBase()).discountPercent).toBeNull();

    const conDescuento = quoteBase({
      discountTotal: D(70),
      discountPercent: D(10),
    } as Partial<QuoteWithRelations>);
    expect(buildQuoteEditInput(conDescuento).discountPercent).toBe(10);
  });
});
