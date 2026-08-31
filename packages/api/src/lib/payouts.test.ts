/**
 * Tests de la conciliación de depósitos SPEI.
 *
 * Cubren lo que rompería el desglose EN SILENCIO: la transacción del propio
 * payout que Stripe cuela en el listado, y los tres formatos distintos con que
 * el sistema guarda un reembolso. Ambos fallan sin lanzar error — simplemente
 * dan un número mal sumado o marcan cobros legítimos como "no identificados",
 * que es peor que un crash porque el dueño confiaría en el resultado.
 */
import { describe, it, expect, vi } from "vitest";
import Stripe from "stripe";
import {
  extractRefs,
  matchLine,
  isRefundType,
  excluirTransaccionDelPayout,
  elegirReserva,
  registrarCobroDeLinea,
  type MatchMaps,
  type ReservaCandidata,
} from "./payouts";

// ─── Helpers de fixtures ─────────────────────────────────────────────────────

function bt(over: Partial<Stripe.BalanceTransaction> = {}): Stripe.BalanceTransaction {
  return {
    id: "txn_test",
    object: "balance_transaction",
    amount: 35000,
    available_on: 0,
    created: 0,
    currency: "mxn",
    description: null,
    exchange_rate: null,
    fee: 1610,
    fee_details: [],
    net: 33390,
    reporting_category: "charge",
    source: null,
    status: "available",
    type: "charge",
    ...over,
  } as Stripe.BalanceTransaction;
}

function charge(id: string, paymentIntent: string | null): Stripe.Charge {
  return { id, object: "charge", payment_intent: paymentIntent } as Stripe.Charge;
}

function refund(id: string, chargeId: string, paymentIntent: string | null): Stripe.Refund {
  return {
    id,
    object: "refund",
    charge: chargeId,
    payment_intent: paymentIntent,
  } as unknown as Stripe.Refund;
}

const mapsVacios = (): MatchMaps => ({
  byPi: new Map(),
  orderByPi: new Map(),
  addonPaymentByPi: new Map(),
  refundByPi: new Map(),
});

// ─── La transacción del propio payout ────────────────────────────────────────

describe("excluirTransaccionDelPayout", () => {
  it("quita la transacción de tipo payout y conserva el resto", () => {
    const txns = [
      bt({ id: "txn_1", type: "charge", net: 33390 }),
      bt({ id: "txn_2", type: "charge", net: 33390 }),
      // La que Stripe cuela: el total en negativo.
      bt({ id: "txn_payout", type: "payout", net: -66780 }),
    ];

    const lineas = excluirTransaccionDelPayout(txns);

    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.id)).toEqual(["txn_1", "txn_2"]);
  });

  it("sin el filtro la suma daría cero — el desglose se vería vacío", () => {
    const txns = [
      bt({ id: "txn_1", type: "charge", net: 33390 }),
      bt({ id: "txn_2", type: "charge", net: 33390 }),
      bt({ id: "txn_payout", type: "payout", net: -66780 }),
    ];

    const sinFiltrar = txns.reduce((a, t) => a + t.net, 0);
    const filtrado = excluirTransaccionDelPayout(txns).reduce((a, t) => a + t.net, 0);

    expect(sinFiltrar).toBe(0); // esto es lo que NO queremos
    expect(filtrado).toBe(66780); // $667.80, el monto que llega al banco
  });

  it("es inocuo si Stripe deja de incluirla", () => {
    const txns = [bt({ id: "txn_1", type: "charge", net: 33390 })];
    expect(excluirTransaccionDelPayout(txns)).toHaveLength(1);
  });
});

// ─── Extracción de referencias ───────────────────────────────────────────────

