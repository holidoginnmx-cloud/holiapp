import { beforeEach, describe, expect, it, vi } from "vitest";

type Push = { type: string; title: string; body: string; data?: Record<string, string> };
type Email = { subject: string; paragraphs: string[] };

const notifyPetAudience = vi.fn(async (_p: unknown, _t: unknown, _push: Push) => 1);
const emailPetAudience = vi.fn(async (_p: unknown, _t: unknown, _email: Email) => 1);
vi.mock("./notify", () => ({
  notifyPetAudience: (p: unknown, t: unknown, push: Push) => notifyPetAudience(p, t, push),
  emailPetAudience: (p: unknown, t: unknown, email: Email) => emailPetAudience(p, t, email),
}));
vi.mock("./pricing", () => ({
  getLodgingPricing: async () => ({ daycareHourPrice: 30 }),
}));

const { sendDayBeforeReminders } = await import("./clientReminders");

// Lo que se rompía: el recordatorio de baño solo lo disparaba el cron de
// GitHub, que se saltaba la mayoría de las corridas, y la ventana de 23–25 h
// casi nunca coincidía. Un cliente no llegó a su baño "porque no le llegó
// recordatorio".

type Row = {
  id: string;
  groupId: string | null;
  ownerId: string;
  petId: string;
  reservationType: "BATH" | "DAYCARE" | "STAY";
  appointmentAt: Date | null;
  checkIn: Date | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  pet: { name: string };
};

function row(p: Partial<Row> & Pick<Row, "id" | "reservationType">): Row {
  return {
    groupId: null,
    ownerId: "owner-1",
    petId: `pet-${p.id}`,
    appointmentAt: null,
    checkIn: null,
    checkInTime: null,
    checkOutTime: null,
    pet: { name: "Firulais" },
    ...p,
  };
}

function fakePrisma(rows: Row[], reminded: string[] = []) {
  const findMany = vi.fn(async ({ where }: { where: any }) =>
    rows.filter((r) => {
      if (r.reservationType !== where.reservationType) return false;
      const field = r.reservationType === "STAY" ? r.checkIn : r.appointmentAt;
      const range = r.reservationType === "STAY" ? where.checkIn : where.appointmentAt;
      if (!field || field < range.gte || field >= range.lt) return false;
      if (where.checkInTime?.not === null && r.checkInTime === null) return false;
      return true;
    })
  );
  return {
    reservation: { findMany },
    notification: {
      // Ya avisado si alguna reserva de la visita está en `reminded`.
      findFirst: vi.fn(async ({ where }: { where: any }) => {
        const ids: string[] = where.AND[1].OR.map((o: any) => o.data.equals);
        return ids.some((id) => reminded.includes(id)) ? { id: "n" } : null;
      }),
    },
  };
}

// 10:00 a.m. del 15 de octubre en Hermosillo (UTC-7).
const NOW = new Date("2026-10-15T17:00:00Z");

beforeEach(() => {
  notifyPetAudience.mockClear();
  emailPetAudience.mockClear();
});

