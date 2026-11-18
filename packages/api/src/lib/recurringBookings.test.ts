import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./reservationTeamCreate", () => ({ createTeamReservation: vi.fn() }));
vi.mock("./notify", () => ({
  adminsActivosIds: vi.fn(async () => ["admin_1"]),
  notifyUsers: vi.fn(async () => 1),
}));
vi.mock("./petStayOnDay", () => ({ findPetStayOnDay: vi.fn(async () => null) }));

import { createTeamReservation } from "./reservationTeamCreate";
import { notifyUsers } from "./notify";
import { findPetStayOnDay } from "./petStayOnDay";
import {
  buildOccurrenceInput,
  generateRecurringOccurrences,
  isRecurringGenerationHour,
} from "./recurringBookings";

type Db = Parameters<typeof generateRecurringOccurrences>[0];
type Series = Parameters<typeof buildOccurrenceInput>[0];

// Miércoles 18-nov-2026, 10:00 en Hermosillo (17:00Z). Con 7 días de
// anticipación la ventana llega al miércoles 25: el viernes 20 entra.
const NOW = new Date("2026-11-18T17:00:00Z");

const gurrola = (over: Partial<Series> = {}): Series =>
  ({
    id: "rb_1",
    reservationType: "BATH",
    petIds: ["polly", "luna", "bongo"],
    intervalWeeks: 2,
    weekdays: [5],
    anchorDate: "2026-11-20",
    endDate: null,
    startTime: "10:00",
    deslanado: false,
    corte: false,
    checkInTime: null,
    checkOutTime: null,
    homeDelivery: true,
    homeDeliveryAddress: "Calle 1 #2, Hermosillo",
    homeDeliveryLat: 29.1,
    homeDeliveryLng: -110.9,
    homeDeliveryPlaceId: null,
    homeDeliveryTrip: "ROUND_TRIP",
    chargeDelivery: false,
    totalAmountOverride: null,
    internalNotes: "Van por ellos a su casa",
    staffId: null,
    leadDays: 7,
    skipDates: [],
    generatedThrough: null,
    active: true,
    pausedReason: null,
    deletedAt: null,
    ownerId: "usr_gurrola",
    createdById: "usr_jessica",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as Series;

function fakeDb(opts: {
  series: Series[];
  existing?: { recurringBookingId: string; recurrenceDate: string }[];
  activePets?: string[];
  deliveryActive?: boolean;
}) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const db = {
    recurringBooking: {
      findMany: async () => opts.series.map((s) => ({ ...s, owner: { firstName: "VERONICA GURROLA", lastName: "—" } })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return {};
      },
    },
    reservation: {
      findFirst: async ({ where }: { where: { recurringBookingId: string; recurrenceDate: string } }) =>
        (opts.existing ?? []).some(
          (e) => e.recurringBookingId === where.recurringBookingId && e.recurrenceDate === where.recurrenceDate
        )
          ? { id: "res_existente" }
          : null,
    },
    pet: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => (opts.activePets ?? where.id.in).includes(id))
          .map((id) => ({ id })),
    },
    user: { findUnique: async () => ({ role: "STAFF", isActive: true }) },
    deliveryConfig: { findUnique: async () => ({ isActive: opts.deliveryActive ?? true }) },
  } as unknown as Db;
  return { db, updates };
}

const okCreate = (warnings: string[] = []) => ({
  ok: true as const,
  data: {
    reservations: [{ id: "res_a" }, { id: "res_b" }, { id: "res_c" }],
    groupId: "grp",
    agendaWarnings: warnings,
  },
});

beforeEach(() => {
  vi.mocked(createTeamReservation).mockReset();
  vi.mocked(notifyUsers).mockClear();
  vi.mocked(findPetStayOnDay).mockReset();
  vi.mocked(findPetStayOnDay).mockResolvedValue(null);
});

const stayOf = (petId: string, petName: string) => ({
  petId,
  petName,
  reservationId: `stay_${petId}`,
  status: "CONFIRMED",
  checkIn: "2026-11-19T00:00:00.000Z",
  checkOut: "2026-11-22T00:00:00.000Z",
  roomName: null,
  bath: null,
});

