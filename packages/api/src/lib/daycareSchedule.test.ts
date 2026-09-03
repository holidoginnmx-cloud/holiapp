import { describe, expect, it, vi, beforeEach } from "vitest";

// reservationAdminOps → refund.ts instancia Stripe al cargar; aquí no hay red.
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({ refunds: { create: vi.fn() } })),
}));
vi.mock("./notify", () => ({
  notifyUser: vi.fn(async () => ({})),
  notifyUsers: vi.fn(async () => 0),
  notifyPetAudience: vi.fn(async () => 0),
  notifyTeamReservationUpdated: vi.fn(async () => undefined),
}));
vi.mock("./daycareCreate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./daycareCreate")>();
  return { ...actual, countDaycareOccupancy: vi.fn(async () => ({ occupied: 0, maxCapacity: 20 })) };
});

import { countDaycareOccupancy } from "./daycareCreate";
import { notifyPetAudience, notifyTeamReservationUpdated } from "./notify";
import { applyDaycareScheduleUpdate, ymdFromDayAnchor, todayYMDLocal } from "./daycareSchedule";

type Db = Parameters<typeof applyDaycareScheduleUpdate>[0];

/** Día anclado a MEDIODÍA UTC, como lo guarda daycareDayAnchor. */
const anchor = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`);

/** Un día futuro estable, para que el gate de "ese día ya pasó" no dispare. */
const MANANA = (() => {
  const d = new Date(Date.now() + 3 * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
})();

const guarderiaFake = (over: Record<string, unknown> = {}) => ({
  id: "res_1",
  reservationType: "DAYCARE",
  status: "CONFIRMED",
  groupId: null,
  ownerId: "usr_owner",
  petId: "pet_1",
  staffId: null,
  appointmentAt: anchor(MANANA),
  checkInTime: "09:00",
  checkOutTime: "13:00", // 4 h
  totalAmount: 100,
  pet: { name: "Molly" },
  payments: [],
  ...over,
});

const prismaFake = (
  reserva: Record<string, unknown> | null,
  opciones: {
    filas?: Array<{ id: string; totalAmount: number }>;
    hourPrice?: number;
    onUpdate?: (id: string, data: Record<string, unknown>) => void;
    onBorrarRecordatorio?: () => void;
    locks?: string[];
  } = {}
) => {
  const tx = {
    reservation: {
      findMany: async () => opciones.filas ?? [{ id: "res_1", totalAmount: 100 }],
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        opciones.onUpdate?.(where.id, data);
        return {};
      },
    },
    notification: {
      deleteMany: async () => {
        opciones.onBorrarRecordatorio?.();
        return { count: 1 };
      },
    },
    $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
      opciones.locks?.push(String(vals[0]));
      return 1;
    },
  };
  return {
    reservation: { findUnique: async () => reserva },
    lodgingPricing: {
      // getLodgingPricing hace upsert del singleton y lee la columna histórica
      // `daycareExtraHourPrice` (= tarifa por hora de guardería).
      upsert: async () => ({
        pricePerDaySmall: 350,
        pricePerDayLarge: 450,
        largeWeightKg: 20,
        medicationSurchargePct: 10,
        daycareExtraHourPrice: opciones.hourPrice ?? 25,
      }),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Db;
};

const HORARIO = { checkInTime: "09:00", checkOutTime: "13:00", updateTotal: true };

beforeEach(() => {
  vi.mocked(countDaycareOccupancy).mockClear();
  vi.mocked(countDaycareOccupancy).mockResolvedValue({ occupied: 0, maxCapacity: 20 });
  vi.mocked(notifyPetAudience).mockClear();
  vi.mocked(notifyTeamReservationUpdated).mockClear();
});

describe("helpers de día", () => {
  it("ymdFromDayAnchor lee el ancla en UTC (leerla en local correría el día)", () => {
    expect(ymdFromDayAnchor(new Date("2026-09-15T12:00:00.000Z"))).toBe("2026-09-15");
  });
  it("todayYMDLocal devuelve un YYYY-MM-DD válido", () => {
    expect(todayYMDLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("applyDaycareScheduleUpdate — precio por diferencia de horas", () => {
  it("alargar 2 h cobra 2 × la tarifa, no el horario completo", async () => {
    const escrituras: Array<[string, Record<string, unknown>]> = [];
    const prisma = prismaFake(guarderiaFake(), {
      onUpdate: (id, d) => escrituras.push([id, d]),
    });
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "15:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.previousHours).toBe(4);
    expect(res.data.hours).toBe(6);
    expect(res.data.delta).toBe(50);
    expect(res.data.newTotal).toBe(150);
    expect(String(escrituras[0][1].totalAmount)).toBe("150");
  });

  it("acortar el horario BAJA el total", async () => {
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "11:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(-50);
    expect(res.data.newTotal).toBe(50);
  });

  it("updateTotal:false respeta el precio pactado (delta 0)", async () => {
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "18:00", updateTotal: false },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(0);
    expect(res.data.newTotal).toBe(100);
  });

  it("sin horas previas no hay diferencia que cobrar: corrige el horario y no el dinero", async () => {
    const prisma = prismaFake(guarderiaFake({ checkInTime: null, checkOutTime: null }));
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "18:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.previousHours).toBeNull();
    expect(res.data.delta).toBe(0);
    expect(res.data.newTotal).toBe(100);
  });

  it("salida antes que la entrada se rechaza", async () => {
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkInTime: "15:00", checkOutTime: "09:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.code).toBe("VALIDATION");
  });

  it("el horario fuera de 9–18 sale como aviso, no como error", async () => {
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "19:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warning).toContain("fuera de");
  });

  it("saldo y sobrepago se calculan contra el total nuevo", async () => {
    const prisma = prismaFake(guarderiaFake({ payments: [{ amount: 100 }] }));
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "11:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.newTotal).toBe(50);
    expect(res.data.balance).toBe(0);
    expect(res.data.overpaid).toBe(50);
  });
});

describe("applyDaycareScheduleUpdate — cambio de día", () => {
  const OTRO_DIA = (() => {
    const d = new Date(Date.now() + 5 * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  })();

  it("mueve el día, toma el lock de cupo de AMBOS días y borra el recordatorio", async () => {
    const locks: string[] = [];
    let borrado = false;
    const escrituras: Array<[string, Record<string, unknown>]> = [];
    const prisma = prismaFake(guarderiaFake(), {
      locks,
      onBorrarRecordatorio: () => (borrado = true),
      onUpdate: (id, d) => escrituras.push([id, d]),
    });
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, date: OTRO_DIA },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    expect(locks.sort()).toEqual([MANANA, OTRO_DIA].sort());
    expect(borrado).toBe(true);
    expect((escrituras[0][1].appointmentAt as Date).toISOString()).toBe(
      anchor(OTRO_DIA).toISOString()
    );
  });

  it("sin cupo en el día nuevo: 409 DAYCARE_FULL con la ocupación", async () => {
    vi.mocked(countDaycareOccupancy).mockResolvedValue({ occupied: 20, maxCapacity: 20 });
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, date: OTRO_DIA },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("DAYCARE_FULL");
    expect(res.extra).toEqual({ occupied: 20, maxCapacity: 20 });
  });

  it("`force` guarda aunque no haya cupo", async () => {
    vi.mocked(countDaycareOccupancy).mockResolvedValue({ occupied: 20, maxCapacity: 20 });
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, date: OTRO_DIA, force: true },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
  });

  it("mover a un día que ya pasó pide `force`", async () => {
    const prisma = prismaFake(guarderiaFake());
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, date: "2020-01-05" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("DATE_IN_PAST");
  });

  it("corregir HORAS de una guardería pasada no pide `force` (el día no cambia)", async () => {
    const prisma = prismaFake(
      guarderiaFake({ appointmentAt: anchor("2020-01-05"), status: "CHECKED_IN" })
    );
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, date: "2020-01-05", checkOutTime: "15:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
  });

  it("todo el grupo se mueve junto y cada fila cobra su propio delta", async () => {
    const escrituras: Array<[string, Record<string, unknown>]> = [];
    const prisma = prismaFake(guarderiaFake({ groupId: "g1" }), {
      filas: [
        { id: "res_1", totalAmount: 100 },
        { id: "res_2", totalAmount: 120 },
      ],
      onUpdate: (id, d) => escrituras.push([id, d]),
    });
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "15:00" },
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(true);
    expect(escrituras.map(([id]) => id)).toEqual(["res_1", "res_2"]);
    expect(String(escrituras[0][1].totalAmount)).toBe("150");
    expect(String(escrituras[1][1].totalAmount)).toBe("170");
  });
});

describe("applyDaycareScheduleUpdate — candados y avisos", () => {
  it("404 si no existe o no es guardería", async () => {
    for (const row of [null, guarderiaFake({ reservationType: "STAY" })]) {
      const res = await applyDaycareScheduleUpdate(prismaFake(row), {
        reservationId: "res_1",
        input: HORARIO,
        actorUserId: "usr_web",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(404);
    }
  });

  it.each([
    ["CANCELLED", "CANCELLED", "cancelada"],
    ["CHECKED_OUT", "NOT_ACTIVE", "concluyó"],
  ])("una guardería %s ya no se mueve", async (status, code, texto) => {
    const prisma = prismaFake(guarderiaFake({ status }));
    const res = await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: HORARIO,
      actorUserId: "usr_web",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe(code);
    expect(res.error).toContain(texto);
  });

  it("avisa al cliente y al equipo con el día y el horario nuevos", async () => {
    const prisma = prismaFake(guarderiaFake());
    await applyDaycareScheduleUpdate(prisma, {
      reservationId: "res_1",
      input: { ...HORARIO, checkOutTime: "15:00" },
      actorUserId: "usr_web",
    });
    expect(vi.mocked(notifyPetAudience)).toHaveBeenCalledTimes(1);
    const aviso = vi.mocked(notifyPetAudience).mock.calls[0][2];
    expect(aviso.body).toContain("09:00 a 15:00");
    expect(aviso.body).toContain("Nuevo total");
    expect(vi.mocked(notifyTeamReservationUpdated)).toHaveBeenCalledTimes(1);
  });
});
