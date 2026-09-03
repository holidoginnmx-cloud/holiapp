import { describe, expect, it, vi, beforeEach } from "vitest";

// refund.ts instancia Stripe al cargar; aquí nunca se toca la red.
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({ refunds: { create: vi.fn() } })),
}));
vi.mock("./refund", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./refund")>();
  return { ...actual, processRefund: vi.fn() };
});
vi.mock("./notify", () => ({
  notifyUser: vi.fn(async () => ({})),
  notifyUsers: vi.fn(async () => 0),
  notifyPetAudience: vi.fn(async () => 0),
  notifyTeamReservationUpdated: vi.fn(async () => undefined),
}));
vi.mock("./petAccess", () => ({
  petAudienceIds: vi.fn(async (_p: unknown, _petId: string, ownerId?: string) =>
    ownerId ? [ownerId] : []
  ),
}));

import { processRefund } from "./refund";
import { notifyPetAudience, notifyUsers, notifyTeamReservationUpdated } from "./notify";
import {
  planGroupCancellation,
  cancelReservations,
  inferPaymentKind,
  splitGroupTotal,
  splitProportional,
  joinNames,
  deletePayment,
  deleteReservation,
  registerManualPayment,
  updatePayment,
  updateReservationAddon,
  changeReservationPet,
  type CancelRowInput,
} from "./reservationAdminOps";

const pago = (
  id: string,
  amount: number,
  method: string,
  pi: string | null = null,
  status = "PAID"
) => ({ id, amount, method, status, stripePaymentIntentId: pi });

describe("planGroupCancellation — reparto del reembolso en el grupo", () => {
  const molly: CancelRowInput = {
    id: "res_1",
    petName: "Molly",
    payments: [pago("p1", 300, "STRIPE", "pi_1")],
  };
  const bailey: CancelRowInput = {
    id: "res_2",
    petName: "Bailey",
    payments: [pago("p2", 700, "CASH")],
  };

  it("STRIPE_REFUND: la fila con tarjeta va a Stripe y la hermana en efectivo cae a saldo", () => {
    const plan = planGroupCancellation([molly, bailey], "STRIPE_REFUND");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.totalPaid).toBe(1000);
    expect(plan.rows[0]).toMatchObject({ effectiveChoice: "STRIPE_REFUND", toStripe: 300, toCredit: 0 });
    expect(plan.rows[1]).toMatchObject({ effectiveChoice: "CREDIT", toStripe: 0, toCredit: 700 });
  });

  it("fila hermana STRIPE sin PI usa el PI del grupo", () => {
    const hermana: CancelRowInput = {
      id: "res_2",
      petName: "Bailey",
      payments: [pago("p2", 200, "STRIPE", null)],
    };
    const plan = planGroupCancellation([molly, hermana], "STRIPE_REFUND");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.groupPaymentIntentId).toBe("pi_1");
    expect(plan.rows[1]).toMatchObject({ effectiveChoice: "STRIPE_REFUND", toStripe: 200 });
  });

  it("STRIPE_REFUND sin ninguna tarjeta en el grupo: error, elige saldo", () => {
    const plan = planGroupCancellation([bailey], "STRIPE_REFUND");
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe("NO_CARD_PAYMENT");
  });

  it("CREDIT: todo a saldo, fila por fila", () => {
    const plan = planGroupCancellation([molly, bailey], "CREDIT");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows.map((r) => r.toCredit)).toEqual([300, 700]);
    expect(plan.rows.every((r) => r.effectiveChoice === "CREDIT")).toBe(true);
  });

  it("NONE: nadie devuelve nada; ASK_CLIENT solo marca las filas con dinero", () => {
    const sinPago: CancelRowInput = { id: "res_3", petName: "Loki", payments: [] };
    const none = planGroupCancellation([molly, sinPago], "NONE");
    expect(none.ok && none.rows.every((r) => r.effectiveChoice === "NONE")).toBe(true);

    const ask = planGroupCancellation([molly, sinPago], "ASK_CLIENT");
    expect(ask.ok && ask.rows.map((r) => r.effectiveChoice)).toEqual(["ASK_CLIENT", "NONE"]);
  });

  // Reintento tras un fallo parcial: la fila ya reembolsada NO tumba al grupo.
  const yaReembolsada: CancelRowInput = {
    id: "res_2",
    petName: "Bailey",
    payments: [pago("p2", 700, "CASH"), pago("p2r", 700, "CREDIT", null, "REFUNDED")],
  };

  it.each(["STRIPE_REFUND", "CREDIT", "NONE"] as const)(
    "reintento con %s: la fila ya reembolsada se salta y la otra sigue su curso",
    (choice) => {
      const plan = planGroupCancellation([molly, yaReembolsada], choice);
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.rows[1]).toMatchObject({
        effectiveChoice: "ALREADY_REFUNDED",
        alreadyRefunded: 700,
        toStripe: 0,
        toCredit: 0,
      });
      // La hermana pendiente conserva la elección pedida.
      expect(plan.rows[0].effectiveChoice).toBe(choice === "NONE" ? "NONE" : choice);
    }
  );

  it("reintento con STRIPE_REFUND cuando la ÚNICA fila con tarjeta ya se reembolsó: no muere con NO_CARD_PAYMENT", () => {
    const mollyYaDevuelta: CancelRowInput = {
      id: "res_1",
      petName: "Molly",
      payments: [pago("p1", 300, "STRIPE", "pi_1"), pago("p1r", 300, "STRIPE", "re_1", "REFUNDED")],
    };
    const enEfectivo: CancelRowInput = {
      id: "res_2",
      petName: "Bailey",
      payments: [pago("p2", 700, "CASH")],
    };
    const plan = planGroupCancellation([mollyYaDevuelta, enEfectivo], "STRIPE_REFUND");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows[0].effectiveChoice).toBe("ALREADY_REFUNDED");
    // La hermana en efectivo cae a saldo, como siempre.
    expect(plan.rows[1]).toMatchObject({ effectiveChoice: "CREDIT", toCredit: 700 });
  });

  it("con TODAS las filas ya reembolsadas el plan sigue siendo válido (solo queda cancelar)", () => {
    const plan = planGroupCancellation([yaReembolsada], "STRIPE_REFUND");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rows[0].effectiveChoice).toBe("ALREADY_REFUNDED");
  });

  it("el PI del grupo es el más antiguo por paidAt, no el de la primera fila", () => {
    const d = (iso: string) => new Date(iso);
    const tarde: CancelRowInput = {
      id: "res_1",
      petName: "Molly",
      payments: [
        { ...pago("p_liq", 500, "STRIPE", "pi_liquidacion"), paidAt: d("2026-08-20T10:00:00Z") },
      ],
    };
    const temprano: CancelRowInput = {
      id: "res_2",
      petName: "Bailey",
      payments: [
        { ...pago("p_booking", 300, "STRIPE", "pi_booking"), paidAt: d("2026-08-01T10:00:00Z") },
        { ...pago("p_sin_pi", 200, "STRIPE", null), paidAt: d("2026-08-02T10:00:00Z") },
      ],
    };
    const plan = planGroupCancellation([tarde, temprano], "STRIPE_REFUND");
    expect(plan.ok && plan.groupPaymentIntentId).toBe("pi_booking");
  });

  it("pagos REFUNDED/UNPAID no cuentan como pagado", () => {
    const fila: CancelRowInput = {
      id: "res_1",
      petName: "Molly",
      payments: [pago("p1", 300, "CASH", null, "UNPAID")],
    };
    const plan = planGroupCancellation([fila], "CREDIT");
    expect(plan.ok && plan.totalPaid).toBe(0);
    expect(plan.ok && plan.rows[0].effectiveChoice).toBe("NONE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

type Fila = {
  id: string;
  status: string;
  groupId: string | null;
  ownerId: string;
  petId: string;
  staffId: string | null;
  pet: { name: string };
  payments: Array<ReturnType<typeof pago>>;
};

function prismaCancelFake(rows: Fila[]) {
  const updateMany: Array<{ where: unknown; data: unknown }> = [];
  const fake = {
    updateMany,
    reservation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: { groupId?: string; id?: string } }) =>
        rows.filter((r) => (where.groupId ? r.groupId === where.groupId : r.id === where.id)),
      updateMany: async (args: { where: unknown; data: unknown }) => {
        updateMany.push(args);
        return { count: 1 };
      },
    },
    reservationChangeRequest: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fake),
  };
  return fake;
}
type Db = Parameters<typeof cancelReservations>[0];
const actor = { userId: "usr_web", isAdmin: true };

