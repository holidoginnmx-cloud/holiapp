import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./notify", () => ({
  notifyPetAudience: vi.fn(async () => 1),
}));
vi.mock("./reviewRequest", () => ({ requestReview: vi.fn(async () => true) }));
vi.mock("./balanceReminder", () => ({ notifyBalanceDue: vi.fn(async () => true) }));

import { notifyPetAudience } from "./notify";
import { requestReview } from "./reviewRequest";
import { notifyBalanceDue } from "./balanceReminder";
import { applyStatusTransition, statusTransitionVerdict } from "./reservationStatus";

type Row = {
  id: string;
  status: string;
  reservationType: string;
  groupId: string | null;
  ownerId: string;
  petId: string;
  staffId: string | null;
  pet: { name: string };
  checklists: unknown[];
  updates: unknown[];
  alerts: unknown[];
};

const row = (over: Partial<Row> = {}): Row => ({
  id: "res_1",
  status: "CONFIRMED",
  reservationType: "STAY",
  groupId: null,
  ownerId: "usr_owner",
  petId: "pet_1",
  staffId: null,
  pet: { name: "Molly" },
  checklists: [],
  updates: [],
  alerts: [],
  ...over,
});

function prismaFake(rows: Row[], opts: { paidCount?: number } = {}) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const crUpdates: unknown[] = [];
  const fake = {
    updates,
    crUpdates,
    reservation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: { groupId: string } }) =>
        rows.filter((r) => r.groupId === where.groupId),
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      },
    },
    reservationChangeRequest: {
      updateMany: async (args: unknown) => {
        crUpdates.push(args);
        return { count: 0 };
      },
    },
    payment: { count: async () => opts.paidCount ?? 0 },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fake),
  };
  return fake;
}

type Db = Parameters<typeof applyStatusTransition>[0];
const base = { actorUserId: "usr_web", actorRole: "ADMIN", isAdmin: true };

describe("statusTransitionVerdict — mismas reglas que PATCH /reservations/:id/status", () => {
  it("un baño no hace check-in", () => {
    expect(statusTransitionVerdict("CONFIRMED", "CHECKED_IN", "BATH", true)).toMatch(/baño/);
  });
  it("una estancia no finaliza sin check-in", () => {
    expect(statusTransitionVerdict("CONFIRMED", "CHECKED_OUT", "STAY", true)).toMatch(/check-in/);
    expect(statusTransitionVerdict("CONFIRMED", "CHECKED_OUT", "DAYCARE", true)).toBeNull();
  });
  it("reabrir es solo de admin", () => {
    expect(statusTransitionVerdict("CHECKED_OUT", "CONFIRMED", "STAY", false)).toMatch(/administrador/);
    expect(statusTransitionVerdict("CHECKED_OUT", "CONFIRMED", "STAY", true)).toBeNull();
  });
  it("una cancelada no se reactiva", () => {
    expect(statusTransitionVerdict("CANCELLED", "CONFIRMED", "STAY", true)).toMatch(/cancelada/);
  });
});