describe("extractRefs", () => {
  it("saca charge y payment_intent de un cobro", () => {
    const refs = extractRefs(bt({ source: charge("ch_1", "pi_1") }));
    expect(refs).toEqual({
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      refundId: null,
      metadata: null,
    });
  });

  it("saca el refundId de un reembolso, además del charge y el PI", () => {
    const refs = extractRefs(
      bt({ type: "refund", source: refund("re_1", "ch_1", "pi_1") }),
    );
    expect(refs).toEqual({
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      refundId: "re_1",
      metadata: null,
    });
  });

  it("acepta el payment_intent expandido como objeto, no solo como string", () => {
    const src = { id: "ch_1", object: "charge", payment_intent: { id: "pi_1" } };
    const refs = extractRefs(bt({ source: src as unknown as Stripe.Charge }));
    expect(refs.paymentIntentId).toBe("pi_1");
  });

  it("devuelve todo en null para movimientos que no cuelgan de un cobro", () => {
    const refs = extractRefs(bt({ type: "stripe_fee", source: null }));
    expect(refs).toEqual({
      chargeId: null,
      paymentIntentId: null,
      refundId: null,
      metadata: null,
    });
  });

  // La metadata es el ÚNICO rastro de a quién pertenece un cobro que nunca
  // llegó a `payments`, y viaja ya en el charge expandido.
  it("conserva la metadata del charge, que dice de quién es el cobro", () => {
    const src = {
      id: "ch_1",
      object: "charge",
      payment_intent: "pi_1",
      metadata: {
        ownerId: "usr_1",
        petId: "pet_1",
        type: "bath_appointment",
        appointmentAt: "2026-08-08T00:00:00.000Z",
      },
    };
    const refs = extractRefs(bt({ source: src as unknown as Stripe.Charge }));
    expect(refs.metadata).toEqual({
      ownerId: "usr_1",
      petId: "pet_1",
      type: "bath_appointment",
      appointmentAt: "2026-08-08T00:00:00.000Z",
    });
  });

  it("una metadata vacía se guarda como null, no como {}", () => {
    const src = { id: "ch_1", object: "charge", payment_intent: "pi_1", metadata: {} };
    const refs = extractRefs(bt({ source: src as unknown as Stripe.Charge }));
    expect(refs.metadata).toBeNull();
  });
});

// ─── Cruce contra nuestros datos ─────────────────────────────────────────────

describe("matchLine — cobros", () => {
  it("cruza un cobro normal por su PaymentIntent", () => {
    const maps = mapsVacios();
    maps.byPi.set("pi_1", "pay_1");

    const r = matchLine("charge", extractRefs(bt({ source: charge("ch_1", "pi_1") })), maps);
    expect(r).toEqual({ paymentId: "pay_1", orderId: null });
  });

  it("cruza una venta de tienda, que no tiene fila en payments", () => {
    const maps = mapsVacios();
    maps.orderByPi.set("pi_store", "ord_1");

    const r = matchLine(
      "charge",
      extractRefs(bt({ source: charge("ch_2", "pi_store") })),
      maps,
    );
    expect(r).toEqual({ paymentId: null, orderId: "ord_1" });
  });

  it("cae al pago del add-on cuando el extra de baño se cobró aparte", () => {
    const maps = mapsVacios();
    maps.addonPaymentByPi.set("pi_extra", "pay_addon");

    const r = matchLine(
      "charge",
      extractRefs(bt({ source: charge("ch_3", "pi_extra") })),
      maps,
    );
    expect(r.paymentId).toBe("pay_addon");
  });

  it("deja la línea sin identificar cuando no cruza con nada", () => {
    const r = matchLine("stripe_fee", extractRefs(bt({ type: "stripe_fee" })), mapsVacios());
    expect(r).toEqual({ paymentId: null, orderId: null });
  });
});

