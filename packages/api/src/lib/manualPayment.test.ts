import { describe, it, expect } from "vitest";
import { parseManualMethod, computeCardFee, methodTag } from "./manualPayment";

describe("parseManualMethod", () => {
  it("sin método = efectivo (default histórico)", () => {
    expect(parseManualMethod(undefined, undefined)).toEqual({
      ok: true,
      method: "CASH",
      cardBrand: null,
    });
  });

  it("ignora el tipo de tarjeta si el método no es tarjeta", () => {
    expect(parseManualMethod("TRANSFER", "DEBIT")).toEqual({
      ok: true,
      method: "TRANSFER",
      cardBrand: null,
    });
  });

  it("tarjeta exige el tipo", () => {
    expect(parseManualMethod("CARD", undefined).ok).toBe(false);
    expect(parseManualMethod("CARD", "VISA").ok).toBe(false);
    expect(parseManualMethod("CARD", "CREDIT")).toEqual({
      ok: true,
      method: "CARD",
      cardBrand: "CREDIT",
    });
  });

  it("rechaza métodos que el equipo no captura", () => {
    expect(parseManualMethod("STRIPE", undefined).ok).toBe(false);
    expect(parseManualMethod("CREDIT", undefined).ok).toBe(false);
  });
});

describe("computeCardFee", () => {
  const cfg = { debitPct: 0.0186, creditPct: 0.0227, amexPct: 0.029, ivaIncluded: true };

  it("aplica la tasa del tipo con IVA", () => {
    expect(computeCardFee(1000, cfg, "DEBIT")).toEqual({ pct: 0.0186 * 1.16, fee: 21.58 });
    expect(computeCardFee(1000, cfg, "CREDIT").fee).toBe(26.33);
    expect(computeCardFee(1000, cfg, "AMEX").fee).toBe(33.64);
  });

  it("sin IVA usa la tasa a secas", () => {
    expect(computeCardFee(1000, { ...cfg, ivaIncluded: false }, "DEBIT")).toEqual({
      pct: 0.0186,
      fee: 18.6,
    });
  });
});

describe("methodTag", () => {
  it("incluye el tipo solo en tarjeta", () => {
    expect(methodTag("CASH", null)).toBe("CASH");
    expect(methodTag("CARD", "DEBIT")).toBe("CARD débito");
  });
});
