import { beforeEach, describe, expect, it, vi } from "vitest";

type NotifyOpts = { type: string; title: string; body: string; data?: unknown };

const notifyUser = vi.fn(async (_prisma: unknown, _opts: NotifyOpts) => ({}));
vi.mock("./notify", () => ({
  notifyUser: (prisma: unknown, opts: NotifyOpts) => notifyUser(prisma, opts),
}));

const notifiedWith = (n = 0): NotifyOpts => notifyUser.mock.calls[n]![1];

const { notifyBalanceDue } = await import("./balanceReminder");

// Lo que se rompía antes: una visita que cerraba debiendo dinero no le avisaba
// a nadie, y la app además le escondía el botón de pago al cliente.

type Row = {
  id: string;
  groupId: string | null;
  ownerId: string;
  status: string;
  reservationType: string;
  totalAmount: number;
  balanceReminderAt: Date | null;
  checkOut: Date | null;
  appointmentAt: Date | null;
  updatedAt: Date | null;
  pet: { name: string };
  payments: { amount: number }[];
};

function fakePrisma(rows: Row[]) {
  const updated: { ids: string[]; at: Date }[] = [];
  return {
    updated,
    rows,
    reservation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: any }) =>
        where.groupId
          ? rows.filter(
              (r) => r.groupId === where.groupId && r.ownerId === where.ownerId,
            )
          : rows.filter((r) => r.id === where.id),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { balanceReminderAt: Date };
      }) => {
        updated.push({ ids: where.id.in, at: data.balanceReminderAt });
        for (const r of rows) {
          if (where.id.in.includes(r.id)) r.balanceReminderAt = data.balanceReminderAt;
        }
        return { count: where.id.in.length };
      },
    },
  };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "res_1",
  groupId: null,
  ownerId: "user_1",
  status: "CHECKED_OUT",
  reservationType: "STAY",
  totalAmount: 1000,
  balanceReminderAt: null,
  checkOut: new Date(),
  appointmentAt: null,
  updatedAt: new Date(),
  pet: { name: "Loki" },
  payments: [],
  ...over,
});

beforeEach(() => notifyUser.mockClear());

describe("notifyBalanceDue", () => {
  it("avisa cuando la estancia cerró con saldo", async () => {
    const db = fakePrisma([row({ payments: [{ amount: 200 }] })]);

    expect(await notifyBalanceDue(db as never, "res_1")).toBe(true);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    const opts = notifiedWith();
    expect(opts.type).toBe("GENERAL");
    expect(opts.title).toContain("800");
    expect(opts.data).toMatchObject({ kind: "BALANCE_DUE", reservationId: "res_1" });
    expect(db.updated[0]!.ids).toEqual(["res_1"]);
  });

  it("no avisa si ya se pagó todo", async () => {
    const db = fakePrisma([row({ payments: [{ amount: 1000 }] })]);
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(false);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("es idempotente: dos cierres no mandan dos avisos", async () => {
    const db = fakePrisma([row()]);
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(true);
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(false);
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });

  it("espera a que cierre la última mascota de la visita", async () => {
    const rows = [
      row({ id: "res_1", groupId: "g1", status: "CHECKED_OUT", totalAmount: 500 }),
      row({ id: "res_2", groupId: "g1", status: "CHECKED_IN", totalAmount: 500 }),
    ];
    const db = fakePrisma(rows);

    expect(await notifyBalanceDue(db as never, "res_1")).toBe(false);
    expect(notifyUser).not.toHaveBeenCalled();

    rows[1]!.status = "CHECKED_OUT";
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(true);
    // UN aviso por visita, no uno por perro, y con el saldo del grupo entero.
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifiedWith().title).toContain("1,000");
    expect(db.updated[0]!.ids).toEqual(["res_1", "res_2"]);
  });

  it("el saldo de la visita ignora a las canceladas", async () => {
    const db = fakePrisma([
      row({ id: "res_1", groupId: "g1", totalAmount: 500 }),
      row({ id: "res_2", groupId: "g1", totalAmount: 500, status: "CANCELLED" }),
    ]);
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(true);
    expect(notifiedWith().title).toContain("500");
  });

  it("una visita entera cancelada no avisa nada", async () => {
    const db = fakePrisma([row({ status: "CANCELLED" })]);
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(false);
  });

  it("el copy cambia según el servicio", async () => {
    const db = fakePrisma([row({ reservationType: "DAYCARE" })]);
    await notifyBalanceDue(db as never, "res_1");
    expect(notifiedWith().body).toContain("la guardería");
  });

  it("no persigue el saldo de una visita vieja: seguro se cobró en mostrador", async () => {
    const hace2meses = new Date(Date.now() - 60 * 86_400_000);
    const db = fakePrisma([row({ checkOut: hace2meses, updatedAt: hace2meses })]);
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(false);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("un fallo de la DB no tumba el check-out", async () => {
    const db = {
      reservation: {
        findUnique: async () => {
          throw new Error("db caída");
        },
      },
    };
    expect(await notifyBalanceDue(db as never, "res_1")).toBe(false);
  });
});