describe("matchLine — los tres formatos de reembolso", () => {
  const refs = extractRefs(bt({ type: "refund", source: refund("re_1", "ch_1", "pi_1") }));

  it("1) `re_...` — cancelación de reserva o recorte de estadía", () => {
    const maps = mapsVacios();
    maps.byPi.set("re_1", "pay_refund_cancel");

    expect(matchLine("refund", refs, maps).paymentId).toBe("pay_refund_cancel");
  });

  it("2) `${pi}_refund_${charge}` — el id sintético del webhook charge.refunded", () => {
    const maps = mapsVacios();
    maps.refundByPi.set("pi_1", "pay_refund_webhook");

    expect(matchLine("refund", refs, maps).paymentId).toBe("pay_refund_webhook");
  });

  it("3) sin fila propia, cae al pago ORIGINAL (reembolso hecho a mano en Stripe)", () => {
    const maps = mapsVacios();
    maps.byPi.set("pi_1", "pay_original");

    expect(matchLine("refund", refs, maps).paymentId).toBe("pay_original");
  });

  it("prefiere el `re_...` sobre el id sintético cuando existen ambos", () => {
    const maps = mapsVacios();
    maps.byPi.set("re_1", "pay_por_refund_id");
    maps.refundByPi.set("pi_1", "pay_por_sintetico");

    expect(matchLine("refund", refs, maps).paymentId).toBe("pay_por_refund_id");
  });

  it("un reembolso NUNCA se atribuye a un pedido de tienda", () => {
    const maps = mapsVacios();
    maps.orderByPi.set("pi_1", "ord_1");

    expect(matchLine("refund", refs, maps).orderId).toBeNull();
  });

  it("sin ningún match queda sin identificar, pero la línea existe", () => {
    expect(matchLine("refund", refs, mapsVacios())).toEqual({
      paymentId: null,
      orderId: null,
    });
  });
});

describe("isRefundType", () => {
  it("reconoce las variantes de reembolso de Stripe", () => {
    expect(isRefundType("refund")).toBe(true);
    expect(isRefundType("payment_refund")).toBe(true);
    expect(isRefundType("refund_failure")).toBe(true);
  });

  it("no confunde un cobro con un reembolso", () => {
    expect(isRefundType("charge")).toBe(false);
    expect(isRefundType("payment")).toBe(false);
    expect(isRefundType("stripe_fee")).toBe(false);
  });
});

// ─── A qué reserva pertenece un cobro sin registrar ──────────────────────────