describe("applyStatusTransition (vía interna)", () => {
  beforeEach(() => {
    vi.mocked(notifyPetAudience).mockClear();
    vi.mocked(requestReview).mockClear();
    vi.mocked(notifyBalanceDue).mockClear();
  });

  it("check-in: escribe CHECKED_IN y avisa CHECK_IN al dueño como la app", async () => {
    const prisma = prismaFake([row()]);
    const res = await applyStatusTransition(prisma as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CHECKED_IN",
    });
    expect(res.ok).toBe(true);
    expect(prisma.updates[0].data.status).toBe("CHECKED_IN");
    // El actor es admin del panel, no staff: no se vuelve responsable.
    expect(prisma.updates[0].data.staffId).toBeUndefined();
    expect(notifyPetAudience).toHaveBeenCalledTimes(1);
    const [, target, payload] = vi.mocked(notifyPetAudience).mock.calls[0];
    expect(target).toEqual({ petId: "pet_1", ownerId: "usr_owner" });
    expect(payload.type).toBe("CHECK_IN");
  });

  it("check-in por STAFF sin responsable: el staff queda asignado", async () => {
    const prisma = prismaFake([row()]);
    await applyStatusTransition(prisma as unknown as Db, {
      reservationId: "res_1",
      to: "CHECKED_IN",
      actorUserId: "usr_staff",
      actorRole: "STAFF",
      isAdmin: false,
    });
    expect(prisma.updates[0].data.staffId).toBe("usr_staff");
  });

  it("check-out: cancela solicitudes pendientes, avisa CHECK_OUT, pide reseña y avisa saldo", async () => {
    const prisma = prismaFake([row({ status: "CHECKED_IN" })]);
    const res = await applyStatusTransition(prisma as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CHECKED_OUT",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(prisma.updates[0].data.status).toBe("CHECKED_OUT");
    expect(prisma.crUpdates).toHaveLength(1);
    expect(vi.mocked(notifyPetAudience).mock.calls[0][2].type).toBe("CHECK_OUT");
    expect(requestReview).toHaveBeenCalledWith(prisma, "res_1");
    expect(notifyBalanceDue).toHaveBeenCalledWith(prisma, "res_1");
    // Sin reportes ni evidencias: mismas advertencias que /staff/stays/:id/checkout.
    expect(res.data.warnings).toHaveLength(2);
  });

  it("transición inválida: 409 INVALID_TRANSITION y no escribe nada", async () => {
    const prisma = prismaFake([row({ reservationType: "BATH" })]);
    const res = await applyStatusTransition(prisma as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CHECKED_IN",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("INVALID_TRANSITION");
    expect(prisma.updates).toHaveLength(0);
  });

  it("cancelar con pagos registrados: 409 HAS_PAYMENTS (va por /cancel)", async () => {
    const prisma = prismaFake([row()], { paidCount: 1 });
    const res = await applyStatusTransition(prisma as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CANCELLED",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("HAS_PAYMENTS");
    expect(prisma.updates).toHaveLength(0);
  });

  it("repetir el estado actual no es error", async () => {
    const prisma = prismaFake([row({ status: "CHECKED_IN" })]);
    const res = await applyStatusTransition(prisma as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CHECKED_IN",
    });
    expect(res.ok).toBe(true);
    expect(prisma.updates).toHaveLength(0);
    expect(notifyPetAudience).not.toHaveBeenCalled();
  });

  // Capturar historial: el panel da de alta una reserva del mes pasado y la
  // deja finalizada. Sin `notify: false` eso mandaba HOY "Molly ya salió", la
  // petición de reseña y el aviso de saldo de una estancia de hace semanas.
  it.each(["CHECKED_IN", "CHECKED_OUT", "CANCELLED"] as const)(
    "notify: false — aplica %s en base pero no manda ningún aviso",
    async (to) => {
      const desde = to === "CHECKED_OUT" ? "CHECKED_IN" : "CONFIRMED";
      const prisma = prismaFake([row({ status: desde })]);
      const res = await applyStatusTransition(prisma as unknown as Db, {
        ...base,
        reservationId: "res_1",
        to,
        notify: false,
      });
      expect(res.ok).toBe(true);
      expect(prisma.updates[0].data.status).toBe(to);
      expect(notifyPetAudience).not.toHaveBeenCalled();
      expect(requestReview).not.toHaveBeenCalled();
      expect(notifyBalanceDue).not.toHaveBeenCalled();
    }
  );

  it("applyToGroup: mueve TODAS las filas del grupo, y si una no puede, ninguna", async () => {
    const grupo = [
      row({ id: "res_1", groupId: "g1", pet: { name: "Molly" } }),
      row({ id: "res_2", groupId: "g1", petId: "pet_2", pet: { name: "Bailey" } }),
    ];
    const prisma = prismaFake(grupo);
    const res = await applyStatusTransition(prisma as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CHECKED_IN",
      applyToGroup: true,
    });
    expect(res.ok).toBe(true);
    expect(prisma.updates.map((u) => (u.where as { id: string }).id)).toEqual(["res_1", "res_2"]);
    expect(notifyPetAudience).toHaveBeenCalledTimes(2);

    const mixto = prismaFake([
      row({ id: "res_1", groupId: "g1" }),
      row({ id: "res_2", groupId: "g1", status: "CANCELLED", pet: { name: "Bailey" } }),
    ]);
    const res2 = await applyStatusTransition(mixto as unknown as Db, {
      ...base,
      reservationId: "res_1",
      to: "CHECKED_IN",
      applyToGroup: true,
    });
    expect(res2.ok).toBe(false);
    if (res2.ok) return;
    expect(res2.error).toContain("Bailey");
    expect(mixto.updates).toHaveLength(0);
  });
});
