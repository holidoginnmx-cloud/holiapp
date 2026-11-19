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
vi.mock("../routes/baths", () => ({
  maybeConcludeStandaloneBath: vi.fn(async () => undefined),
}));

import { notifyPetAudience, notifyTeamReservationUpdated } from "./notify";
import { maybeConcludeStandaloneBath } from "../routes/baths";
import { registerUnassignedDeposit, assignDepositToReservation } from "./unassignedDeposits";

type Db = Parameters<typeof registerUnassignedDeposit>[0];
const actor = { userId: "usr_admin", isAdmin: true };

const pagoSuelto = (over: Record<string, unknown> = {}) => ({
  id: "pay_1",
  amount: 350,
  status: "PAID",
  reservationId: null,
  orderId: null,
  userId: "usr_owner",
  ...over,
});

const reservaFake = (over: Record<string, unknown> = {}) => ({
  id: "res_1",
  status: "CONFIRMED",
  reservationType: "STAY",
  groupId: null,
  ownerId: "usr_owner",
  petId: "pet_1",
  staffId: null,
  totalAmount: 1400,
  pet: { name: "Coco" },
  owner: { firstName: "Ana", lastName: "Ruiz" },
  ...over,
});

function prismaFake(opts: {
  usuario?: Record<string, unknown> | null;
  pago?: Record<string, unknown> | null;
  reserva?: Record<string, unknown> | null;
  coDueno?: boolean;
  pagosDeReserva?: number[];
  asignados?: number;
  onCreate?: (data: Record<string, unknown>) => void;
  onAssign?: (args: { where: unknown; data: Record<string, unknown> }) => void;
}) {
  return {
    user: { findUnique: async () => opts.usuario ?? null },
    payment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        opts.onCreate?.(data);
        return { id: "pay_new", ...data };
      },
      findUnique: async () => opts.pago ?? null,
      findUniqueOrThrow: async () => ({ ...(opts.pago ?? {}), reservationId: "res_1" }),
      updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
        opts.onAssign?.(args);
        return { count: opts.asignados ?? 1 };
      },
      findMany: async () => (opts.pagosDeReserva ?? []).map((amount) => ({ amount })),
    },
    reservation: {
      findUnique: async () => opts.reserva ?? null,
      findMany: async () => [],
    },
    petCoOwner: { count: async () => (opts.coDueno ? 1 : 0) },
  } as unknown as Db;
}

beforeEach(() => {
  vi.mocked(notifyPetAudience).mockClear();
  vi.mocked(notifyTeamReservationUpdated).mockClear();
  vi.mocked(maybeConcludeStandaloneBath).mockClear();
});