describe("elegirReserva", () => {
  const base = (over: Partial<ReservaCandidata> = {}): ReservaCandidata => ({
    id: "r1",
    ownerId: "usr_1",
    petId: "pet_1",
    reservationType: "BATH",
    status: "CONFIRMED",
    checkIn: null,
    appointmentAt: new Date("2026-08-08T00:00:00.000Z"),
    ...over,
  });

  const criterio = {
    ownerId: "usr_1",
    petIds: ["pet_1"],
    tipo: "BATH" as const,
    fecha: new Date("2026-08-08T00:00:00.000Z"),
  };

  it("encuentra la reserva cuando la fecha coincide exacto", () => {
    expect(elegirReserva([base()], criterio)).toBe("r1");
  });

  /**
   * El caso real: dos citas del mismo cliente separadas por UNA hora. Con la
   * ventana ancha de antes ambas entraban y ganaba la primera que devolviera
   * Postgres — sin ORDER BY, la ganadora podía cambiar entre corridas.
   */
  it("se queda con la MÁS CERCANA, no con la primera de la lista", () => {
    const lejana = base({ id: "r_lejana", appointmentAt: new Date("2026-08-08T00:50:00.000Z") });
    const exacta = base({ id: "r_exacta", appointmentAt: new Date("2026-08-08T00:00:00.000Z") });
    // La lejana va primero a propósito: si se tomara la primera, fallaría.
    expect(elegirReserva([lejana, exacta], criterio)).toBe("r_exacta");
  });

  it("no vincula nada si dos reservas están igual de cerca", () => {
    const a = base({ id: "r_a", appointmentAt: new Date("2026-08-08T00:10:00.000Z") });
    const b = base({ id: "r_b", appointmentAt: new Date("2026-08-07T23:50:00.000Z") });
    // Ambas a 10 min: apuntar a una al azar mandaría al admin a la equivocada.
    expect(elegirReserva([a, b], criterio)).toBeNull();
  });

  /**
   * El upsell clásico del negocio: baño el día de la salida. El STAY tiene su
   * checkIn cerca, y comparando `appointmentAt ?? checkIn` el cobro del baño se
   * colgaba de la estancia.
   */
  it("no confunde un baño con el hospedaje del mismo día", () => {
    const estancia = base({
      id: "r_stay",
      reservationType: "STAY",
      appointmentAt: null,
      checkIn: new Date("2026-08-08T00:00:00.000Z"),
    });
    expect(elegirReserva([estancia], criterio)).toBeNull();
  });

  it("ignora una reserva cancelada", () => {
    expect(elegirReserva([base({ status: "CANCELLED" })], criterio)).toBeNull();
  });

  it("prefiere la viva sobre la cancelada de la misma fecha", () => {
    const cancelada = base({ id: "r_cancel", status: "CANCELLED" });
    const viva = base({ id: "r_viva" });
    expect(elegirReserva([cancelada, viva], criterio)).toBe("r_viva");
  });

  it("no cruza mascotas ni dueños ajenos", () => {
    expect(elegirReserva([base({ petId: "pet_otro" })], criterio)).toBeNull();
    expect(elegirReserva([base({ ownerId: "usr_otro" })], criterio)).toBeNull();
  });

  it("descarta lo que cae fuera de la ventana del tipo", () => {
    // Un baño a 3 h de distancia: fuera de la ventana de 1 h.
    const lejos = base({ appointmentAt: new Date("2026-08-08T03:00:00.000Z") });
    expect(elegirReserva([lejos], criterio)).toBeNull();
  });

  it("el hospedaje tolera el desfase de zona horaria del check-in", () => {
    // La metadata manda la hora del hotel (07:00Z) y la reserva guarda el día a
    // medianoche UTC: 7 h de diferencia estructural que sí deben casar.
    const stay = base({
      id: "r_stay",
      reservationType: "STAY",
      appointmentAt: null,
      checkIn: new Date("2026-11-20T00:00:00.000Z"),
    });
    const r = elegirReserva([stay], {
      ownerId: "usr_1",
      petIds: ["pet_1"],
      tipo: "STAY",
      fecha: new Date("2026-11-20T07:00:00.000Z"),
    });
    expect(r).toBe("r_stay");
  });

  it("la guardería casa aunque la metadata mande solo el día", () => {
    // `date` llega como "YYYY-MM-DD" (medianoche) y la reserva ancla a mediodía
    // UTC: 12 h de diferencia estructural.
    const day = base({
      id: "r_day",
      reservationType: "DAYCARE",
      appointmentAt: new Date("2026-08-20T12:00:00.000Z"),
    });
    const r = elegirReserva([day], {
      ownerId: "usr_1",
      petIds: ["pet_1"],
      tipo: "DAYCARE",
      fecha: new Date("2026-08-20T00:00:00.000Z"),
    });
    expect(r).toBe("r_day");
  });

  it("sin candidatas devuelve null, no revienta", () => {
    expect(elegirReserva([], criterio)).toBeNull();
  });
});

// ─── Cuadre al centavo ───────────────────────────────────────────────────────

