import { describe, expect, it, vi } from "vitest";

// refund.ts instancia Stripe al cargar el módulo; sin llave en tests, el SDK
// lanza. Aquí solo se prueba la parte pura (planRefund), así que se sustituye.
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({ refunds: { create: vi.fn() } })),
}));

import { planRefund } from "./refund";
import { computeChangeTotal } from "./pricing";

describe("planRefund — a la tarjeta solo vuelve lo que la tarjeta pagó", () => {
  it("todo con tarjeta: un refund por el monto del PI", () => {
    const plan = planRefund(
      [{ id: "p1", amount: 300, method: "STRIPE", stripePaymentIntentId: "pi_1" }],
      "STRIPE_REFUND",
    );
    expect(plan.total).toBe(300);
    expect(plan.toStripe).toEqual([{ paymentIntentId: "pi_1", amount: 300, paymentId: "p1" }]);
    expect(plan.toCredit).toBe(0);
  });

  it("anticipo con tarjeta + resto en efectivo: tarjeta $300, saldo $700 (antes pedía $1,000 a un PI de $300)", () => {
    const plan = planRefund(
      [
        { id: "p1", amount: 300, method: "STRIPE", stripePaymentIntentId: "pi_1" },
        { id: "p2", amount: 700, method: "CASH", stripePaymentIntentId: null },
      ],
      "STRIPE_REFUND",
    );
    expect(plan.total).toBe(1000);
    expect(plan.toStripe).toEqual([{ paymentIntentId: "pi_1", amount: 300, paymentId: "p1" }]);
    expect(plan.toCredit).toBe(700);
  });

  it("saldo a favor aplicado (pago CREDIT aparte) no se pide a Stripe", () => {
    const plan = planRefund(
      [
        { id: "c", amount: 100, method: "CREDIT", stripePaymentIntentId: null },
        { id: "s", amount: 200, method: "STRIPE", stripePaymentIntentId: "pi_1" },
      ],
      "STRIPE_REFUND",
    );
    expect(plan.toStripe).toEqual([{ paymentIntentId: "pi_1", amount: 200, paymentId: "s" }]);
    expect(plan.toCredit).toBe(100);
  });

  it("dos PIs distintos (anticipo + saldo): cada uno devuelve lo suyo", () => {
    const plan = planRefund(
      [
        { id: "a", amount: 200, method: "STRIPE", stripePaymentIntentId: "pi_dep" },
        { id: "b", amount: 800, method: "STRIPE", stripePaymentIntentId: "pi_bal" },
      ],
      "STRIPE_REFUND",
    );
    expect(plan.toStripe).toEqual([
      { paymentIntentId: "pi_dep", amount: 200, paymentId: "a" },
      { paymentIntentId: "pi_bal", amount: 800, paymentId: "b" },
    ]);
  });

  it("fila hermana de un grupo (STRIPE sin PI) usa el PI del grupo", () => {
    const plan = planRefund(
      [{ id: "h", amount: 200, method: "STRIPE", stripePaymentIntentId: null }],
      "STRIPE_REFUND",
      "pi_grupo",
    );
    expect(plan.toStripe).toEqual([{ paymentIntentId: "pi_grupo", amount: 200, paymentId: "h" }]);
    expect(plan.toCredit).toBe(0);
  });

  it("STRIPE sin PI y sin grupo: no hay a dónde devolver, va a saldo", () => {
    const plan = planRefund(
      [{ id: "h", amount: 200, method: "STRIPE", stripePaymentIntentId: null }],
      "STRIPE_REFUND",
    );
    expect(plan.toStripe).toEqual([]);
    expect(plan.toCredit).toBe(200);
  });

  it("CREDIT: todo a saldo, nada a Stripe", () => {
    const plan = planRefund(
      [
        { id: "p1", amount: 300, method: "STRIPE", stripePaymentIntentId: "pi_1" },
        { id: "p2", amount: 700, method: "CASH", stripePaymentIntentId: null },
      ],
      "CREDIT",
    );
    expect(plan.toStripe).toEqual([]);
    expect(plan.toCredit).toBe(1000);
  });
});

describe("computeChangeTotal — cambio de fechas por delta", () => {
  const cfg = {
    pricePerDaySmall: 350,
    pricePerDayLarge: 450,
    largeWeightKg: 20,
    medicationSurchargePct: 0.1,
    daycareHourPrice: 25,
  };
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it("extender 2→3 noches con domicilio $260 suma solo la noche (+$350), no pierde el domicilio", () => {
    const r = computeChangeTotal({
      petWeightKg: 15,
      currentCheckIn: d("2026-09-10"),
      currentCheckOut: d("2026-09-12"),
      newCheckIn: d("2026-09-10"),
      newCheckOut: d("2026-09-13"),
      hasMedication: false,
      currentTotal: 960, // 700 hospedaje + 260 domicilio
      currentLodgingAmount: 700,
      config: cfg,
    });
    expect(r.newTotalDays).toBe(3);
    expect(r.delta).toBe(350);
    expect(r.newTotal).toBe(1310);
  });

  it("con descuento del 10% ya aplicado, el descuento se conserva (delta = una noche)", () => {
    const r = computeChangeTotal({
      petWeightKg: 15,
      currentCheckIn: d("2026-09-10"),
      currentCheckOut: d("2026-09-12"),
      newCheckIn: d("2026-09-10"),
      newCheckOut: d("2026-09-13"),
      hasMedication: false,
      currentTotal: 630, // 700 − 70
      currentLodgingAmount: 700,
      config: cfg,
    });
    expect(r.delta).toBe(350);
    expect(r.newTotal).toBe(980);
  });

  it("recortar 3→2 noches con medicamento devuelve la noche y su recargo", () => {
    const r = computeChangeTotal({
      petWeightKg: 25,
      currentCheckIn: d("2026-09-10"),
      currentCheckOut: d("2026-09-13"),
      newCheckIn: d("2026-09-10"),
      newCheckOut: d("2026-09-12"),
      hasMedication: true,
      currentTotal: 1350 + 135 + 400, // hospedaje + med + baño
      currentLodgingAmount: 1350,
      currentMedicationFee: 135,
      config: cfg,
    });
    // nuevo hospedaje 900, med ceil(90) = 90 → delta = (900−1350) + (90−135) = −495
    expect(r.delta).toBe(-495);
    expect(r.newTotal).toBe(1390);
  });

  it("sin desglose persistido (reserva vieja) deriva el hospedaje actual con la tarifa", () => {
    const r = computeChangeTotal({
      petWeightKg: 15,
      currentCheckIn: d("2026-09-10"),
      currentCheckOut: d("2026-09-12"),
      newCheckIn: d("2026-09-10"),
      newCheckOut: d("2026-09-14"),
      hasMedication: false,
      currentTotal: 700,
      config: cfg,
    });
    expect(r.delta).toBe(700);
    expect(r.newTotal).toBe(1400);
  });

  it("los add-ons de cortesía nunca entran al cálculo (el total no los incluía y el delta no los toca)", () => {
    const r = computeChangeTotal({
      petWeightKg: 15,
      currentCheckIn: d("2026-09-10"),
      currentCheckOut: d("2026-09-12"),
      newCheckIn: d("2026-09-10"),
      newCheckOut: d("2026-09-12"),
      hasMedication: false,
      currentTotal: 700,
      currentLodgingAmount: 700,
      config: cfg,
    });
    expect(r.delta).toBe(0);
    expect(r.newTotal).toBe(700);
  });
});