describe("registerUnassignedDeposit", () => {
  it("crea un PAID/ANTICIPO sin reserva ni pedido y no avisa al cliente", async () => {
    let creado: Record<string, unknown> | null = null;
    const res = await registerUnassignedDeposit(
      prismaFake({ usuario: { id: "usr_owner" }, onCreate: (d) => (creado = d) }),
      { input: { amount: 350, method: "TRANSFER", userId: "usr_owner" }, actor }
    );
    expect(res.ok).toBe(true);
    expect(creado).toMatchObject({
      status: "PAID",
      kind: "ANTICIPO",
      reservationId: null,
      orderId: null,
      userId: "usr_owner",
      method: "TRANSFER",
    });
    expect(Number((creado as unknown as { amount: unknown }).amount)).toBe(350);
    expect(notifyPetAudience).not.toHaveBeenCalled();
  });

  it("sin cliente exige el nombre en las notas", async () => {
    const res = await registerUnassignedDeposit(prismaFake({}), {
      input: { amount: 350, method: "CASH" },
      actor,
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("sin ficha pero con nombre se registra con userId null", async () => {
    let creado: Record<string, unknown> | null = null;
    const res = await registerUnassignedDeposit(prismaFake({ onCreate: (d) => (creado = d) }), {
      input: { amount: 500, method: "CASH", notes: "Anticipo de Laura (Max)" },
      actor,
    });
    expect(res.ok).toBe(true);
    expect(creado).toMatchObject({ userId: null, notes: "Anticipo de Laura (Max)" });
  });

  it("rechaza un cliente que no existe", async () => {
    const res = await registerUnassignedDeposit(prismaFake({ usuario: null }), {
      input: { amount: 350, method: "CASH", userId: "usr_x" },
      actor,
    });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });

  it("guarda el recargo de tarjeta solo si es CARD", async () => {
    let creado: Record<string, unknown> | null = null;
    await registerUnassignedDeposit(
      prismaFake({ usuario: { id: "u" }, onCreate: (d) => (creado = d) }),
      {
        input: {
          amount: 1000,
          method: "TRANSFER",
          userId: "u",
          cardBrand: "VISA",
          cardFeeAmount: 30,
        },
        actor,
      }
    );
    expect(creado).toMatchObject({ cardBrand: null, cardFeeAmount: null });
  });
});

describe("assignDepositToReservation", () => {
  it("cuelga el anticipo de la reserva del mismo dueño, recalcula saldo y avisa al equipo", async () => {
    let asignacion: { where: unknown; data: Record<string, unknown> } | null = null;
    const res = await assignDepositToReservation(
      prismaFake({
        pago: pagoSuelto(),
        reserva: reservaFake(),
        pagosDeReserva: [350],
        onAssign: (a) => (asignacion = a),
      }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.balance).toBe(1050);
    // Condicional: solo si sigue suelto (dos asignaciones a la vez → una gana).
    expect(asignacion).toMatchObject({
      where: { id: "pay_1", reservationId: null, orderId: null },
      data: { reservationId: "res_1", userId: "usr_owner" },
    });
    expect(notifyTeamReservationUpdated).toHaveBeenCalledOnce();
    expect(notifyPetAudience).not.toHaveBeenCalled();
  });

  it("otro dueño sin confirmar → 409 OTHER_OWNER y no toca el pago", async () => {
    const onAssign = vi.fn();
    const res = await assignDepositToReservation(
      prismaFake({
        pago: pagoSuelto({ userId: "usr_otro" }),
        reserva: reservaFake(),
        onAssign,
      }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(res).toMatchObject({ ok: false, status: 409, code: "OTHER_OWNER" });
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("otro dueño confirmado → asigna y deja el pago a nombre del dueño de la reserva", async () => {
    let asignacion: { data: Record<string, unknown> } | null = null;
    const res = await assignDepositToReservation(
      prismaFake({
        pago: pagoSuelto({
          userId: "usr_otro",
          notes: "Anticipo sin reserva",
          user: { firstName: "Luis", lastName: "Pérez" },
        }),
        reserva: reservaFake(),
        onAssign: (a) => (asignacion = a),
      }),
      { paymentId: "pay_1", reservationId: "res_1", confirmOtherOwner: true, actor }
    );
    expect(res.ok).toBe(true);
    expect(asignacion).toMatchObject({
      data: { userId: "usr_owner", notes: "Anticipo sin reserva · Pagado por Luis Pérez" },
    });
  });

  it("un co-dueño de la mascota no necesita confirmación", async () => {
    const res = await assignDepositToReservation(
      prismaFake({ pago: pagoSuelto({ userId: "usr_co" }), reserva: reservaFake(), coDueno: true }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(res.ok).toBe(true);
  });

  it("un anticipo sin cliente se asigna sin preguntar", async () => {
    const res = await assignDepositToReservation(
      prismaFake({ pago: pagoSuelto({ userId: null }), reserva: reservaFake() }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(res.ok).toBe(true);
  });

  it("rechaza un pago que ya cuelga de una reserva o de un pedido", async () => {
    for (const over of [{ reservationId: "res_9" }, { orderId: "ord_1" }]) {
      const res = await assignDepositToReservation(
        prismaFake({ pago: pagoSuelto(over), reserva: reservaFake() }),
        { paymentId: "pay_1", reservationId: "res_1", actor }
      );
      expect(res).toMatchObject({ ok: false, status: 409, code: "ALREADY_ASSIGNED" });
    }
  });

  it("rechaza un reembolso y una reserva cancelada", async () => {
    const r1 = await assignDepositToReservation(
      prismaFake({ pago: pagoSuelto({ status: "REFUNDED" }), reserva: reservaFake() }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(r1).toMatchObject({ ok: false, status: 409 });
    const r2 = await assignDepositToReservation(
      prismaFake({ pago: pagoSuelto(), reserva: reservaFake({ status: "CANCELLED" }) }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(r2).toMatchObject({ ok: false, status: 400, code: "CANCELLED" });
  });

  it("si otra persona lo asignó en medio, responde 409 en vez de moverlo", async () => {
    const res = await assignDepositToReservation(
      prismaFake({ pago: pagoSuelto(), reserva: reservaFake(), asignados: 0 }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(res).toMatchObject({ ok: false, status: 409, code: "ALREADY_ASSIGNED" });
  });

  it("un baño suelto que queda liquidado se concluye", async () => {
    await assignDepositToReservation(
      prismaFake({
        pago: pagoSuelto(),
        reserva: reservaFake({ reservationType: "BATH", totalAmount: 350 }),
        pagosDeReserva: [350],
      }),
      { paymentId: "pay_1", reservationId: "res_1", actor }
    );
    expect(maybeConcludeStandaloneBath).toHaveBeenCalledWith(expect.anything(), "res_1");
  });
});
