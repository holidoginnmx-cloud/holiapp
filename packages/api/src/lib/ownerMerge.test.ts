import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { mergeOwnerInto, OwnerMergeError } from "./ownerMerge";

type U = Record<string, unknown>;

function user(over: U = {}): U {
  return {
    id: "u",
    role: "OWNER",
    isActive: true,
    clerkId: null,
    firstName: "Francisco",
    lastName: "Acosta",
    email: "walkin+x@holidoginn.local",
    phone: null,
    address: null,
    addressLat: null,
    addressLng: null,
    addressPlaceId: null,
    creditBalance: new Prisma.Decimal(0),
    lastCreditEntryAt: null,
    ...over,
  };
}

// Acosta: Nala en la ficha con el teléfono mal escrito, Luna en la buena.
const NALA = user({ id: "f_nala", phone: "6621017711", creditBalance: new Prisma.Decimal(150) });
const LUNA = user({ id: "f_luna", phone: "6621071121", creditBalance: new Prisma.Decimal(50) });

function makePrisma(usuarios: Record<string, U>, opts: { coDeFrom?: string[]; coDeInto?: string[]; propios?: string[] } = {}) {
  const updateMany = () => vi.fn(async () => ({ count: 1 }));
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => usuarios[where.id] ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: U }) => ({ ...usuarios[where.id], ...data })),
    },
    pet: { updateMany: updateMany(), findMany: vi.fn(async () => (opts.propios ?? []).map((id) => ({ id }))) },
    reservation: { updateMany: updateMany() },
    review: { updateMany: updateMany() },
    quote: { updateMany: updateMany() },
    payment: { updateMany: updateMany() },
    notification: { updateMany: updateMany() },
    pushToken: { updateMany: updateMany() },
    terminalCharge: { updateMany: updateMany() },
    cart: { updateMany: updateMany() },
    order: { updateMany: updateMany() },
    productReview: { updateMany: updateMany() },
    creditLedger: { updateMany: updateMany(), create: vi.fn(async () => ({})) },
    reservationChangeRequest: { updateMany: updateMany() },
    petInvite: { updateMany: updateMany() },
    stripePayoutLine: { updateMany: updateMany() },
    petCoOwner: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        (where.userId === "f_nala" ? opts.coDeFrom ?? [] : opts.coDeInto ?? []).map((petId) => ({ petId })),
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: updateMany(),
    },
    legalAcceptance: {
      findMany: vi.fn(async () => []),
      updateMany: updateMany(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

describe("mergeOwnerInto", () => {
  it("pasa perros, reservas, pagos, depósitos de Stripe y lo demás a la ficha que se queda", async () => {
    const { prisma, tx } = makePrisma({ f_nala: NALA, f_luna: LUNA });
    await mergeOwnerInto(prisma as never, "f_nala", "f_luna");
    expect(tx.pet.updateMany).toHaveBeenCalledWith({ where: { ownerId: "f_nala" }, data: { ownerId: "f_luna" } });
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({ where: { ownerId: "f_nala" }, data: { ownerId: "f_luna" } });
    expect(tx.quote.updateMany).toHaveBeenCalledWith({ where: { ownerId: "f_nala" }, data: { ownerId: "f_luna" } });
    for (const m of [tx.payment, tx.notification, tx.pushToken, tx.terminalCharge, tx.cart, tx.order, tx.productReview, tx.creditLedger]) {
      expect(m.updateMany).toHaveBeenCalledWith({ where: { userId: "f_nala" }, data: { userId: "f_luna" } });
    }
    expect(tx.reservationChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { requestedById: "f_nala" },
      data: { requestedById: "f_luna" },
    });
    expect(tx.stripePayoutLine.updateMany).toHaveBeenCalledWith({
      where: { metaOwnerId: "f_nala" },
      data: { metaOwnerId: "f_luna" },
    });
  });

  it("pasa el saldo con incremento, deja la fila del historial y da de baja la otra (sin borrarla)", async () => {
    const { prisma, tx } = makePrisma({ f_nala: NALA, f_luna: LUNA });
    const r = (await mergeOwnerInto(prisma as never, "f_nala", "f_luna")) as unknown as U;
    expect(tx.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "f_nala" },
      data: {
        isActive: false,
        email: "fusionada+f_nala@holidoginn.local",
        creditBalance: { decrement: NALA.creditBalance },
      },
    });
    expect(tx.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: "f_luna" },
      data: { creditBalance: { increment: NALA.creditBalance }, lastCreditEntryAt: expect.any(Date) },
    });
    expect(tx.creditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "f_luna", type: "CREDIT_ADJUSTED", amount: NALA.creditBalance }),
    });
    // Se queda el teléfono de la ficha que se queda.
    expect(r.phone).toBe("6621071121");
  });

  it("sin saldo que pasar no toca saldos ni el historial", async () => {
    const sinSaldo = user({ id: "f_nala" });
    const { prisma, tx } = makePrisma({ f_nala: sinSaldo, f_luna: LUNA });
    await mergeOwnerInto(prisma as never, "f_nala", "f_luna");
    expect(tx.creditLedger.create).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenNthCalledWith(2, { where: { id: "f_luna" }, data: {} });
  });

  it("el teléfono bueno puede ser el de la ficha que se va", async () => {
    const { prisma } = makePrisma({ f_nala: NALA, f_luna: LUNA });
    const r = (await mergeOwnerInto(prisma as never, "f_nala", "f_luna", { telefonoDe: "from" })) as unknown as U;
    expect(r.phone).toBe("6621017711");
  });

  it("libera SIEMPRE el correo de la ficha que se va, y la que se queda adopta el real si no tenía", async () => {
    const conCorreo = user({ id: "f_nala", phone: "6621017711", email: "acosta@example.com" });
    const { prisma, tx } = makePrisma({ f_nala: conCorreo, f_luna: user({ id: "f_luna" }) });
    const r = (await mergeOwnerInto(prisma as never, "f_nala", "f_luna")) as unknown as U;
    expect(tx.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "f_nala" },
      data: { isActive: false, email: "fusionada+f_nala@holidoginn.local" },
    });
    expect(r.email).toBe("acosta@example.com");
    expect(r.phone).toBe("6621017711");
  });

  it("con dos correos reales, la que se queda conserva el suyo y el de la otra igual se libera", async () => {
    const a = user({ id: "f_nala", email: "a@example.com" });
    const b = user({ id: "f_luna", email: "b@example.com" });
    const { prisma, tx } = makePrisma({ f_nala: a, f_luna: b });
    const r = (await mergeOwnerInto(prisma as never, "f_nala", "f_luna")) as unknown as U;
    expect(r.email).toBe("b@example.com");
    expect(tx.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "f_nala" },
      data: { isActive: false, email: "fusionada+f_nala@holidoginn.local" },
    });
  });

  it("quita los co-dueños que chocarían antes de moverlos", async () => {
    const { prisma, tx } = makePrisma(
      { f_nala: NALA, f_luna: LUNA },
      { coDeFrom: ["p_otro", "p_luna"], coDeInto: ["p_otro"], propios: ["p_luna", "p_nala"] },
    );
    await mergeOwnerInto(prisma as never, "f_nala", "f_luna");
    expect(tx.petCoOwner.deleteMany).toHaveBeenCalledWith({ where: { userId: "f_nala", petId: { in: ["p_otro"] } } });
    expect(tx.petCoOwner.deleteMany).toHaveBeenLastCalledWith({
      where: { userId: "f_luna", petId: { in: ["p_luna", "p_nala"] } },
    });
  });

  it("no da de baja una ficha con cuenta de la app, ni junta una consigo misma o con personal", async () => {
    const conApp = user({ id: "f_nala", clerkId: "user_x" });
    await expect(
      mergeOwnerInto(makePrisma({ f_nala: conApp, f_luna: LUNA }).prisma as never, "f_nala", "f_luna"),
    ).rejects.toBeInstanceOf(OwnerMergeError);
    await expect(
      mergeOwnerInto(makePrisma({ f_nala: NALA }).prisma as never, "f_nala", "f_nala"),
    ).rejects.toBeInstanceOf(OwnerMergeError);
    const staff = user({ id: "f_luna", role: "STAFF" });
    await expect(
      mergeOwnerInto(makePrisma({ f_nala: NALA, f_luna: staff }).prisma as never, "f_nala", "f_luna"),
    ).rejects.toBeInstanceOf(OwnerMergeError);
  });
});