describe("sendDayBeforeReminders", () => {
  it("avisa del baño de mañana por push y por correo", async () => {
    const prisma = fakePrisma([
      // 16 oct, 9:00 a.m. del hotel.
      row({ id: "b1", reservationType: "BATH", appointmentAt: new Date("2026-10-16T16:00:00Z") }),
    ]);
    const r = await sendDayBeforeReminders(prisma as any, NOW);
    expect(r.sent).toBe(1);
    const push = notifyPetAudience.mock.calls[0]![2];
    expect(push.type).toBe("RESERVATION_REMINDER");
    expect(push.data).toEqual({ reservationId: "b1", kind: "BATH_REMINDER" });
    expect(push.body).toContain("mañana");
    expect(push.body).toContain("9:00");
    expect(emailPetAudience).toHaveBeenCalledTimes(1);
    expect(emailPetAudience.mock.calls[0]![2].paragraphs.join(" ")).toContain("viernes 16 de octubre");
  });

  it("no avisa de un baño de hoy ni de pasado mañana", async () => {
    const prisma = fakePrisma([
      row({ id: "hoy", reservationType: "BATH", appointmentAt: new Date("2026-10-15T22:00:00Z") }),
      row({ id: "pasado", reservationType: "BATH", appointmentAt: new Date("2026-10-17T16:00:00Z") }),
    ]);
    const r = await sendDayBeforeReminders(prisma as any, NOW);
    expect(r.sent).toBe(0);
    expect(notifyPetAudience).not.toHaveBeenCalled();
  });

  it("un baño de mañana a las 8 p.m. no se confunde con el día UTC", async () => {
    // 16 oct 20:00 local = 17 oct 03:00Z: en UTC ya es "pasado mañana".
    const prisma = fakePrisma([
      row({ id: "noche", reservationType: "BATH", appointmentAt: new Date("2026-10-17T03:00:00Z") }),
    ]);
    const r = await sendDayBeforeReminders(prisma as any, NOW);
    expect(r.sent).toBe(1);
  });

  it("no manda nada de madrugada ni de noche", async () => {
    const prisma = fakePrisma([
      row({ id: "b1", reservationType: "BATH", appointmentAt: new Date("2026-10-16T16:00:00Z") }),
    ]);
    // 6:00 a.m. y 10:00 p.m. del hotel.
    expect((await sendDayBeforeReminders(prisma as any, new Date("2026-10-15T13:00:00Z"))).sent).toBe(0);
    expect((await sendDayBeforeReminders(prisma as any, new Date("2026-10-16T05:00:00Z"))).sent).toBe(0);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });

  it("no repite el aviso ya enviado", async () => {
    const prisma = fakePrisma(
      [row({ id: "b1", reservationType: "BATH", appointmentAt: new Date("2026-10-16T16:00:00Z") })],
      ["b1"]
    );
    const r = await sendDayBeforeReminders(prisma as any, NOW);
    expect(r.sent).toBe(0);
    expect(emailPetAudience).not.toHaveBeenCalled();
  });

  it("una visita multi-mascota recibe un solo aviso con todos los nombres", async () => {
    const day = new Date("2026-10-16T12:00:00Z"); // guardería anclada a mediodía UTC
    const prisma = fakePrisma([
      row({ id: "d1", groupId: "g", reservationType: "DAYCARE", appointmentAt: day, checkInTime: "09:00", checkOutTime: "14:00", pet: { name: "Wero" } }),
      row({ id: "d2", groupId: "g", reservationType: "DAYCARE", appointmentAt: day, checkInTime: "09:00", checkOutTime: "14:00", pet: { name: "Federico" } }),
    ]);
    const r = await sendDayBeforeReminders(prisma as any, NOW);
    expect(r.sent).toBe(1);
    const push = notifyPetAudience.mock.calls[0]![2];
    expect(push.body).toContain("Wero y Federico");
    expect(push.body).toContain("9:00 am a 2:00 pm");
    expect(push.data?.kind).toBe("DAYCARE_REMINDER");
  });

  it("recuerda el check-in de mañana cuando ya tiene hora de llegada", async () => {
    const prisma = fakePrisma([
      row({ id: "s1", reservationType: "STAY", checkIn: new Date("2026-10-16T00:00:00Z"), checkInTime: "10:30" }),
      // Sin hora: de esa se encarga el aviso que pide la hora.
      row({ id: "s2", reservationType: "STAY", checkIn: new Date("2026-10-16T00:00:00Z"), checkInTime: null }),
    ]);
    const r = await sendDayBeforeReminders(prisma as any, NOW);
    expect(r.sent).toBe(1);
    const push = notifyPetAudience.mock.calls[0]![2];
    expect(push.data).toEqual({ reservationId: "s1", kind: "STAY_CHECKIN_REMINDER" });
    expect(push.body).toContain("10:30 am");
  });
});