describe("cancelReservations — cancela el grupo completo y reembolsa fila por fila", () => {
  beforeEach(() => {
    vi.mocked(processRefund).mockReset();
    vi.mocked(notifyPetAudience).mockClear();
    vi.mocked(notifyUsers).mockClear();
    vi.mocked(notifyTeamReservationUpdated).mockClear();
  });

  const grupo = (): Fila[] => [
    {
      id: "res_1",
      status: "CONFIRMED",
      groupId: "g1",
      ownerId: "usr_owner",
      petId: "pet_1",
      staffId: null,
      pet: { name: "Molly" },
      payments: [pago("p1", 300, "STRIPE", "pi_1")],
    },
    {
      id: "res_2",
      status: "CONFIRMED",
      groupId: "g1",
      ownerId: "usr_owner",
      petId: "pet_2",
      staffId: null,
      pet: { name: "Bailey" },
      payments: [pago("p2", 700, "CASH")],
    },
  ];

  it("STRIPE_REFUND: processRefund por fila con la elección efectiva, luego CANCELLED para todas", async () => {
    vi.mocked(processRefund).mockImplementation(async (_p, o) => ({
      refundAmount: o.refundChoice === "STRIPE_REFUND" ? 300 : 700,
      refundChoice: o.refundChoice,
      refundedToCard: o.refundChoice === "STRIPE_REFUND" ? 300 : 0,
      creditedToBalance: o.refundChoice === "CREDIT" ? 700 : 0,
    }));
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_2", // desde la hermana: igual cancela el grupo
      refundChoice: "STRIPE_REFUND",
      scope: "group",
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(vi.mocked(processRefund).mock.calls.map((c) => c[1])).toEqual([
      { reservationId: "res_1", refundChoice: "STRIPE_REFUND", notify: true },
      { reservationId: "res_2", refundChoice: "CREDIT", notify: true },
    ]);
    expect(prisma.updateMany[0]).toEqual({
      where: { id: { in: ["res_1", "res_2"] } },
      data: { status: "CANCELLED" },
    });
    expect(res.data).toMatchObject({
      reservationIds: ["res_1", "res_2"],
      refundedToCard: 300,
      creditedToBalance: 700,
      refundAmount: 1000,
      awaitingClientChoice: false,
    });
    // Un solo aviso de cancelación al cliente (los del dinero los manda processRefund).
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyUsers).mock.calls[0][2].body).toContain("Molly y Bailey");
    // Y al equipo, excluyendo a quien canceló.
    expect(vi.mocked(notifyTeamReservationUpdated).mock.calls[0][1]).toMatchObject({
      actorUserId: "usr_web",
    });
  });

  it("si Stripe rechaza, no se cancela nada y se devuelve 409", async () => {
    vi.mocked(processRefund).mockRejectedValue(new Error("Stripe dijo que no"));
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "CREDIT",
      scope: "group",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("REFUND_FAILED");
    expect(res.error).toContain("Molly");
    expect(prisma.updateMany).toHaveLength(0);
  });

  it("NONE: sin reembolso, cancela y avisa", async () => {
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "NONE",
      scope: "group",
      actor,
    });
    expect(res.ok).toBe(true);
    expect(processRefund).not.toHaveBeenCalled();
    expect(prisma.updateMany).toHaveLength(1);
  });

  it("ASK_CLIENT: cancela y manda CHOOSE_REFUND por cada fila con dinero (como /admin/…/cancel)", async () => {
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "ASK_CLIENT",
      scope: "group",
      actor,
    });
    expect(res.ok && res.data.awaitingClientChoice).toBe(true);
    expect(processRefund).not.toHaveBeenCalled();
    expect(notifyPetAudience).toHaveBeenCalledTimes(2);
    const datos = vi.mocked(notifyPetAudience).mock.calls.map((c) => c[2].data);
    expect(datos).toEqual([
      { action: "CHOOSE_REFUND", reservationId: "res_1", refundAmount: 300 },
      { action: "CHOOSE_REFUND", reservationId: "res_2", refundAmount: 700 },
    ]);
  });

  it("scope single: solo la fila pedida", async () => {
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_2",
      refundChoice: "NONE",
      scope: "single",
      actor,
    });
    expect(res.ok && res.data.reservationIds).toEqual(["res_2"]);
  });

  it("una hermana hospedada bloquea la cancelación del grupo", async () => {
    const rows = grupo();
    rows[1].status = "CHECKED_IN";
    const prisma = prismaCancelFake(rows);
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "NONE",
      scope: "group",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_CONFIRMED");
    expect(res.error).toContain("Bailey");
  });

  it("una hermana ya cancelada no estorba", async () => {
    const rows = grupo();
    rows[1].status = "CANCELLED";
    const prisma = prismaCancelFake(rows);
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "NONE",
      scope: "group",
      actor,
    });
    expect(res.ok && res.data.reservationIds).toEqual(["res_1"]);
  });

  // ── Fallo parcial y reintento (el bloqueante de la revisión) ─────────────
  //
  // Antes: reembolsaba Molly, fallaba Bailey, devolvía 409 sin cancelar, y el
  // reintento moría con ALREADY_REFUNDED por el renglón de Molly — dinero
  // devuelto, reservas vivas ocupando cuarto y salida solo por SQL.

  /** Estado de la base DESPUÉS del fallo: Molly ya tiene su renglón REFUNDED. */
  const grupoTrasFalloParcial = (): Fila[] => {
    const rows = grupo();
    rows[0].payments.push(pago("p1r", 300, "STRIPE", "re_1", "REFUNDED"));
    return rows;
  };

  it("el 409 de un fallo parcial dice qué fila se reembolsó y cuál no", async () => {
    vi.mocked(processRefund)
      .mockResolvedValueOnce({
        refundAmount: 300,
        refundChoice: "STRIPE_REFUND",
        refundedToCard: 300,
        creditedToBalance: 0,
      })
      .mockRejectedValueOnce(new Error("Stripe dijo que no"));
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "STRIPE_REFUND",
      scope: "group",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("REFUND_FAILED");
    expect(prisma.updateMany).toHaveLength(0); // nada se canceló
    const filas = res.extra?.rows as Array<Record<string, unknown>>;
    expect(filas[0]).toMatchObject({ petName: "Molly", refunded: true, refundedToCard: 300 });
    expect(filas[1]).toMatchObject({ petName: "Bailey", refunded: false, error: "Stripe dijo que no" });
    expect(res.extra).toMatchObject({ refundedToCard: 300, creditedToBalance: 0 });
  });

  it.each(["STRIPE_REFUND", "CREDIT", "NONE"] as const)(
    "reintento con %s tras el fallo parcial: no reembolsa dos veces a Molly y cancela el grupo",
    async (choice) => {
      vi.mocked(processRefund).mockResolvedValue({
        refundAmount: 700,
        refundChoice: "CREDIT",
        refundedToCard: 0,
        creditedToBalance: 700,
      });
      const prisma = prismaCancelFake(grupoTrasFalloParcial());
      const res = await cancelReservations(prisma as unknown as Db, {
        reservationId: "res_1",
        refundChoice: choice,
        scope: "group",
        actor,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // Molly NUNCA vuelve a pasar por processRefund.
      const tocadas = vi.mocked(processRefund).mock.calls.map((c) => c[1].reservationId);
      expect(tocadas).not.toContain("res_1");
      expect(tocadas).toEqual(choice === "NONE" ? [] : ["res_2"]);
      // Y el grupo COMPLETO queda cancelado.
      expect(prisma.updateMany[0]).toEqual({
        where: { id: { in: ["res_1", "res_2"] } },
        data: { status: "CANCELLED" },
      });
      expect(res.data.rows[0]).toMatchObject({
        petName: "Molly",
        effectiveChoice: "ALREADY_REFUNDED",
        wasAlreadyRefunded: true,
        refunded: false,
        alreadyRefunded: 300,
      });
    }
  );

  it("notify: false — cancela y reembolsa sin mandar un solo aviso", async () => {
    vi.mocked(processRefund).mockResolvedValue({
      refundAmount: 700,
      refundChoice: "CREDIT",
      refundedToCard: 0,
      creditedToBalance: 700,
    });
    const prisma = prismaCancelFake(grupo());
    const res = await cancelReservations(prisma as unknown as Db, {
      reservationId: "res_1",
      refundChoice: "CREDIT",
      scope: "group",
      actor,
      notify: false,
    });
    expect(res.ok).toBe(true);
    expect(prisma.updateMany).toHaveLength(1); // sí se canceló
    // El dinero se movió igual, pero processRefund tampoco avisa.
    expect(vi.mocked(processRefund).mock.calls.every((c) => c[1].notify === false)).toBe(true);
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(notifyPetAudience).not.toHaveBeenCalled();
    expect(notifyTeamReservationUpdated).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("helpers puros", () => {
  it("inferPaymentKind: misma regla que /admin/payments/manual", () => {
    expect(inferPaymentKind(1000, 0, 300)).toBe("ANTICIPO");
    expect(inferPaymentKind(1000, 300, 200)).toBe("ABONO");
    expect(inferPaymentKind(1000, 300, 700)).toBe("RESTANTE");
    expect(inferPaymentKind(0, 0, 100)).toBe("ABONO");
  });

  it("splitGroupTotal reparte y la primera absorbe el residuo", () => {
    expect(splitGroupTotal(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(splitGroupTotal(100, 1)).toEqual([100]);
  });

  it("splitProportional reparte en proporción; la última absorbe el residuo", () => {
    expect(splitProportional(300, [1000, 2000])).toEqual([100, 200]);
    expect(splitProportional(100, [0, 0, 0])).toEqual([33.33, 33.33, 33.34]);
  });

  it("joinNames", () => {
    expect(joinNames(["Molly"])).toBe("Molly");
    expect(joinNames(["Molly", "Bailey"])).toBe("Molly y Bailey");
    expect(joinNames(["Molly", "Bailey", "Loki"])).toBe("Molly, Bailey y Loki");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("registerManualPayment", () => {
  it("guarda el BRUTO en amount, el recargo de tarjeta aparte, infiere el tipo y avisa PAYMENT_RECEIVED", async () => {
    let creado: Record<string, unknown> | null = null;
    const prisma = {
      reservation: {
        findUnique: async () => ({
          id: "res_1",
          status: "CONFIRMED",
          reservationType: "STAY",
          totalAmount: 1000,
          ownerId: "usr_owner",
          petId: "pet_1",
          groupId: null,
          pet: { name: "Molly" },
          payments: [{ amount: 300 }],
        }),
      },
      payment: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          creado = data;
          return { id: "pay_1", ...data };
        },
      },
    };
    vi.mocked(notifyPetAudience).mockClear();
    const res = await registerManualPayment(prisma as unknown as Db, {
      reservationId: "res_1",
      input: { amount: 700, method: "CARD", cardBrand: "VISA", cardFeePct: 3.5, cardFeeAmount: 24.5 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(String(creado!.amount)).toBe("700");
    expect(creado!.cardBrand).toBe("VISA");
    expect(String(creado!.cardFeeAmount)).toBe("24.5");
    expect(creado!.kind).toBe("RESTANTE");
    expect(res.data.balance).toBe(0);
    expect(vi.mocked(notifyPetAudience).mock.calls[0][2].type).toBe("PAYMENT_RECEIVED");
  });

  it("efectivo no arrastra datos de tarjeta aunque vengan", async () => {
    let creado: Record<string, unknown> | null = null;
    const prisma = {
      reservation: {
        findUnique: async () => ({
          id: "res_1",
          status: "CONFIRMED",
          reservationType: "BATH",
          totalAmount: 500,
          ownerId: "usr_owner",
          petId: "pet_1",
          groupId: null,
          pet: { name: "Molly" },
          payments: [],
        }),
      },
      payment: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          creado = data;
          return { id: "pay_1" };
        },
      },
    };
    const res = await registerManualPayment(prisma as unknown as Db, {
      reservationId: "res_1",
      input: { amount: 600, method: "CASH", cardBrand: "VISA", cardFeeAmount: 10 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(creado!.cardBrand).toBeNull();
    expect(creado!.cardFeeAmount).toBeNull();
    expect(res.data.overpaid).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("borrado con los candados del admin web (cobros-protegidos)", () => {
  const pagoFake = (over: Record<string, unknown>) => ({
    id: "pay_1",
    reservationId: "res_1",
    orderId: null,
    stripePaymentIntentId: null,
    status: "PAID",
    terminalCharges: [],
    ...over,
  });
  const prismaPago = (row: Record<string, unknown>, onDelete?: () => void) =>
    ({
      payment: {
        findUnique: async () => row,
        delete: async () => {
          onDelete?.();
          return row;
        },
      },
      reservationAddon: { updateMany: async () => ({ count: 0 }) },
      reservation: {
        findUnique: async () => ({ totalAmount: 1000, payments: [{ amount: 300 }] }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaPagoRef.current),
    }) as unknown as Db;
  const prismaPagoRef: { current: unknown } = { current: null };

  it.each([
    ["Stripe", { stripePaymentIntentId: "pi_1" }, "PAYMENT_STRIPE"],
    ["terminal", { terminalCharges: [{ id: "tc_1" }] }, "PAYMENT_TERMINAL"],
    ["tienda", { orderId: "ord_1" }, "PAYMENT_IS_STORE_SALE"],
    ["reembolso", { status: "REFUNDED" }, "PAYMENT_IS_REFUND"],
  ])("no borra un pago de %s", async (_n, over, code) => {
    let borrado = false;
    const prisma = prismaPago(pagoFake(over), () => (borrado = true));
    prismaPagoRef.current = prisma;
    const res = await deletePayment(prisma, { paymentId: "pay_1", actor });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe(code);
    expect(borrado).toBe(false);
  });

  it("borra un pago manual y devuelve el saldo nuevo", async () => {
    let borrado = false;
    const prisma = prismaPago(pagoFake({}), () => (borrado = true));
    prismaPagoRef.current = prisma;
    const res = await deletePayment(prisma, { paymentId: "pay_1", actor });
    expect(res.ok).toBe(true);
    expect(borrado).toBe(true);
    expect(res.ok && res.data.balance).toBe(700);
  });

  it("no borra una reserva con dinero de Stripe o terminal", async () => {
    const prisma = {
      reservation: {
        findUnique: async () => ({ id: "res_1", groupId: null, ownerId: "u", staffId: null, pet: { name: "Molly" } }),
        findMany: async () => [],
      },
      payment: { count: async () => 1 },
      terminalCharge: { count: async () => 0 },
    } as unknown as Db;
    const res = await deleteReservation(prisma, { reservationId: "res_1", includeGroup: false, actor });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("RESERVATION_HAS_CARD_MONEY");
    expect(res.extra).toEqual({ stripe: true, terminal: false });
  });

  it("una fila de un grupo no se borra sola sin includeGroup", async () => {
    const grupo = [
      { id: "res_1", groupId: "g1", ownerId: "u", staffId: null, pet: { name: "Molly" } },
      { id: "res_2", groupId: "g1", ownerId: "u", staffId: null, pet: { name: "Bailey" } },
    ];
    const prisma = {
      reservation: { findUnique: async () => grupo[0], findMany: async () => grupo },
      payment: { count: async () => 0 },
      terminalCharge: { count: async () => 0 },
    } as unknown as Db;
    const res = await deleteReservation(prisma, { reservationId: "res_1", includeGroup: false, actor });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("GROUP_MEMBER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("deletePayment — reversas del saldo a favor y del add-on", () => {
  /**
   * Fake que registra lo que se escribió: el saldo del dueño, el asiento del
   * ledger y los `updateMany` sobre los add-ons.
   */
  const prismaBorrado = (payment: Record<string, unknown>) => {
    const addonUpdates: Array<{ where: unknown; data: unknown }> = [];
    const ledger: Array<Record<string, unknown>> = [];
    const users: Array<{ where: unknown; data: unknown }> = [];
    const fake = {
      addonUpdates,
      ledger,
      users,
      payment: {
        findUnique: async () => payment,
        delete: async () => payment,
      },
      reservationAddon: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          addonUpdates.push(args);
          return { count: 1 };
        },
      },
      user: {
        update: async (args: { where: unknown; data: unknown }) => {
          users.push(args);
          return { id: "usr_owner", creditBalance: 500 };
        },
      },
      creditLedger: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          ledger.push(data);
          return data;
        },
      },
      reservation: {
        findUnique: async () => ({ totalAmount: 1000, payments: [{ amount: 200 }] }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fake),
    };
    return fake;
  };

  const pagoCredito = (over: Record<string, unknown> = {}) => ({
    id: "pay_1",
    reservationId: "res_1",
    orderId: null,
    stripePaymentIntentId: null,
    status: "PAID",
    method: "CREDIT",
    amount: 300,
    userId: "usr_owner",
    terminalCharges: [],
    reservation: { ownerId: "usr_owner", pet: { name: "Molly" } },
    ...over,
  });

  it("un pago CREDIT devuelve el saldo al dueño y deja asiento en el ledger", async () => {
    const prisma = prismaBorrado(pagoCredito());
    const res = await deletePayment(prisma as unknown as Db, { paymentId: "pay_1", actor });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.creditReturned).toBe(300);
    expect(prisma.users[0]).toEqual({
      where: { id: "usr_owner" },
      data: { creditBalance: { increment: 300 }, lastCreditEntryAt: expect.any(Date) },
    });
    expect(prisma.ledger[0]).toMatchObject({
      userId: "usr_owner",
      type: "CREDIT_ADDED",
      amount: 300,
      balanceAfter: 500,
      reservationId: "res_1",
    });
    expect(String(prisma.ledger[0].description)).toContain("Molly");
  });

  it("sin userId cae al dueño de la reserva", async () => {
    const prisma = prismaBorrado(pagoCredito({ userId: null }));
    const res = await deletePayment(prisma as unknown as Db, { paymentId: "pay_1", actor });
    expect(res.ok).toBe(true);
    expect(prisma.users[0].where).toEqual({ id: "usr_owner" });
  });

  it("un pago que NO es CREDIT no toca el saldo ni el ledger", async () => {
    const prisma = prismaBorrado(pagoCredito({ method: "CASH" }));
    const res = await deletePayment(prisma as unknown as Db, { paymentId: "pay_1", actor });
    expect(res.ok && res.data.creditReturned).toBe(0);
    expect(prisma.users).toHaveLength(0);
    expect(prisma.ledger).toHaveLength(0);
  });

  it("el add-on ligado deja de estar PAGADO: extraPaymentStatus vuelve a PENDING_PAYMENT y se limpia extraPaidAt", async () => {
    const prisma = prismaBorrado(pagoCredito({ method: "CASH" }));
    const res = await deletePayment(prisma as unknown as Db, { paymentId: "pay_1", actor });
    expect(res.ok).toBe(true);
    // Primero el status (mientras el add-on todavía apunta al pago), luego el
    // desenganche: al revés no habría por dónde encontrarlo.
    expect(prisma.addonUpdates[0]).toEqual({
      where: { paymentId: "pay_1", extraPaymentStatus: "PAID" },
      data: { extraPaymentStatus: "PENDING_PAYMENT" },
    });
    expect(prisma.addonUpdates[1]).toEqual({
      where: { paymentId: "pay_1" },
      data: { paymentId: null, extraPaidAt: null },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("updatePayment — corregir un cobro manual", () => {
  const pagoFake = (over: Record<string, unknown> = {}) => ({
    id: "pay_1",
    reservationId: "res_1",
    orderId: null,
    stripePaymentIntentId: null,
    status: "PAID",
    method: "CASH",
    amount: 300,
    kind: "ANTICIPO",
    cardBrand: null,
    cardFeePct: null,
    cardFeeAmount: null,
    terminalCharges: [],
    ...over,
  });

  /** `pagos` = ledger de la reserva DESPUÉS de la edición (ya escrita). */
  const prismaPago = (
    row: Record<string, unknown>,
    opciones: {
      onUpdate?: (data: Record<string, unknown>) => void;
      pagos?: Array<{ amount: number }>;
      total?: number;
      groupId?: string | null;
      hermanas?: Array<{ totalAmount: number; payments: Array<{ amount: number }> }>;
    } = {}
  ) =>
    ({
      payment: {
        findUnique: async () => row,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          opciones.onUpdate?.(data);
          return { ...row, ...data };
        },
      },
      reservation: {
        findUnique: async () => ({
          id: "res_1",
          groupId: opciones.groupId ?? null,
          ownerId: "usr_owner",
          staffId: null,
          totalAmount: opciones.total ?? 1000,
          pet: { name: "Molly" },
          payments: opciones.pagos ?? [{ amount: 300 }],
        }),
        findMany: async () => opciones.hermanas ?? [],
      },
    }) as unknown as Db;

  it.each([
    ["Stripe", { stripePaymentIntentId: "pi_1" }, "PAYMENT_STRIPE"],
    ["terminal", { terminalCharges: [{ id: "tc_1" }] }, "PAYMENT_TERMINAL"],
    ["tienda", { orderId: "ord_1" }, "PAYMENT_IS_STORE_SALE"],
    ["reembolso", { status: "REFUNDED" }, "PAYMENT_IS_REFUND"],
  ])("no edita un pago de %s (mismos candados que el DELETE)", async (_n, over, code) => {
    let tocado = false;
    const prisma = prismaPago(pagoFake(over), { onUpdate: () => (tocado = true) });
    const res = await updatePayment(prisma, {
      paymentId: "pay_1",
      input: { amount: 999 },
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe(code);
    expect(tocado).toBe(false);
  });

  it("corrige el monto (BRUTO) y recalcula el saldo de la reserva", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaPago(pagoFake(), {
      onUpdate: (d) => (escrito = d),
      pagos: [{ amount: 400 }],
      total: 1000,
    });
    const res = await updatePayment(prisma, {
      paymentId: "pay_1",
      input: { amount: 400 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(String(escrito!.amount)).toBe("400");
    expect(res.data.balance).toBe(600);
    expect(res.data.overpaid).toBe(0);
  });

  it("cambiar CARD → efectivo limpia marca y recargo de tarjeta", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaPago(
      pagoFake({ method: "CARD", cardBrand: "VISA", cardFeePct: 3.5, cardFeeAmount: 24.5 }),
      { onUpdate: (d) => (escrito = d) }
    );
    const res = await updatePayment(prisma, {
      paymentId: "pay_1",
      input: { method: "TRANSFER" },
      actor,
    });
    expect(res.ok).toBe(true);
    expect(escrito!.cardBrand).toBeNull();
    expect(escrito!.cardFeePct).toBeNull();
    expect(escrito!.cardFeeAmount).toBeNull();
  });

  it("sigue siendo CARD: conserva el recargo que ya tenía si no lo mandan", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaPago(
      pagoFake({ method: "CARD", cardBrand: "VISA", cardFeePct: 3.5, cardFeeAmount: 24.5 }),
      { onUpdate: (d) => (escrito = d) }
    );
    const res = await updatePayment(prisma, {
      paymentId: "pay_1",
      input: { amount: 700 },
      actor,
    });
    expect(res.ok).toBe(true);
    expect(escrito!.cardBrand).toBe("VISA");
    expect(String(escrito!.cardFeeAmount)).toBe("24.5");
  });

  it("reporta el sobrepago en vez de rechazarlo, como el alta manual", async () => {
    const prisma = prismaPago(pagoFake(), { pagos: [{ amount: 1200 }], total: 1000 });
    const res = await updatePayment(prisma, {
      paymentId: "pay_1",
      input: { amount: 1200 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.balance).toBe(0);
    expect(res.data.overpaid).toBe(200);
  });

  it("en grupo multi-mascota el groupBalance suma a todas las hermanas", async () => {
    const prisma = prismaPago(pagoFake(), {
      pagos: [{ amount: 400 }],
      total: 1000,
      groupId: "g1",
      hermanas: [
        { totalAmount: 1000, payments: [{ amount: 400 }] },
        { totalAmount: 800, payments: [{ amount: 100 }] },
      ],
    });
    const res = await updatePayment(prisma, {
      paymentId: "pay_1",
      input: { amount: 400 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.balance).toBe(600);
    expect(res.data.groupBalance).toBe(1300);
  });

  it("monto 0 o negativo se rechaza antes de tocar nada", async () => {
    const prisma = prismaPago(pagoFake());
    const res = await updatePayment(prisma, { paymentId: "pay_1", input: { amount: 0 }, actor });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.code).toBe("VALIDATION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("updateReservationAddon — editar un add-on y mover el total por delta", () => {
  const addonFake = (over: Record<string, unknown> = {}) => ({
    id: "add_1",
    variantId: "var_1",
    unitPrice: 300,
    quantity: null,
    paidWith: "BOOKING",
    isCourtesy: false,
    extraPaidAt: null,
    variant: { serviceType: { code: "BATH", name: "Baño" } },
    reservation: {
      id: "res_1",
      status: "CONFIRMED",
      totalAmount: 1000,
      ownerId: "usr_owner",
      staffId: null,
      pet: { name: "Molly" },
    },
    ...over,
  });

  const prismaAddon = (
    row: Record<string, unknown>,
    opciones: {
      onUpdate?: (data: Record<string, unknown>) => void;
      onTotal?: (data: Record<string, unknown>) => void;
      variante?: Record<string, unknown> | null;
    } = {}
  ) => {
    const tx = {
      reservationAddon: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          opciones.onUpdate?.(data);
          return { ...row, ...data, variant: row.variant };
        },
      },
      reservation: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          opciones.onTotal?.(data);
          return {};
        },
      },
    };
    return {
      reservationAddon: { findUnique: async () => row },
      serviceVariant: {
        findUnique: async () =>
          opciones.variante === undefined
            ? { id: "var_2", price: 450, durationMinutes: 90, isActive: true }
            : opciones.variante,
      },
      $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as Db;
  };

  it("subir el precio sube el total por la diferencia, no por el precio entero", async () => {
    let total: Record<string, unknown> | null = null;
    const prisma = prismaAddon(addonFake(), { onTotal: (d) => (total = d) });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { unitPrice: 450 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(150);
    expect(res.data.totalAmount).toBe(1150);
    expect(String(total!.totalAmount)).toBe("1150");
  });

  it("marcar cortesía descuenta el add-on del total y sella la auditoría", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaAddon(addonFake(), { onUpdate: (d) => (escrito = d) });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { isCourtesy: true, courtesyReason: "el baño salió mal" },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(-300);
    expect(res.data.totalAmount).toBe(700);
    expect(escrito!.courtesySetById).toBe("usr_web");
    expect(escrito!.courtesySetAt).toBeInstanceOf(Date);
  });

  it("quitar la cortesía limpia el sello y vuelve a cobrar el add-on", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaAddon(
      addonFake({ isCourtesy: true, courtesySetById: "usr_otro", courtesyReason: "cortesía" }),
      { onUpdate: (d) => (escrito = d) }
    );
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { isCourtesy: false },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(300);
    expect(escrito!.courtesySetById).toBeNull();
    expect(escrito!.courtesyReason).toBeNull();
  });

  it("precio y cortesía a la vez: el delta usa el precio NUEVO", async () => {
    const prisma = prismaAddon(addonFake({ isCourtesy: true }));
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { isCourtesy: false, unitPrice: 500 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Antes contribuía 0 (cortesía); ahora contribuye 500.
    expect(res.data.delta).toBe(500);
    expect(res.data.totalAmount).toBe(1500);
  });

  it("cambiar la variante sin precio reprecia desde el catálogo y trae su duración", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaAddon(addonFake(), { onUpdate: (d) => (escrito = d) });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { variantId: "var_2" },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(String(escrito!.unitPrice)).toBe("450");
    expect(escrito!.durationMinutes).toBe(90);
    expect(res.data.delta).toBe(150);
  });

  it("el unitPrice explícito le gana al precio de catálogo de la variante nueva", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaAddon(addonFake(), { onUpdate: (d) => (escrito = d) });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { variantId: "var_2", unitPrice: 380 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(String(escrito!.unitPrice)).toBe("380");
    expect(res.data.delta).toBe(80);
  });

  it("un add-on STANDALONE nunca sumó al total: delta 0 aunque cambie de precio", async () => {
    let total: Record<string, unknown> | null = null;
    const prisma = prismaAddon(addonFake({ paidWith: "STANDALONE" }), {
      onTotal: (d) => (total = d),
    });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { unitPrice: 900 },
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delta).toBe(0);
    expect(res.data.totalAmount).toBe(1000);
    expect(total).toBeNull();
  });

  it("un addonId de OTRA reserva no se edita (404)", async () => {
    const prisma = prismaAddon(addonFake());
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_OTRA",
      addonId: "add_1",
      input: { unitPrice: 1 },
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
    expect(res.code).toBe("NOT_FOUND");
  });

  it("no se edita el add-on de una reserva cancelada", async () => {
    const prisma = prismaAddon(
      addonFake({ reservation: { ...addonFake().reservation, status: "CANCELLED" } })
    );
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { unitPrice: 1 },
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("CANCELLED");
  });

  it("una variante inactiva no se puede poner", async () => {
    const prisma = prismaAddon(addonFake(), {
      variante: { id: "var_2", price: 450, durationMinutes: 60, isActive: false },
    });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { variantId: "var_2" },
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VARIANT_UNAVAILABLE");
  });

  it("el staff no puede cambiar precio ni cortesía (dinero es solo-admin)", async () => {
    const prisma = prismaAddon(addonFake());
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { unitPrice: 900 },
      actor: { userId: "usr_staff", isAdmin: false },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(403);
    expect(res.code).toBe("ADMIN_ONLY");
  });

  it("marcar el extra como PAID sella extraPaidAt si no lo mandan", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaAddon(addonFake(), { onUpdate: (d) => (escrito = d) });
    const res = await updateReservationAddon(prisma, {
      reservationId: "res_1",
      addonId: "add_1",
      input: { extraPaymentStatus: "PAID" },
      actor,
    });
    expect(res.ok).toBe(true);
    expect(escrito!.extraPaymentStatus).toBe("PAID");
    expect(escrito!.extraPaidAt).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("changeReservationPet — corregir la mascota de una reserva", () => {
  const reservaFake = (over: Record<string, unknown> = {}) => ({
    id: "res_1",
    petId: "pet_1",
    ownerId: "usr_owner",
    groupId: null,
    staffId: null,
    status: "CONFIRMED",
    pet: { name: "Molly" },
    ...over,
  });

  const prismaPet = (
    reserva: Record<string, unknown>,
    opciones: {
      pet?: Record<string, unknown> | null;
      enGrupo?: number;
      onUpdate?: (data: Record<string, unknown>) => void;
    } = {}
  ) =>
    ({
      reservation: {
        findUnique: async () => reserva,
        count: async () => opciones.enGrupo ?? 1,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          opciones.onUpdate?.(data);
          return {};
        },
      },
      pet: {
        findUnique: async () =>
          opciones.pet === undefined
            ? { id: "pet_2", name: "Bailey", ownerId: "usr_owner", isActive: true }
            : opciones.pet,
      },
    }) as unknown as Db;

  it("cambia a otra mascota de la MISMA dueña", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaPet(reservaFake(), { onUpdate: (d) => (escrito = d) });
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_2",
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(escrito!.petId).toBe("pet_2");
    expect(res.data.petName).toBe("Bailey");
    expect(res.data.previousPetName).toBe("Molly");
    expect(res.data.changed).toBe(true);
  });

  it("una mascota de OTRA cuenta se rechaza con PET_NOT_OWNED", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaPet(reservaFake(), {
      pet: { id: "pet_9", name: "Loki", ownerId: "usr_otra", isActive: true },
      onUpdate: (d) => (escrito = d),
    });
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_9",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
    expect(res.code).toBe("PET_NOT_OWNED");
    expect(escrito).toBeNull();
  });

  it("una fila de un grupo de VARIAS mascotas no se toca (409 GROUP_MEMBER)", async () => {
    const prisma = prismaPet(reservaFake({ groupId: "g1" }), { enGrupo: 2 });
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_2",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("GROUP_MEMBER");
  });

  it("un grupo de UNA sola fila sí se puede corregir", async () => {
    const prisma = prismaPet(reservaFake({ groupId: "g1" }), { enGrupo: 1 });
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_2",
      actor,
    });
    expect(res.ok).toBe(true);
  });

  it("mandar la misma mascota es un no-op, no un error", async () => {
    let escrito: Record<string, unknown> | null = null;
    const prisma = prismaPet(reservaFake(), { onUpdate: (d) => (escrito = d) });
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_1",
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.changed).toBe(false);
    expect(escrito).toBeNull();
  });

  it("no se cambia la mascota de una reserva cancelada", async () => {
    const prisma = prismaPet(reservaFake({ status: "CANCELLED" }));
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_2",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("CANCELLED");
  });

  it("mascota inexistente → 404 PET_NOT_FOUND", async () => {
    const prisma = prismaPet(reservaFake(), { pet: null });
    const res = await changeReservationPet(prisma, {
      reservationId: "res_1",
      petId: "pet_zzz",
      actor,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
    expect(res.code).toBe("PET_NOT_FOUND");
  });
});
