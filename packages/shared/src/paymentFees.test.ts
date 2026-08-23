import { describe, expect, it } from "vitest";

import {
  paymentFee,
  paymentFeeBreakdown,
  totalPaymentFees,
} from "./paymentFees";

describe("paymentFee", () => {
  it("suma la comisión de Stripe y la de la terminal", () => {
    expect(
      paymentFee({ amount: 1050, stripeFeeAmount: 47.3, cardFeeAmount: 2 }),
    ).toBeCloseTo(49.3, 2);
  });

  it("es 0 en efectivo/transferencia (ambas comisiones null)", () => {
    expect(
      paymentFee({ amount: 1050, stripeFeeAmount: null, cardFeeAmount: null }),
    ).toBe(0);
  });

  it("es 0 cuando Stripe aún no concilia el cobro (campo ausente)", () => {
    expect(paymentFee({ amount: 1050 })).toBe(0);
  });

  it("lee los Decimal que llegan como string en el JSON", () => {
    expect(paymentFee({ amount: "1050.00", stripeFeeAmount: "47.30" })).toBeCloseTo(
      47.3,
      2,
    );
  });

  it("ignora basura no numérica en vez de propagar NaN", () => {
    expect(paymentFee({ amount: 1050, stripeFeeAmount: "n/a" })).toBe(0);
  });
});

describe("paymentFeeBreakdown", () => {
  it("desglosa bruto, comisión y neto", () => {
    const b = paymentFeeBreakdown({ amount: 1050, stripeFeeAmount: 47.3 });
    expect(b).not.toBeNull();
    expect(b!.gross).toBe(1050);
    expect(b!.fee).toBeCloseTo(47.3, 2);
    expect(b!.net).toBeCloseTo(1002.7, 2);
  });

  it("devuelve null cuando no hay comisión: el bruto ya es el neto", () => {
    expect(paymentFeeBreakdown({ amount: 1050 })).toBeNull();
    expect(
      paymentFeeBreakdown({ amount: 1050, stripeFeeAmount: 0 }),
    ).toBeNull();
  });

  it("devuelve null sin pago", () => {
    expect(paymentFeeBreakdown(null)).toBeNull();
    expect(paymentFeeBreakdown(undefined)).toBeNull();
  });
});

describe("totalPaymentFees", () => {
  it("suma solo los pagos que traen comisión", () => {
    expect(
      totalPaymentFees([
        { amount: 1050, stripeFeeAmount: 47.3 },
        { amount: 500, stripeFeeAmount: null },
        { amount: 210, stripeFeeAmount: 10.5 },
      ]),
    ).toBeCloseTo(57.8, 2);
  });

  it("es 0 en una lista vacía o ausente", () => {
    expect(totalPaymentFees([])).toBe(0);
    expect(totalPaymentFees(null)).toBe(0);
    expect(totalPaymentFees(undefined)).toBe(0);
  });
});
