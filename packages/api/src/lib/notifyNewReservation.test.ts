import { describe, expect, it } from "vitest";

import {
  buildNewReservationMessage,
  type NewReservationRow,
} from "./notifyNewReservation";

// El punto frágil de todo esto es la zona horaria. `checkIn` guarda el DÍA a
// las 00:00 UTC; `appointmentAt` de un baño es un instante real en hora del
// hotel (UTC-7 fijo). Mezclar las dos convenciones corre el "¡Llegada HOY!" un
// día — que es exactamente el aviso que no puede fallar.

const owner = { firstName: "Mayra Leticia", lastName: "Martinez Davila" };

/** Día a las 00:00 UTC, como lo guarda Prisma para checkIn/checkOut. */
const utcDay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
/** Instante real a una hora local del hotel (UTC-7). */
const hotelTime = (ymd: string, hhmm: string) =>
  new Date(`${ymd}T${hhmm}:00.000-07:00`);

const stay = (over: Partial<NewReservationRow> = {}): NewReservationRow => ({
  id: "res_1",
  reservationType: "STAY",
  checkIn: utcDay("2026-08-21"),
  checkOut: utcDay("2026-08-24"),
  totalDays: 3,
  pet: { name: "Loki" },
  room: { name: "Cuarto 01" },
  ...over,
});

describe("buildNewReservationMessage — hospedaje", () => {
  it("marca urgente cuando el check-in es HOY, aun de madrugada en el hotel", () => {
    // 2026-08-21 01:00 del hotel = 08:00 UTC del mismo día. Si el día del
    // check-in se leyera en hora local en vez de UTC, esto saldría "mañana".
    const msg = buildNewReservationMessage({
      reservations: [stay()],
      owner,
      now: hotelTime("2026-08-21", "01:00"),
    });

    expect(msg.urgent).toBe(true);
    expect(msg.relDay).toBe("HOY");
    expect(msg.title).toBe("🚨 ¡Llegada HOY! Nueva reservación");
    expect(msg.body).toContain("Loki");
    expect(msg.body).toContain("Entra HOY 21 ago");
    expect(msg.body).toContain("Cuarto 01");
    // El nombre del cliente solo va en la variante urgente: es para poder
    // llamarle sin abrir la app.
    expect(msg.body).toContain("Mayra Leticia Martinez Davila");
  });

  it("marca urgente cuando el check-in es MAÑANA", () => {
    const msg = buildNewReservationMessage({
      reservations: [stay()],
      owner,
      now: hotelTime("2026-08-20", "15:00"),
    });

    expect(msg.urgent).toBe(true);
    expect(msg.relDay).toBe("MAÑANA");
    expect(msg.title).toBe("🚨 ¡Llegada MAÑANA! Nueva reservación");
  });

  it("NO es urgente a dos días de distancia, y ahí sí muestra las noches", () => {
    const msg = buildNewReservationMessage({
      reservations: [stay()],
      owner,
      now: hotelTime("2026-08-19", "15:00"),
    });

    expect(msg.urgent).toBe(false);
    expect(msg.relDay).toBeNull();
    expect(msg.title).toBe("🐾 Nueva reservación");
    expect(msg.body).toBe("Loki — Entra 21 ago (3 noches)");
  });

  it("no es urgente el día siguiente al check-in (una reserva ya pasada)", () => {
    const msg = buildNewReservationMessage({
      reservations: [stay()],
      owner,
      now: hotelTime("2026-08-22", "10:00"),
    });

    expect(msg.urgent).toBe(false);
  });

  it("singulariza 'noche' cuando es una sola", () => {
    const msg = buildNewReservationMessage({
      reservations: [stay({ totalDays: 1 })],
      owner,
      now: hotelTime("2026-08-10", "10:00"),
    });

    expect(msg.body).toContain("(1 noche)");
  });
});

