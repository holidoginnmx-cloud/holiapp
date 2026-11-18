import { describe, it, expect } from "vitest";
import { stayCoversDay, bathAddonLabel, petHasStayMessage } from "./petStayOnDay";

// Koa: entra el 14 y sale el 17 de noviembre (fechas a las 00:00Z).
const koa = {
  checkIn: new Date("2026-11-14T00:00:00Z"),
  checkOut: new Date("2026-11-17T00:00:00Z"),
  status: "CHECKED_IN",
};

describe("stayCoversDay", () => {
  it("cuenta el día de entrada, los de en medio y el de salida", () => {
    expect(stayCoversDay(koa, "2026-11-14")).toBe(true);
    expect(stayCoversDay(koa, "2026-11-16")).toBe(true);
    expect(stayCoversDay(koa, "2026-11-17")).toBe(true);
  });

  it("no cuenta el día anterior ni el siguiente", () => {
    expect(stayCoversDay(koa, "2026-11-13")).toBe(false);
    expect(stayCoversDay(koa, "2026-11-18")).toBe(false);
  });

  it("solo estancias activas: CONFIRMED y CHECKED_IN", () => {
    expect(stayCoversDay({ ...koa, status: "CONFIRMED" }, "2026-11-15")).toBe(true);
    expect(stayCoversDay({ ...koa, status: "CANCELLED" }, "2026-11-15")).toBe(false);
    expect(stayCoversDay({ ...koa, status: "CHECKED_OUT" }, "2026-11-17")).toBe(false);
  });

  it("aguanta filas viejas corridas a las 07:00Z (medianoche de Hermosillo)", () => {
    const vieja = {
      checkIn: new Date("2026-11-14T07:00:00Z"),
      checkOut: new Date("2026-11-17T07:00:00Z"),
      status: "CONFIRMED",
    };
    expect(stayCoversDay(vieja, "2026-11-14")).toBe(true);
    expect(stayCoversDay(vieja, "2026-11-17")).toBe(true);
    expect(stayCoversDay(vieja, "2026-11-13")).toBe(false);
    expect(stayCoversDay(vieja, "2026-11-18")).toBe(false);
  });

  it("sin fechas no es estancia", () => {
    expect(stayCoversDay({ checkIn: null, checkOut: null, status: "CONFIRMED" }, "2026-11-15")).toBe(false);
  });
});

describe("textos", () => {
  it("etiqueta del baño con extras", () => {
    expect(bathAddonLabel({ deslanado: false, corte: false })).toBe("Baño");
    expect(bathAddonLabel({ deslanado: true, corte: true })).toBe("Baño · Corte · Deslanado");
  });

  it("mensaje según si la estancia ya trae baño", () => {
    const base = {
      petId: "p", petName: "Koa", reservationId: "r", status: "CHECKED_IN",
      checkIn: "2026-11-14T00:00:00.000Z", checkOut: "2026-11-17T00:00:00.000Z",
      roomName: "Cuarto 10",
    };
    expect(petHasStayMessage({ ...base, bath: null })).toBe(
      "Koa está hospedado del 14 nov al 17 nov. El baño se agrega desde su estancia, no como cita aparte.",
    );
    expect(petHasStayMessage({ ...base, bath: { label: "Baño", scheduledAt: null } })).toContain(
      "Si quieres otro, escríbenos",
    );
  });
});