describe("buildOccurrenceInput", () => {
  it("baño: 10:00 de Hermosillo = 17:00Z, pactado (override) y con domicilio", () => {
    const input = buildOccurrenceInput(gurrola(), "2026-11-20", ["polly", "luna", "bongo"])!;
    expect(input.reservationType).toBe("BATH");
    expect(input.appointmentAt?.toISOString()).toBe("2026-11-20T17:00:00.000Z");
    expect(input.scheduleOverride).toBe(true);
    expect(input.legalAccepted).toBe(true);
    expect(input.petIds).toEqual(["polly", "luna", "bongo"]);
    expect(input.homeDelivery).toMatchObject({ address: "Calle 1 #2, Hermosillo", trip: "ROUND_TRIP" });
    expect(input.internalNotes).toBe("Van por ellos a su casa");
  });

  it("guardería: día anclado a mediodía UTC con su horario", () => {
    const input = buildOccurrenceInput(
      gurrola({ reservationType: "DAYCARE", startTime: null, checkInTime: "08:00", checkOutTime: "14:00" }),
      "2026-11-20",
      ["polly"]
    )!;
    expect(input.appointmentAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(input.checkInTime).toBe("08:00");
    expect(input.checkOutTime).toBe("14:00");
  });

  it("precio pactado viaja como total manual", () => {
    const input = buildOccurrenceInput(gurrola({ totalAmountOverride: 1200 as never }), "2026-11-20", ["polly"])!;
    expect(input.totalAmountOverride).toBe(1200);
  });
});

describe("generateRecurringOccurrences", () => {
  it("crea la cita del viernes con domicilio de cortesía y marca la ventana como revisada", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue(okCreate() as never);
    const { db, updates } = fakeDb({ series: [gurrola()] });

    const res = await generateRecurringOccurrences(db, NOW);

    expect(res.sent).toBe(1);
    expect(createTeamReservation).toHaveBeenCalledTimes(1);
    const params = vi.mocked(createTeamReservation).mock.calls[0][1];
    expect(params.source).toBe("RECURRING");
    expect(params.deliveryCourtesy).toBe(true);
    expect(params.actorUserId).toBeNull();
    expect(params.recurrence).toEqual({ id: "rb_1", date: "2026-11-20" });
    expect(updates).toEqual([{ id: "rb_1", data: { generatedThrough: "2026-11-25" } }]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("cobra el domicilio solo si la serie lo pide", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue(okCreate() as never);
    const { db } = fakeDb({ series: [gurrola({ chargeDelivery: true })] });
    await generateRecurringOccurrences(db, NOW);
    expect(vi.mocked(createTeamReservation).mock.calls[0][1].deliveryCourtesy).toBe(false);
  });

  it("no duplica: si la fecha ya existe (aunque se haya movido o cancelado) no la crea", async () => {
    const { db } = fakeDb({
      series: [gurrola()],
      existing: [{ recurringBookingId: "rb_1", recurrenceDate: "2026-11-20" }],
    });
    const res = await generateRecurringOccurrences(db, NOW);
    expect(res.sent).toBe(0);
    expect(createTeamReservation).not.toHaveBeenCalled();
  });

  it("no revisa de nuevo lo que ya revisó", async () => {
    const { db, updates } = fakeDb({ series: [gurrola({ generatedThrough: "2026-11-25" })] });
    await generateRecurringOccurrences(db, NOW);
    expect(createTeamReservation).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("respeta las fechas saltadas", async () => {
    const { db } = fakeDb({ series: [gurrola({ skipDates: ["2026-11-20"] })] });
    await generateRecurringOccurrences(db, NOW);
    expect(createTeamReservation).not.toHaveBeenCalled();
  });

  it("hoy, pero la hora ya pasó: no la crea", async () => {
    // Viernes 20-nov a las 11:00 de Hermosillo; la cita era a las 10:00.
    const { db } = fakeDb({ series: [gurrola()] });
    await generateRecurringOccurrences(db, new Date("2026-11-20T18:00:00Z"));
    expect(createTeamReservation).not.toHaveBeenCalled();
  });

  it("si se encima, se crea igual y se avisa a los admin", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue(okCreate(["Luna: Se encima con Max."]) as never);
    const { db } = fakeDb({ series: [gurrola()] });
    await generateRecurringOccurrences(db, NOW);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(notifyUsers).mock.calls[0][2];
    expect(payload.title).toMatch(/Revisa una cita recurrente/);
    expect(payload.body).toMatch(/vie 20 nov/);
  });

  it("solo los perros activos, en el orden de la serie; quita al de baja y avisa una vez", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue(okCreate() as never);
    const { db, updates } = fakeDb({ series: [gurrola()], activePets: ["bongo", "polly"] });
    await generateRecurringOccurrences(db, NOW);
    expect(vi.mocked(createTeamReservation).mock.calls[0][1].input.petIds).toEqual(["polly", "bongo"]);
    expect(updates[0]).toEqual({ id: "rb_1", data: { petIds: ["polly", "bongo"] } });
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyUsers).mock.calls[0][2].title).toMatch(/sin una mascota/);
  });

  it("perro hospedado ese día: sale de la cita (sin precio pactado) y se avisa", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue(okCreate() as never);
    vi.mocked(findPetStayOnDay).mockImplementation(async (_db, petId) =>
      petId === "luna" ? stayOf("luna", "Luna") : null
    );
    const { db, updates } = fakeDb({ series: [gurrola({ totalAmountOverride: 1350 as never })] });
    await generateRecurringOccurrences(db, NOW);
    const input = vi.mocked(createTeamReservation).mock.calls[0][1].input;
    expect(input.petIds).toEqual(["polly", "bongo"]);
    expect(input.totalAmountOverride).toBeUndefined();
    // La serie NO pierde a Luna: solo se salta esta fecha.
    expect(updates).toEqual([{ id: "rb_1", data: { generatedThrough: "2026-11-25" } }]);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(notifyUsers).mock.calls[0][2];
    expect(payload.title).toMatch(/perro hospedado/);
    expect(payload.body).toMatch(/Luna está hospedado ese día/);
    expect(payload.body).toMatch(/precio normal/);
  });

  it("todos hospedados: no crea la cita, avisa y da la fecha por revisada", async () => {
    vi.mocked(findPetStayOnDay).mockImplementation(async (_db, petId) => stayOf(petId, petId));
    const { db, updates } = fakeDb({ series: [gurrola()] });
    const res = await generateRecurringOccurrences(db, NOW);
    expect(createTeamReservation).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
    expect(updates).toEqual([{ id: "rb_1", data: { generatedThrough: "2026-11-25" } }]);
    expect(vi.mocked(notifyUsers).mock.calls[0][2].body).toMatch(/no se agendó su baño recurrente/);
  });

  it("domicilio cobrado con el servicio apagado: se registra sin costo y avisa", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue(okCreate() as never);
    const { db } = fakeDb({ series: [gurrola({ chargeDelivery: true })], deliveryActive: false });
    await generateRecurringOccurrences(db, NOW);
    expect(vi.mocked(createTeamReservation).mock.calls[0][1].deliveryCourtesy).toBe(true);
    expect(vi.mocked(notifyUsers).mock.calls[0][2].title).toMatch(/Domicilio sin cobrar/);
  });

  it("sin perros activos: pausa la serie, avisa y la fecha queda pendiente para cuando se reanude", async () => {
    const { db, updates } = fakeDb({ series: [gurrola()], activePets: [] });
    await generateRecurringOccurrences(db, NOW);
    expect(createTeamReservation).not.toHaveBeenCalled();
    expect(updates[0].data).toMatchObject({ active: false });
    expect(updates[1]).toEqual({ id: "rb_1", data: { generatedThrough: "2026-11-19" } });
    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("error de negocio: avisa y da la fecha por revisada (no reintenta cada 10 min)", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Variante de baño no disponible para BONGO",
    } as never);
    const { db, updates } = fakeDb({ series: [gurrola()] });
    const res = await generateRecurringOccurrences(db, NOW);
    expect(res.failed).toHaveLength(1);
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([{ id: "rb_1", data: { generatedThrough: "2026-11-25" } }]);
  });

  it("excepción inesperada: NO avanza la serie, se reintenta después", async () => {
    vi.mocked(createTeamReservation).mockRejectedValue(new Error("db down"));
    const { db, updates } = fakeDb({ series: [gurrola()] });
    await generateRecurringOccurrences(db, NOW);
    expect(updates).toEqual([{ id: "rb_1", data: { generatedThrough: "2026-11-19" } }]);
  });
});

describe("ventana del ciclo automático", () => {
  it("de 9:00 a 20:00 del hotel", () => {
    expect(isRecurringGenerationHour(new Date("2026-11-18T15:59:00Z"))).toBe(false); // 8:59
    expect(isRecurringGenerationHour(new Date("2026-11-18T16:00:00Z"))).toBe(true); // 9:00
    expect(isRecurringGenerationHour(new Date("2026-11-19T02:59:00Z"))).toBe(true); // 19:59
    expect(isRecurringGenerationHour(new Date("2026-11-19T03:00:00Z"))).toBe(false); // 20:00
  });
});
