import { describe, it, expect, vi } from "vitest";
import { instanteDeLlegada, applyReservationTimesUpdate } from "./stayTimes";

vi.mock("./notify", () => ({
  equipoActivoIds: vi.fn(async () => ["usr_nancy", "usr_javier"]),
  notifyUsers: vi.fn(async () => 0),
}));
const { notifyUsers, equipoActivoIds } = await import("./notify");

/**
 * El recordatorio de 1.5 h anunciaba la llegada de un hospedaje leyendo la hora
 * de `checkIn`, que guarda solo el DÍA a las 00:00 UTC. En Hermosillo (UTC-7)
 * eso son las 5:00 p.m. del día anterior: el push salía el día equivocado y
 * anunciaba una hora que nadie había elegido.
 */
describe("instanteDeLlegada", () => {
  const base = {
    reservationType: "STAY",
    appointmentAt: null,
    checkIn: new Date("2026-09-10T00:00:00.000Z"),
    checkInTime: "19:00",
  };

  it("arma la llegada con el DÍA del checkIn y la hora local elegida", () => {
    // 7:00 p.m. en Hermosillo (UTC-7) = 02:00 UTC del día siguiente.
    expect(instanteDeLlegada(base)?.toISOString()).toBe("2026-09-11T02:00:00.000Z");
  });

  it("no confunde el día: 9:00 am del 10 sigue siendo el 10", () => {
    const r = { ...base, checkInTime: "09:00" };
    expect(instanteDeLlegada(r)?.toISOString()).toBe("2026-09-10T16:00:00.000Z");
  });

  it("sin hora indicada no hay instante (no se puede avisar 'en 1.5 horas')", () => {
    expect(instanteDeLlegada({ ...base, checkInTime: null })).toBeNull();
  });

  it("una hora corrupta no produce una fecha inválida", () => {
    expect(instanteDeLlegada({ ...base, checkInTime: "en la tarde" })).toBeNull();
  });

  it("en un baño la llegada es la cita, tal cual", () => {
    const cita = new Date("2026-09-10T17:30:00.000Z");
    expect(
      instanteDeLlegada({
        reservationType: "BATH",
        appointmentAt: cita,
        checkIn: null,
        checkInTime: null,
      })
    ).toBe(cita);
  });

  it("la llegada NO es la medianoche del checkIn (el bug que se corrigió)", () => {
    const real = instanteDeLlegada(base)!;
    expect(real.getTime()).not.toBe(base.checkIn.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

type Llamadas = {
  update?: { where: unknown; data: unknown };
  borrado?: unknown;
};

function prismaFake(llamadas: Llamadas, grupo = ["res_1"]) {
  return {
    reservation: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        llamadas.update = args;
        return { count: grupo.length };
      },
      findMany: async () => grupo.map((id) => ({ id })),
      findUnique: async () => ({
        id: "res_1",
        staffId: "usr_staff",
        pet: { name: "Molly" },
      }),
    },
    notification: {
      deleteMany: async (args: unknown) => {
        llamadas.borrado = args;
        return { count: 1 };
      },
    },
  } as unknown as Parameters<typeof applyReservationTimesUpdate>[0];
}

const reserva = {
  id: "res_1",
  groupId: "grp_1",
  ownerId: "usr_owner",
  checkInTime: "09:00",
  checkOutTime: null,
} as unknown as Parameters<typeof applyReservationTimesUpdate>[1]["reservation"];

describe("applyReservationTimesUpdate", () => {
  it("solo escribe los campos que vienen (undefined no toca nada)", async () => {
    const l: Llamadas = {};
    await applyReservationTimesUpdate(prismaFake(l), {
      reservation: reserva,
      checkOutTime: "18:30",
      notifyTeam: true,
    });
    expect(l.update?.data).toEqual({ checkOutTime: "18:30" });
  });

  it("null borra la hora, no la deja intacta", async () => {
    const l: Llamadas = {};
    await applyReservationTimesUpdate(prismaFake(l), {
      reservation: reserva,
      checkInTime: null,
      notifyTeam: true,
    });
    expect(l.update?.data).toEqual({ checkInTime: null });
  });

  it("aplica al GRUPO entero: las mascotas llegan y se van juntas", async () => {
    const l: Llamadas = {};
    await applyReservationTimesUpdate(prismaFake(l, ["res_1", "res_2"]), {
      reservation: reserva,
      checkInTime: "19:00",
      notifyTeam: true,
    });
    expect(l.update?.where).toEqual({ groupId: "grp_1", ownerId: "usr_owner" });
  });

  it("sin grupo toca solo esa reserva", async () => {
    const l: Llamadas = {};
    await applyReservationTimesUpdate(prismaFake(l), {
      reservation: { ...reserva, groupId: null } as typeof reserva,
      checkInTime: "19:00",
      notifyTeam: true,
    });
    expect(l.update?.where).toEqual({ id: "res_1" });
  });

  it("borra el recordatorio que anuncia la hora, en todo el grupo", async () => {
    const l: Llamadas = {};
    await applyReservationTimesUpdate(prismaFake(l, ["res_1", "res_2"]), {
      reservation: reserva,
      checkInTime: "19:00",
      notifyTeam: true,
    });
    const where = (l.borrado as { where: Record<string, unknown> }).where;
    expect(where.userId).toBe("usr_owner");
    expect(where.type).toBe("RESERVATION_REMINDER");
    expect((where.AND as { OR: unknown[] }[])[0].OR).toEqual([
      { data: { path: ["reservationId"], equals: "res_1" } },
      { data: { path: ["reservationId"], equals: "res_2" } },
    ]);
  });

  it("NO borra el «¿a qué hora llegas?» que se le pide al cliente", async () => {
    // CHECKIN_TIME/CHECKOUT_TIME viven bajo el mismo `type` y son el marcador
    // de que ya se le preguntó. Borrarlos hacía que fijar la llegada volviera a
    // pedirle la recogida al día siguiente, ya resuelta.
    const l: Llamadas = {};
    await applyReservationTimesUpdate(prismaFake(l), {
      reservation: reserva,
      checkInTime: "19:00",
      notifyTeam: true,
    });
    const where = (l.borrado as { where: Record<string, unknown> }).where;
    const kinds = ((where.AND as { OR: { data: { equals: string } }[] }[])[1].OR).map(
      (c) => c.data.equals,
    );
    expect(kinds).toEqual(["REMINDER_90MIN", "DAYCARE_REMINDER"]);
    expect(kinds).not.toContain("CHECKIN_TIME");
    expect(kinds).not.toContain("CHECKOUT_TIME");
  });

  it("avisa a TODO el equipo, no solo al responsable, y sin incluir al actor", async () => {
    vi.mocked(notifyUsers).mockClear();
    vi.mocked(equipoActivoIds).mockClear();
    await applyReservationTimesUpdate(prismaFake({}), {
      reservation: reserva,
      checkInTime: "19:00",
      actorUserId: "usr_jessica",
      notifyTeam: true,
    });
    // Quien recibe al perro casi nunca es el staff asignado: la asignación es
    // accountability, no reparto de turnos.
    expect(equipoActivoIds).toHaveBeenCalledWith(expect.anything(), "usr_jessica");
    expect(notifyUsers).toHaveBeenCalledWith(
      expect.anything(),
      ["usr_nancy", "usr_javier"],
      expect.objectContaining({
        title: "Horario actualizado: Molly",
        body: "Molly llega a las 7:00 pm.",
        data: { reservationId: "res_1", kind: "RESERVATION_UPDATED" },
      }),
    );
  });

  it("si la cambia el CLIENTE no se molesta al equipo", async () => {
    vi.mocked(notifyUsers).mockClear();
    await applyReservationTimesUpdate(prismaFake({}), {
      reservation: reserva,
      checkOutTime: "13:00",
      notifyTeam: false,
    });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("borrar la hora también se anuncia, no se queda en silencio", async () => {
    vi.mocked(notifyUsers).mockClear();
    await applyReservationTimesUpdate(prismaFake({}), {
      reservation: reserva,
      checkInTime: null,
      checkOutTime: "18:00",
      notifyTeam: true,
    });
    expect(vi.mocked(notifyUsers).mock.calls[0]?.[2].body).toBe(
      "Molly sin hora de llegada y sale a las 6:00 pm.",
    );
  });
});
