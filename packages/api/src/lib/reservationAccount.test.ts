import { describe, expect, it, vi } from "vitest";

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
vi.mock("../routes/baths", () => ({
  maybeConcludeStandaloneBath: vi.fn(async () => undefined),
}));

import { planAccountCharge, removeProductFromAccount } from "./reservationAccount";
import { registerManualPayment } from "./reservationAdminOps";

type Db = Parameters<typeof registerManualPayment>[0];

describe("planAccountCharge", () => {
  it("sin productos, todo va a la reserva", () => {
    const r = planAccountCharge(1000, []);
    expect(r).toEqual({ ok: true, products: [], remainder: 1000, remainderFee: null });
  });

  it("paga primero los productos completos y el resto es de la reserva", () => {
    const r = planAccountCharge(1580, [{ id: "o1", total: 180 }]);
    expect(r).toEqual({
      ok: true,
      products: [{ orderId: "o1", amount: 180, fee: null }],
      remainder: 1400,
      remainderFee: null,
    });
  });

  it("si no alcanza para los productos, no reparte", () => {
    expect(planAccountCharge(100, [{ id: "o1", total: 180 }])).toEqual({
      ok: false,
      productsTotal: 180,
    });
  });

  it("prorratea la comisión de tarjeta y la suma cuadra al centavo", () => {
    const r = planAccountCharge(1000, [{ id: "o1", total: 333.33 }], 37.12);
    if (!r.ok) throw new Error("debía alcanzar");
    const fees = r.products.reduce((s, p) => s + (p.fee ?? 0), 0) + (r.remainderFee ?? 0);
    expect(Math.round(fees * 100) / 100).toBe(37.12);
    expect(r.products[0]!.fee).toBe(12.37);
  });

  it("cobro exacto de productos: el residuo de la comisión va al último producto", () => {
    const r = planAccountCharge(300, [
      { id: "o1", total: 100 },
      { id: "o2", total: 200 },
    ], 10);
    if (!r.ok) throw new Error("debía alcanzar");
    expect(r.remainder).toBe(0);
    expect(r.remainderFee).toBeNull();
    expect(r.products.reduce((s, p) => s + (p.fee ?? 0), 0)).toBeCloseTo(10, 2);
  });
});

// ─── registerManualPayment con productos en la cuenta ─────────────────────────