describe("buildNewReservationMessage — multi-perro", () => {
  it("junta los nombres en un solo mensaje", () => {
    const msg = buildNewReservationMessage({
      reservations: [
        stay({ id: "a", pet: { name: "Loki" } }),
        stay({ id: "b", pet: { name: "Nala" } }),
      ],
      owner,
      now: hotelTime("2026-08-19", "10:00"),
    });

    expect(msg.body).toContain("Loki, Nala");
  });

  it("omite el cuarto cuando el grupo quedó repartido en varios", () => {
    const msg = buildNewReservationMessage({
      reservations: [
        stay({ id: "a", pet: { name: "Loki" }, room: { name: "Cuarto 01" } }),
        stay({ id: "b", pet: { name: "Nala" }, room: { name: "Cuarto 02" } }),
      ],
      owner,
      now: hotelTime("2026-08-21", "09:00"),
    });

    expect(msg.urgent).toBe(true);
    expect(msg.body).not.toContain("Cuarto");
  });
});

describe("buildNewReservationMessage — baño", () => {
  const bath = (appointmentAt: Date): NewReservationRow => ({
    id: "res_bath",
    reservationType: "BATH",
    appointmentAt,
    pet: { name: "Loki" },
  });

  it("usa el día del HOTEL, no el UTC, para decidir la urgencia", () => {
    // 20:00 del hotel el día 20 = 03:00 UTC del día 21. Leído en UTC, una cita
    // de esa noche parecería ser "mañana" cuando en realidad es hoy.
    const msg = buildNewReservationMessage({
      reservations: [bath(hotelTime("2026-08-20", "20:00"))],
      owner,
      bathLabel: "Baño + Corte",
      price: 450,
      now: hotelTime("2026-08-20", "09:00"),
    });

    expect(msg.urgent).toBe(true);
    expect(msg.relDay).toBe("HOY");
    expect(msg.title).toBe("🚨 ¡Baño HOY! Nueva cita");
  });

  it("no urgente: muestra fecha, servicio y precio", () => {
    const msg = buildNewReservationMessage({
      reservations: [bath(hotelTime("2026-08-21", "11:30"))],
      owner,
      bathLabel: "Baño + Corte",
      price: 450,
      now: hotelTime("2026-08-18", "09:00"),
    });

    expect(msg.urgent).toBe(false);
    expect(msg.title).toBe("🐾 Nueva cita de baño");
    expect(msg.body).toContain("Baño + Corte");
    expect(msg.body).toContain("$450");
  });
});

describe("buildNewReservationMessage — guardería", () => {
  const daycare = (ymd: string): NewReservationRow => ({
    id: "res_day",
    reservationType: "DAYCARE",
    // La guardería ancla el día a mediodía UTC (ver daycareCreate).
    appointmentAt: new Date(`${ymd}T12:00:00.000Z`),
    checkInTime: "09:00",
    checkOutTime: "17:00",
    pet: { name: "Loki" },
  });

  it("urgente el mismo día", () => {
    const msg = buildNewReservationMessage({
      reservations: [daycare("2026-08-21")],
      owner,
      now: hotelTime("2026-08-21", "07:00"),
    });

    expect(msg.urgent).toBe(true);
    expect(msg.title).toBe("🚨 ¡Guardería HOY! Nueva reserva");
    expect(msg.body).toContain("HOY 09:00–17:00");
  });

  it("no urgente: fecha + horario", () => {
    const msg = buildNewReservationMessage({
      reservations: [daycare("2026-08-25")],
      owner,
      now: hotelTime("2026-08-21", "07:00"),
    });

    expect(msg.urgent).toBe(false);
    expect(msg.title).toBe("🐾 Nueva guardería");
    expect(msg.body).toBe("Loki — 25 ago · 09:00–17:00");
  });
});

describe("buildNewReservationMessage — casos degenerados", () => {
  it("aguanta una reserva sin fecha ni mascota", () => {
    const msg = buildNewReservationMessage({
      reservations: [{ id: "x", reservationType: "STAY" }],
      owner: {},
      now: hotelTime("2026-08-21", "10:00"),
    });

    expect(msg.urgent).toBe(false);
    expect(msg.body).toBe("Una mascota — Entra sin fecha");
  });
});