describe("cuadre del depósito", () => {
  /**
   * El caso que originó la feature: un SPEI de $663.80 compuesto por dos cobros
   * y un cargo de Stripe. La suma de los netos tiene que dar exactamente el
   * monto depositado, sin drift de floats.
   */
  it("la suma de los netos da el monto del depósito, al centavo", () => {
    const txns = [
      bt({ id: "txn_1", type: "charge", amount: 35000, fee: 1610, net: 33390 }),
      bt({ id: "txn_2", type: "charge", amount: 35000, fee: 1610, net: 33390 }),
      bt({ id: "txn_3", type: "stripe_fee", amount: -400, fee: 0, net: -400 }),
      bt({ id: "txn_payout", type: "payout", amount: -66380, fee: 0, net: -66380 }),
    ];

    const netCents = excluirTransaccionDelPayout(txns).reduce((a, t) => a + t.net, 0);

    expect(netCents).toBe(66380);
    expect(netCents / 100).toBe(663.8); // el SPEI que llegó al Santander
  });

  it("un reembolso resta del depósito", () => {
    const txns = [
      bt({ id: "txn_1", type: "charge", amount: 100000, fee: 4000, net: 96000 }),
      bt({ id: "txn_2", type: "refund", amount: -50000, fee: 0, net: -50000 }),
    ];

    const netCents = excluirTransaccionDelPayout(txns).reduce((a, t) => a + t.net, 0);
    expect(netCents).toBe(46000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  registrarCobroDeLinea
// ─────────────────────────────────────────────────────────────────────────────
//
// Lo que se prueba aquí falla EN SILENCIO, que es lo peligroso: guardar el neto
// en vez del bruto no revienta nada, sólo hace que los ingresos descuenten la
// comisión dos veces y que la reserva arrastre un saldo fantasma. Ya pasó.

vi.mock("stripe", () => {
  // Stripe nunca se toca en estos tests: las llamadas rechazan y el código cae a
  // sus caminos de respaldo (la fecha del depósito, el re-sync que no ocurre).
  const fail = () => Promise.reject(new Error("sin red en tests"));
  return {
    default: class {
      paymentIntents = { retrieve: fail };
      payouts = { retrieve: fail, list: fail };
      balanceTransactions = { list: fail };
    },
  };
});

type UpsertArgs = {
  where: { stripePaymentIntentId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function prismaFake(opts: {
  linea?: Record<string, unknown> | null;
  reserva?: Record<string, unknown> | null;
  pagoExistente?: { id: string } | null;
  onUpsert?: (args: UpsertArgs) => void;
}) {
  const {
    linea = {
      id: "txn_1",
      type: "charge",
      gross: 610,
      fee: 28.95,
      net: 581.05,
      paymentId: null,
      orderId: null,
      stripePaymentIntentId: "pi_1",
      metaReservationId: null,
      metaOwnerId: "usr_1",
      metaPetIds: "pet_1",
      payout: { id: "po_1", stripeCreatedAt: new Date("2026-08-30T00:00:00Z") },
    },
    reserva = {
      id: "res_1",
      ownerId: "usr_1",
      petId: "pet_1",
      totalAmount: 3048.46,
      payments: [],
    },
    pagoExistente = null,
    onUpsert,
  } = opts;

  return {
    stripePayoutLine: { findUnique: async () => linea },
    reservation: { findUnique: async () => reserva, count: async () => 1 },
    payment: {
      findUnique: async () => pagoExistente,
      upsert: async (args: UpsertArgs) => {
        onUpsert?.(args);
        return { id: "pay_nuevo" };
      },
    },
    stripePayout: { findUnique: async () => null },
  } as unknown as Parameters<typeof registrarCobroDeLinea>[0];
}

describe("registrarCobroDeLinea", () => {
  it("guarda el BRUTO en amount y la comisión aparte", async () => {
    let args: UpsertArgs | null = null;
    const res = await registrarCobroDeLinea(
      prismaFake({ onUpsert: (a) => (args = a) }),
      { lineId: "txn_1", reservationId: "res_1" }
    );

    expect(res.ok).toBe(true);
    const creado = (args as unknown as UpsertArgs).create;
    // $610 es lo que pagó el cliente; $581.05 es lo que llegó al banco. En
    // `amount` va SIEMPRE el primero: las vistas de ingresos restan la comisión
    // ellas mismas, así que guardar el neto la descuenta dos veces.
    expect(Number(creado.amount)).toBe(610);
    expect(Number(creado.stripeFeeAmount)).toBe(28.95);
    expect(creado.method).toBe("STRIPE");
    expect(creado.stripePaymentIntentId).toBe("pi_1");
  });

  it("el alta es un upsert vacío: repetirla no pisa ni duplica el pago", async () => {
    let args: UpsertArgs | null = null;
    const res = await registrarCobroDeLinea(
      prismaFake({ pagoExistente: { id: "pay_previo" }, onUpsert: (a) => (args = a) }),
      { lineId: "txn_1", reservationId: "res_1" }
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.creado).toBe(false);
    // `update: {}` es lo que hace inofensivo el segundo toque: si el webhook ya
    // había registrado el cobro, sus datos mandan.
    expect((args as unknown as UpsertArgs).update).toEqual({});
  });

  it("un cobro parcial queda como ANTICIPO/PARTIAL y uno que liquida como RESTANTE/PAID", async () => {
    let parcial: UpsertArgs | null = null;
    await registrarCobroDeLinea(prismaFake({ onUpsert: (a) => (parcial = a) }), {
      lineId: "txn_1",
      reservationId: "res_1",
    });
    expect((parcial as unknown as UpsertArgs).create.kind).toBe("ANTICIPO");
    expect((parcial as unknown as UpsertArgs).create.status).toBe("PARTIAL");

    let liquida: UpsertArgs | null = null;
    await registrarCobroDeLinea(
      prismaFake({
        reserva: { id: "res_1", ownerId: "usr_1", petId: "pet_1", totalAmount: 610, payments: [] },
        onUpsert: (a) => (liquida = a),
      }),
      { lineId: "txn_1", reservationId: "res_1" }
    );
    expect((liquida as unknown as UpsertArgs).create.kind).toBe("RESTANTE");
    expect((liquida as unknown as UpsertArgs).create.status).toBe("PAID");
  });

  it("el saldo cuenta los anticipos ya pagados, no sólo los PAID", async () => {
    // Un anticipo vive como PARTIAL. Ignorarlo haría ver la reserva como si no
    // hubiera pagado nada y el segundo cobro nacería otra vez como ANTICIPO.
    let args: UpsertArgs | null = null;
    await registrarCobroDeLinea(
      prismaFake({
        reserva: {
          id: "res_1",
          ownerId: "usr_1",
          petId: "pet_1",
          totalAmount: 1220,
          payments: [{ amount: 610, status: "PARTIAL" }],
        },
        onUpsert: (a) => (args = a),
      }),
      { lineId: "txn_1", reservationId: "res_1" }
    );
    expect((args as unknown as UpsertArgs).create.kind).toBe("RESTANTE");
  });

  it("no registra un reembolso como ingreso", async () => {
    const res = await registrarCobroDeLinea(
      prismaFake({
        linea: {
          id: "txn_r",
          type: "refund",
          gross: -350,
          fee: 0,
          net: -350,
          paymentId: null,
          orderId: null,
          stripePaymentIntentId: "pi_9",
          metaReservationId: null,
          metaOwnerId: "usr_1",
          metaPetIds: "pet_1",
          payout: { id: "po_1", stripeCreatedAt: new Date() },
        },
      }),
      { lineId: "txn_r", reservationId: "res_1" }
    );
    expect(res.ok).toBe(false);
  });

  it("no registra un ajuste de Stripe (sin PaymentIntent no hay nada que vincular)", async () => {
    const res = await registrarCobroDeLinea(
      prismaFake({
        linea: {
          id: "txn_f",
          type: "stripe_fee",
          gross: -12,
          fee: 0,
          net: -12,
          paymentId: null,
          orderId: null,
          stripePaymentIntentId: null,
          metaReservationId: null,
          metaOwnerId: "usr_1",
          metaPetIds: "pet_1",
          payout: { id: "po_1", stripeCreatedAt: new Date() },
        },
      }),
      { lineId: "txn_f", reservationId: "res_1" }
    );
    expect(res.ok).toBe(false);
  });

  it("no vuelve a registrar una línea que ya cruzó con un pago", async () => {
    const res = await registrarCobroDeLinea(
      prismaFake({
        linea: {
          id: "txn_1",
          type: "charge",
          gross: 610,
          fee: 28.95,
          net: 581.05,
          paymentId: "pay_ya",
          orderId: null,
          stripePaymentIntentId: "pi_1",
          metaReservationId: null,
          metaOwnerId: "usr_1",
          metaPetIds: "pet_1",
          payout: { id: "po_1", stripeCreatedAt: new Date() },
        },
      }),
      { lineId: "txn_1", reservationId: "res_1" }
    );
    expect(res.ok).toBe(false);
  });

  it("no reparte a ciegas un cobro de una reserva de varias mascotas", async () => {
    // El cobro cubre a todo el grupo pero cada mascota tiene su propia fila:
    // colgarle el bruto entero a una la dejaría sobrepagada y a las demás
    // debiendo todo. Preferimos no registrar nada y decirlo.
    const prisma = prismaFake({
      reserva: {
        id: "res_1",
        ownerId: "usr_1",
        petId: "pet_1",
        groupId: "grp_1",
        totalAmount: 3048.46,
        payments: [],
      },
    }) as unknown as { reservation: { count: () => Promise<number> } };
    prisma.reservation.count = async () => 3;

    const res = await registrarCobroDeLinea(
      prisma as unknown as Parameters<typeof registrarCobroDeLinea>[0],
      { lineId: "txn_1", reservationId: "res_1" }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("3 mascotas");
  });

  it("una reserva con groupId pero de una sola mascota sí se registra", async () => {
    const prisma = prismaFake({
      reserva: {
        id: "res_1",
        ownerId: "usr_1",
        petId: "pet_1",
        groupId: "grp_1",
        totalAmount: 3048.46,
        payments: [],
      },
    }) as unknown as { reservation: { count: () => Promise<number> } };
    prisma.reservation.count = async () => 1;

    const res = await registrarCobroDeLinea(
      prisma as unknown as Parameters<typeof registrarCobroDeLinea>[0],
      { lineId: "txn_1", reservationId: "res_1" }
    );
    expect(res.ok).toBe(true);
  });

  it("rechaza colgar el cobro en la reserva de OTRO cliente", async () => {
    // El id de reserva lo manda la pantalla. Sin contrastarlo con la metadata
    // que Stripe guardó, un id equivocado asienta el dinero de un cliente en la
    // cuenta de otro: el que pagó sigue debiendo y el otro queda con un saldo
    // que nunca pagó.
    const res = await registrarCobroDeLinea(
      prismaFake({
        reserva: {
          id: "res_ajena",
          ownerId: "usr_OTRO",
          petId: "pet_9",
          totalAmount: 5000,
          payments: [],
        },
      }),
      { lineId: "txn_1", reservationId: "res_ajena" }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no corresponde");
  });

  it("rechaza una mascota que el cobro no menciona, aunque el dueño coincida", async () => {
    // Mismo cliente, otro perro: el cobro era de una reserva distinta.
    const res = await registrarCobroDeLinea(
      prismaFake({
        reserva: {
          id: "res_otra",
          ownerId: "usr_1",
          petId: "pet_DISTINTO",
          totalAmount: 900,
          payments: [],
        },
      }),
      { lineId: "txn_1", reservationId: "res_otra" }
    );
    expect(res.ok).toBe(false);
  });

  it("cuando la metadata trae el reservationId literal, manda ese", async () => {
    const linea = (id: string | null) => ({
      id: "txn_1",
      type: "charge",
      gross: 610,
      fee: 28.95,
      net: 581.05,
      paymentId: null,
      orderId: null,
      stripePaymentIntentId: "pi_1",
      metaReservationId: id,
      metaOwnerId: null,
      metaPetIds: null,
      payout: { id: "po_1", stripeCreatedAt: new Date() },
    });

    const ok = await registrarCobroDeLinea(prismaFake({ linea: linea("res_1") }), {
      lineId: "txn_1",
      reservationId: "res_1",
    });
    expect(ok.ok).toBe(true);

    const mal = await registrarCobroDeLinea(prismaFake({ linea: linea("res_otra") }), {
      lineId: "txn_1",
      reservationId: "res_1",
    });
    expect(mal.ok).toBe(false);
  });

  it("sin metadata no se da el beneficio de la duda", async () => {
    // No es que la reserva esté mal: es que no hay con qué afirmar que esté
    // bien, y asentar dinero en la cuenta de alguien no es lugar para suponer.
    const res = await registrarCobroDeLinea(
      prismaFake({
        linea: {
          id: "txn_1",
          type: "charge",
          gross: 610,
          fee: 28.95,
          net: 581.05,
          paymentId: null,
          orderId: null,
          stripePaymentIntentId: "pi_1",
          metaReservationId: null,
          metaOwnerId: null,
          metaPetIds: null,
          payout: { id: "po_1", stripeCreatedAt: new Date() },
        },
      }),
      { lineId: "txn_1", reservationId: "res_1" }
    );
    expect(res.ok).toBe(false);
  });

  it("sin reserva identificada no inventa dónde colgar el dinero", async () => {
    const res = await registrarCobroDeLinea(prismaFake({ reserva: null }), {
      lineId: "txn_1",
      reservationId: "res_borrada",
    });
    expect(res.ok).toBe(false);
  });
});
