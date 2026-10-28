import { describe, expect, it, vi } from "vitest";

vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({})) }));
vi.mock("../lib/reviewRequest", () => ({ requestReview: vi.fn(async () => undefined) }));
vi.mock("../lib/balanceReminder", () => ({ notifyBalanceDue: vi.fn(async () => undefined) }));

import { maybeConcludeStandaloneBath } from "./baths";

type Db = Parameters<typeof maybeConcludeStandaloneBath>[0];

function fakeDb(reservation: Record<string, unknown>) {
  const update = vi.fn(async () => ({}));
  const prisma = {
    reservation: { findUnique: async () => reservation, update },
    reservationChangeRequest: { updateMany: async () => ({ count: 0 }) },
  };
  return { prisma: prisma as unknown as Db, update };
}

const bathConCorte = (over: Record<string, unknown> = {}) => ({
  id: "res_1",
  reservationType: "BATH",
  status: "CONFIRMED",
  totalAmount: 350,
  homeDeliveryFee: null,
  payments: [{ amount: 350 }],
  addons: [
    {
      unitPrice: 350,
      completedAt: new Date(),
      extraPrice: null,
      extraPaymentStatus: null,
      variant: { deslanado: false, corte: true, serviceType: { code: "BATH" } },
    },
  ],
  ...over,
});

describe("maybeConcludeStandaloneBath", () => {
  it("corte sin cotizar y total = precio del catálogo → sigue abierto (falta cobrar el corte)", async () => {
    const { prisma, update } = fakeDb(bathConCorte());
    expect(await maybeConcludeStandaloneBath(prisma, "res_1")).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("corte metido en el total pactado y liquidado → concluye (caso Mila: $350 + $170)", async () => {
    const { prisma, update } = fakeDb(
      bathConCorte({ totalAmount: 520, payments: [{ amount: 520 }] }),
    );
    expect(await maybeConcludeStandaloneBath(prisma, "res_1")).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: "res_1" },
      data: { status: "CHECKED_OUT" },
    });
  });

  it("el domicilio no cuenta como precio del corte", async () => {
    const { prisma } = fakeDb(
      bathConCorte({ totalAmount: 430, homeDeliveryFee: 80, payments: [{ amount: 430 }] }),
    );
    expect(await maybeConcludeStandaloneBath(prisma, "res_1")).toBe(false);
  });

  it("corte en el total pero sin liquidar → sigue abierto", async () => {
    const { prisma } = fakeDb(
      bathConCorte({ totalAmount: 520, payments: [{ amount: 350 }] }),
    );
    expect(await maybeConcludeStandaloneBath(prisma, "res_1")).toBe(false);
  });
});