function prismaFake(opts: {
  orders?: { id: string; total: number; orderNumber: number }[];
  ordenYaCobrada?: boolean;
}) {
  const created: Record<string, unknown>[] = [];
  const orderUpdates: { where: unknown; data: unknown }[] = [];
  const tx = {
    order: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        orderUpdates.push(args);
        return { count: opts.ordenYaCobrada ? 0 : 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({
        orderNumber: opts.orders?.find((o) => o.id === where.id)?.orderNumber ?? 0,
      }),
    },
    payment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `pay_${created.length}`, ...data };
      },
    },
  };
  const prisma = {
    reservation: {
      findUnique: async () => ({
        id: "res_1",
        status: "CHECKED_IN",
        reservationType: "STAY",
        totalAmount: 1400,
        groupId: null,
        ownerId: "usr_owner",
        petId: "pet_1",
        pet: { name: "Coco" },
        payments: [{ amount: 280 }],
      }),
      findMany: async () => [],
    },
    order: {
      findMany: async () =>
        (opts.orders ?? []).map((o) => ({ ...o, items: [], createdAt: new Date() })),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as Db;
  return { prisma, created, orderUpdates };
}

const actor = { userId: "usr_admin", isAdmin: true };

describe("registerManualPayment — productos en la cuenta", () => {
  it("parte el cobro: el producto a su pedido (TIENDA) y el resto a la reserva", async () => {
    const { prisma, created, orderUpdates } = prismaFake({
      orders: [{ id: "ord_1", total: 180, orderNumber: 15 }],
    });
    const res = await registerManualPayment(prisma, {
      reservationId: "res_1",
      input: { amount: 1300, method: "CASH" },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ orderId: "ord_1", reservationId: null, status: "PAID" });
    expect(Number(created[0]!.amount)).toBe(180);
    expect(created[1]).toMatchObject({ reservationId: "res_1", kind: "RESTANTE" });
    expect(Number(created[1]!.amount)).toBe(1120);
    expect(orderUpdates[0]).toMatchObject({
      where: { id: "ord_1", status: "PENDING" },
      data: { status: "PAID" },
    });
    expect(res.data.balance).toBe(0);
    expect(res.data.productsCharged).toBe(180);
  });

  it("si el cobro no alcanza para los productos, 400 y no escribe nada", async () => {
    const { prisma, created } = prismaFake({ orders: [{ id: "ord_1", total: 180, orderNumber: 15 }] });
    const res = await registerManualPayment(prisma, {
      reservationId: "res_1",
      input: { amount: 100, method: "CASH" },
      actor,
    });
    expect(res).toMatchObject({ ok: false, status: 400, code: "ACCOUNT_PRODUCTS_UNPAID" });
    expect(created).toHaveLength(0);
  });

  it("includeAccountProducts:false cobra solo la reserva", async () => {
    const { prisma, created } = prismaFake({ orders: [{ id: "ord_1", total: 180, orderNumber: 15 }] });
    const res = await registerManualPayment(prisma, {
      reservationId: "res_1",
      input: { amount: 100, method: "CASH", includeAccountProducts: false },
      actor,
    });
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ reservationId: "res_1" });
  });

  it("si otro cobro ya pagó el pedido, 409 en vez de cobrarlo dos veces", async () => {
    const { prisma } = prismaFake({
      orders: [{ id: "ord_1", total: 180, orderNumber: 15 }],
      ordenYaCobrada: true,
    });
    const res = await registerManualPayment(prisma, {
      reservationId: "res_1",
      input: { amount: 1300, method: "CASH" },
      actor,
    });
    expect(res).toMatchObject({ ok: false, status: 409, code: "ACCOUNT_CONFLICT" });
  });

  it("tarjeta: la comisión se reparte entre el producto y la reserva", async () => {
    const { prisma, created } = prismaFake({ orders: [{ id: "ord_1", total: 200, orderNumber: 15 }] });
    await registerManualPayment(prisma, {
      reservationId: "res_1",
      input: { amount: 1000, method: "CARD", cardBrand: "DEBIT", cardFeePct: 2, cardFeeAmount: 20 },
      actor,
    });
    expect(Number(created[0]!.cardFeeAmount)).toBe(4);
    expect(Number(created[1]!.cardFeeAmount)).toBe(16);
  });

  it("sin productos se comporta como siempre: un solo pago a la reserva", async () => {
    const { prisma, created } = prismaFake({});
    const res = await registerManualPayment(prisma, {
      reservationId: "res_1",
      input: { amount: 500, method: "TRANSFER" },
      actor,
    });
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ reservationId: "res_1", kind: "ABONO" });
  });
});

describe("removeProductFromAccount", () => {
  it("no quita un producto ya cobrado", async () => {
    const prisma = {
      orderItem: {
        findUnique: async () => ({
          id: "it_1",
          quantity: 1,
          variantId: "v1",
          order: { id: "ord_1", status: "PAID", reservationId: "res_1" },
        }),
      },
    } as unknown as Parameters<typeof removeProductFromAccount>[0];
    const res = await removeProductFromAccount(prisma, { reservationId: "res_1", itemId: "it_1" });
    expect(res).toMatchObject({ ok: false, status: 409, code: "ALREADY_PAID" });
  });

  it("no toca un producto de otra reserva", async () => {
    const prisma = {
      orderItem: {
        findUnique: async () => ({
          id: "it_1",
          quantity: 1,
          variantId: "v1",
          order: { id: "ord_1", status: "PENDING", reservationId: "res_otra" },
        }),
      },
    } as unknown as Parameters<typeof removeProductFromAccount>[0];
    const res = await removeProductFromAccount(prisma, { reservationId: "res_1", itemId: "it_1" });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });
});
