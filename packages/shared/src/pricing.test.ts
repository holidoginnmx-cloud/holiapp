import { describe, expect, it } from "vitest";

import {
  DAYCARE_LATE_TOLERANCE_MIN,
  DAYCARE_MIN_HOURS,
  DEFAULT_LODGING_PRICING,
  bathSizeKey,
  computeDaycareExtraHours,
  computeDaycareHours,
  computeDays,
  isWithinDaycareHours,
  minutesFromHHmm,
  pricePerDayForWeight,
  sizeFromWeight,
} from "./pricing";

describe("sizeFromWeight", () => {
  it("colapsa pesos bajos y nulos a S", () => {
    expect(sizeFromWeight(null)).toBe("S");
    expect(sizeFromWeight(undefined)).toBe("S");
    expect(sizeFromWeight(0)).toBe("S");
    expect(sizeFromWeight(5)).toBe("S");
  });

  it("respeta los cortes exactos de la tabla (5/15/24 kg)", () => {
    expect(sizeFromWeight(5.1)).toBe("M");
    expect(sizeFromWeight(15)).toBe("M");
    expect(sizeFromWeight(15.1)).toBe("L");
    expect(sizeFromWeight(24)).toBe("L");
    expect(sizeFromWeight(24.1)).toBe("XL");
    expect(sizeFromWeight(60)).toBe("XL");
  });
});

describe("bathSizeKey", () => {
  it("XS colapsa a S y el resto pasa igual", () => {
    expect(bathSizeKey("XS")).toBe("S");
    expect(bathSizeKey("S")).toBe("S");
    expect(bathSizeKey("M")).toBe("M");
    expect(bathSizeKey("L")).toBe("L");
    expect(bathSizeKey("XL")).toBe("XL");
  });
});

describe("computeDays", () => {
  it("cuenta noches como delta de días-calendario UTC", () => {
    expect(
      computeDays(
        new Date("2026-08-10T00:00:00Z"),
        new Date("2026-08-13T00:00:00Z")
      )
    ).toBe(3);
  });

  it("no sobre-cuenta cuando las horas del día difieren", () => {
    // Check-in por la tarde y check-out por la mañana del día siguiente:
    // 1 noche, aunque el delta en ms sea menor a 24 h o más de 0.5 días.
    expect(
      computeDays(
        new Date("2026-08-10T22:00:00Z"),
        new Date("2026-08-11T09:00:00Z")
      )
    ).toBe(1);
    // Mismo día con horas distintas: 0 noches.
    expect(
      computeDays(
        new Date("2026-08-10T08:00:00Z"),
        new Date("2026-08-10T20:00:00Z")
      )
    ).toBe(0);
  });

  it("es negativo si el orden viene invertido (el caller lo rechaza)", () => {
    expect(
      computeDays(
        new Date("2026-08-13T00:00:00Z"),
        new Date("2026-08-10T00:00:00Z")
      )
    ).toBe(-3);
  });
});

describe("pricePerDayForWeight", () => {
  it("usa tarifa chica por debajo del umbral y grande desde el umbral", () => {
    expect(pricePerDayForWeight(19.9)).toBe(
      DEFAULT_LODGING_PRICING.pricePerDaySmall
    );
    expect(pricePerDayForWeight(20)).toBe(
      DEFAULT_LODGING_PRICING.pricePerDayLarge
    );
    expect(pricePerDayForWeight(35)).toBe(
      DEFAULT_LODGING_PRICING.pricePerDayLarge
    );
  });

  it("sin peso conocido cobra tarifa chica", () => {
    expect(pricePerDayForWeight(null)).toBe(
      DEFAULT_LODGING_PRICING.pricePerDaySmall
    );
    expect(pricePerDayForWeight(undefined)).toBe(
      DEFAULT_LODGING_PRICING.pricePerDaySmall
    );
  });

  it("respeta la config del admin (LodgingPricing) sobre los defaults", () => {
    const config = {
      ...DEFAULT_LODGING_PRICING,
      pricePerDaySmall: 400,
      pricePerDayLarge: 500,
      largeWeightKg: 25,
    };
    expect(pricePerDayForWeight(24, config)).toBe(400);
    expect(pricePerDayForWeight(25, config)).toBe(500);
  });
});

describe("minutesFromHHmm", () => {
  it("convierte HH:mm a minutos desde medianoche", () => {
    expect(minutesFromHHmm("00:00")).toBe(0);
    expect(minutesFromHHmm("8:30")).toBe(510);
    expect(minutesFromHHmm("23:59")).toBe(1439);
    expect(minutesFromHHmm(" 12:00 ")).toBe(720);
  });

  it("devuelve NaN con formato u horas inválidas", () => {
    expect(minutesFromHHmm("24:00")).toBeNaN();
    expect(minutesFromHHmm("12:60")).toBeNaN();
    expect(minutesFromHHmm("12")).toBeNaN();
    expect(minutesFromHHmm("mediodía")).toBeNaN();
    expect(minutesFromHHmm("")).toBeNaN();
  });
});

describe("computeDaycareHours", () => {
  it("redondea hacia arriba a hora completa", () => {
    expect(computeDaycareHours("09:00", "12:00")).toBe(3);
    expect(computeDaycareHours("09:00", "12:01")).toBe(4);
    expect(computeDaycareHours("09:30", "10:00")).toBe(1);
  });

  it("cobra mínimo DAYCARE_MIN_HOURS", () => {
    expect(computeDaycareHours("09:00", "09:10")).toBe(DAYCARE_MIN_HOURS);
  });

  it("devuelve 0 en rangos inválidos para que el caller rechace", () => {
    expect(computeDaycareHours("12:00", "12:00")).toBe(0);
    expect(computeDaycareHours("13:00", "12:00")).toBe(0);
    expect(computeDaycareHours("mal", "12:00")).toBe(0);
    expect(computeDaycareHours("09:00", "mal")).toBe(0);
  });
});

describe("computeDaycareExtraHours", () => {
  const salida = "17:00"; // 1020 min

  it("dentro de la tolerancia no cobra", () => {
    expect(computeDaycareExtraHours(salida, 1020)).toBe(0);
    expect(
      computeDaycareExtraHours(salida, 1020 + DAYCARE_LATE_TOLERANCE_MIN)
    ).toBe(0);
    // Recoger antes de tiempo tampoco cobra.
    expect(computeDaycareExtraHours(salida, 900)).toBe(0);
  });

  it("pasada la tolerancia redondea hacia arriba desde el retraso total", () => {
    expect(
      computeDaycareExtraHours(salida, 1020 + DAYCARE_LATE_TOLERANCE_MIN + 1)
    ).toBe(1);
    expect(computeDaycareExtraHours(salida, 1020 + 61)).toBe(2);
    expect(computeDaycareExtraHours(salida, 1020 + 120)).toBe(2);
  });

  it("salida estimada inválida no cobra (defensivo)", () => {
    expect(computeDaycareExtraHours("mal", 1200)).toBe(0);
  });
});

describe("isWithinDaycareHours", () => {
  it("acepta la ventana completa 9:00–18:00 inclusive", () => {
    expect(isWithinDaycareHours("09:00")).toBe(true);
    expect(isWithinDaycareHours("13:30")).toBe(true);
    expect(isWithinDaycareHours("18:00")).toBe(true);
  });

  it("rechaza fuera de ventana o formato inválido", () => {
    expect(isWithinDaycareHours("08:59")).toBe(false);
    expect(isWithinDaycareHours("18:01")).toBe(false);
    expect(isWithinDaycareHours("mal")).toBe(false);
  });
});
