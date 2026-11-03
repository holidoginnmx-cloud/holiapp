import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@holidoginn/db";

import {
  buildSoonMessage,
  buildTomorrowSummary,
  domicilioDe,
  loadAgendaEvents,
  rangosDeManana,
  sendTeamSoonReminders,
  sendTeamTomorrowSummary,
  type AgendaEvent,
} from "./teamAgenda";
import { notifyUsers } from "./notify";

vi.mock("./notify", () => ({
  equipoActivoIds: vi.fn(async () => ["admin_1", "staff_1"]),
  notifyUsers: vi.fn(async () => 2),
}));

/** Instante real a una hora local del hotel (UTC-7 fijo). */
const hotelTime = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00.000-07:00`);
/** Día guardado a las 00:00 UTC (hospedaje). */
const utcDay = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
/** Día anclado a mediodía UTC (guardería). */
const noonDay = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);

const row = (over: Record<string, unknown>) => ({
  id: "r1",
  groupId: null,
  reservationType: "STAY",
  checkIn: null,
  checkOut: null,
  checkInTime: null,
  checkOutTime: null,
  appointmentAt: null,
  homeDelivery: false,
  homeDeliveryTrip: "PICKUP",
  pet: { name: "Molly" },
  ...over,
});

/**
 * Prisma falso: `loadAgendaEvents` hace 4 `reservation.findMany` en este orden
 * (llegadas, salidas, guarderías, baños) y 1 `reservationAddon.findMany`.
 */
function fakePrisma(opts: {
  llegadas?: unknown[];
  salidas?: unknown[];
  guarderias?: unknown[];
  banos?: unknown[];
  addons?: unknown[];
  yaAvisado?: boolean;
}) {
  const cola = [opts.llegadas ?? [], opts.salidas ?? [], opts.guarderias ?? [], opts.banos ?? []];
  let i = 0;
  return {
    reservation: { findMany: vi.fn(async () => cola[i++ % 4]) },
    reservationAddon: { findMany: vi.fn(async () => opts.addons ?? []) },
    notification: { findFirst: vi.fn(async () => (opts.yaAvisado ? { id: "n" } : null)) },
  } as unknown as PrismaClient;
}

const ev = (over: Partial<AgendaEvent>): AgendaEvent => ({
  tipo: "LLEGA",
  petNames: ["Molly"],
  at: hotelTime("2026-11-04", "10:00"),
  domicilio: null,
  reservationId: "r1",
  reservationType: "STAY",
  visitKey: "r1",
  ...over,
});

beforeEach(() => vi.mocked(notifyUsers).mockClear());

describe("domicilioDe", () => {
  it("la ida es en la llegada y la vuelta en la salida", () => {
    expect(domicilioDe("LLEGA", "PICKUP")).toBe("RECOGER");
    expect(domicilioDe("SALE", "PICKUP")).toBeNull();
    expect(domicilioDe("LLEGA", "DROPOFF")).toBeNull();
    expect(domicilioDe("SALE", "ROUND_TRIP")).toBe("ENTREGAR");
    expect(domicilioDe("BANO", "ROUND_TRIP")).toBe("RECOGER_Y_ENTREGAR");
    expect(domicilioDe("LLEGA", null)).toBeNull();
  });
});

describe("buildTomorrowSummary", () => {
  it("nada mañana → no se manda nada", () => {
    expect(buildTomorrowSummary([])).toBeNull();
  });

  it("cuenta por perro, ordena por hora y deja al final a los que no tienen hora", () => {
    const m = buildTomorrowSummary([
      ev({ petNames: ["Toby"], at: null, visitKey: "a" }),
      ev({ petNames: ["Molly"], at: hotelTime("2026-11-04", "10:00"), domicilio: "RECOGER", visitKey: "b" }),
      ev({ tipo: "SALE", petNames: ["Tate", "Luna"], at: hotelTime("2026-11-04", "18:00"), visitKey: "c" }),
      ev({ tipo: "BANO", petNames: ["Wero"], at: hotelTime("2026-11-04", "11:30"), reservationType: "BATH", visitKey: "d" }),
      ev({ tipo: "BANO", petNames: ["Polo"], at: hotelTime("2026-11-04", "09:00"), hospedado: true, visitKey: "e" }),
      ev({ tipo: "GUARDERIA_ENTRA", petNames: ["Max"], at: hotelTime("2026-11-04", "09:00"), reservationType: "DAYCARE", visitKey: "f" }),
      ev({ tipo: "GUARDERIA_SALE", petNames: ["Max"], at: hotelTime("2026-11-04", "18:00"), reservationType: "DAYCARE", visitKey: "f" }),
    ])!;
    expect(m.title).toBe("📋 Mañana: 2 llegan · 2 se van · 2 baños · 1 en guardería");
    expect(m.body.split("\n")).toEqual([
      "🏨 Llegan: Molly · 10:00 am (🚐 recoger en casa), Toby · sin hora",
      "👋 Se van: Tate y Luna · 6:00 pm",
      "🛁 Baños: Polo · 9:00 am · hospedado, Wero · 11:30 am",
      "🐾 Guardería: Max · 9:00 am–6:00 pm",
    ]);
  });
});

describe("buildSoonMessage", () => {
  it("check-in con recogida a domicilio (el caso de Molly)", () => {
    const at = hotelTime("2026-11-04", "10:00");
    const m = buildSoonMessage({ ...ev({ domicilio: "RECOGER" }), at }, hotelTime("2026-11-04", "09:30"));
    expect(m.title).toBe("⏰ Check-in de Molly · 10:00 am");
    expect(m.body).toContain("Llega en 30 min.");
    expect(m.body).toContain("recogida a domicilio");
  });

  it("check-out: que esté listo", () => {
    const at = hotelTime("2026-11-04", "18:00");
    const m = buildSoonMessage({ ...ev({ tipo: "SALE", petNames: ["Tate"] }), at }, hotelTime("2026-11-04", "17:32"));
    expect(m.title).toBe("⏰ Check-out de Tate · 6:00 pm");
    expect(m.body).toBe("Se va en 28 min. Que esté listo con sus cosas.");
  });
});

describe("loadAgendaEvents — fechas", () => {
  it("el día guardado a 00:00Z + la hora del hotel da el instante correcto", async () => {
    const { dayRange, instantRange } = rangosDeManana(hotelTime("2026-11-03", "18:00"));
    const events = await loadAgendaEvents(
      fakePrisma({
        llegadas: [row({ checkIn: utcDay("2026-11-04"), checkInTime: "10:00" })],
        guarderias: [
          row({ id: "g1", reservationType: "DAYCARE", appointmentAt: noonDay("2026-11-04"), checkInTime: "09:00", checkOutTime: "18:00", pet: { name: "Max" } }),
        ],
      }),
      dayRange,
      instantRange
    );
    const llega = events.find((e) => e.tipo === "LLEGA")!;
    expect(llega.at?.toISOString()).toBe(hotelTime("2026-11-04", "10:00").toISOString());
    const sale = events.find((e) => e.tipo === "GUARDERIA_SALE")!;
    expect(sale.at?.toISOString()).toBe(hotelTime("2026-11-04", "18:00").toISOString());
  });

  it("multireserva: un solo evento con todos los perros y el domicilio de cualquier fila", async () => {
    const { dayRange, instantRange } = rangosDeManana(hotelTime("2026-11-03", "18:00"));
    const events = await loadAgendaEvents(
      fakePrisma({
        llegadas: [
          row({ id: "a", groupId: "g", checkIn: utcDay("2026-11-04"), checkInTime: "10:00", pet: { name: "Tate" } }),
          row({ id: "b", groupId: "g", checkIn: utcDay("2026-11-04"), checkInTime: "10:00", homeDelivery: true, homeDeliveryTrip: "ROUND_TRIP", pet: { name: "Luna" } }),
        ],
      }),
      dayRange,
      instantRange
    );
    expect(events).toHaveLength(1);
    expect(events[0].petNames).toEqual(["Tate", "Luna"]);
    expect(events[0].domicilio).toBe("RECOGER");
  });

  it("mañana: el rango de baños es el día del hotel, no el de UTC", () => {
    const { instantRange, day } = rangosDeManana(hotelTime("2026-11-03", "20:30"));
    expect(day).toBe("2026-11-04");
    expect(instantRange.start.toISOString()).toBe("2026-11-04T07:00:00.000Z");
    expect(instantRange.end.toISOString()).toBe("2026-11-05T07:00:00.000Z");
  });
});

describe("sendTeamTomorrowSummary", () => {
  const conLlegada = () => ({
    llegadas: [row({ checkIn: utcDay("2026-11-04"), checkInTime: "10:00" })],
  });

  it("antes de las 6 pm no manda nada", async () => {
    expect((await sendTeamTomorrowSummary(fakePrisma(conLlegada()), hotelTime("2026-11-03", "17:50"))).sent).toBe(0);
  });

  it("a las 6 pm le llega a todo el equipo, una sola vez", async () => {
    expect((await sendTeamTomorrowSummary(fakePrisma(conLlegada()), hotelTime("2026-11-03", "18:05"))).sent).toBe(2);
    expect(vi.mocked(notifyUsers).mock.calls[0][1]).toEqual(["admin_1", "staff_1"]);
    expect(
      (await sendTeamTomorrowSummary(fakePrisma({ ...conLlegada(), yaAvisado: true }), hotelTime("2026-11-03", "18:15"))).sent
    ).toBe(0);
  });
});

describe("sendTeamSoonReminders", () => {
  it("avisa ~30 min antes, con la reserva para abrirla, y no repite", async () => {
    const opts = { llegadas: [row({ checkIn: utcDay("2026-11-04"), checkInTime: "10:00" })] };
    expect((await sendTeamSoonReminders(fakePrisma(opts), hotelTime("2026-11-04", "09:20"))).sent).toBe(0);
    expect((await sendTeamSoonReminders(fakePrisma(opts), hotelTime("2026-11-04", "09:31"))).sent).toBe(2);
    const payload = vi.mocked(notifyUsers).mock.calls[0][2];
    expect(payload.title).toBe("⏰ Check-in de Molly · 10:00 am");
    expect(payload.data).toMatchObject({ kind: "TEAM_AGENDA_SOON", reservationId: "r1", reservationType: "STAY" });
    expect((await sendTeamSoonReminders(fakePrisma({ ...opts, yaAvisado: true }), hotelTime("2026-11-04", "09:41"))).sent).toBe(0);
  });

  it("sin hora no hay aviso de 30 min", async () => {
    const opts = { llegadas: [row({ checkIn: utcDay("2026-11-04"), checkInTime: null })] };
    expect((await sendTeamSoonReminders(fakePrisma(opts), hotelTime("2026-11-04", "09:31"))).sent).toBe(0);
  });
});
