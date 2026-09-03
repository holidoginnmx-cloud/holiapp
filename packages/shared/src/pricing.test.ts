import { describe, expect, it } from "vitest";

import {
  DAYCARE_LATE_TOLERANCE_MIN,
  DAYCARE_MIN_HOURS,
  DEFAULT_LODGING_PRICING,
  bathSizeKey,
  computeDaycareExtraHours,
  computeDaycareHours,
  computeDays,
  hoursUntilHotelDay,
  isWithinDaycareHours,
  minutesFromHHmm,
  pricePerDayForWeight,
  sizeFromWeight,
  SIZE_RANGES_KG,
  sizeRangeLabel,
  SAME_DAY_SURCHARGE_PCT,
  ceilMoney,
  roundMoney,
  computeStayPricing,
  allocateProportional,
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

describe("hoursUntilHotelDay", () => {
  // checkIn guardado a las 00:00 UTC del 10 de septiembre = día calendario
  // 10-sep en Hermosillo, cuya medianoche local es 07:00 UTC.
  const checkIn = new Date("2026-09-10T00:00:00.000Z");

  it("mide contra la medianoche LOCAL del día (00:00 UTC + 7 h)", () => {
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 10, 7, 0))).toBe(0);
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 10, 0, 0))).toBe(7);
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 10, 8, 0))).toBe(-1);
  });

  it("mismo día (< 24 h): a las 17:00 local de dos días antes NO aplica", () => {
    // 8-sep 17:00 Hermosillo = 9-sep 00:00 UTC. Con la resta ingenua daría
    // 24 h exactas y cualquier segundo después caía en el recargo.
    const eveningTwoDaysBefore = Date.UTC(2026, 8, 9, 0, 30);
    expect(hoursUntilHotelDay(checkIn, eveningTwoDaysBefore)).toBeGreaterThan(24);
    // 9-sep 01:00 local (08:00 UTC) sí son menos de 24 h.
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 9, 8, 0))).toBeLessThan(24);
  });

  it("anticipo (≥ 72 h): sigue disponible la tarde del día −4 local", () => {
    // 6-sep 20:00 Hermosillo = 7-sep 03:00 UTC. Ingenuo: 69 h (bloqueado);
    // real: 76 h (permitido).
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 7, 3, 0))).toBe(76);
    // 7-sep 01:00 local (08:00 UTC) → 71 h: ya no.
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 7, 8, 0))).toBe(71);
  });

  it("acepta otro desfase y usa Date.now() por defecto", () => {
    expect(hoursUntilHotelDay(checkIn, Date.UTC(2026, 8, 10, 0, 0), 0)).toBe(0);
    expect(typeof hoursUntilHotelDay(checkIn)).toBe("number");
  });
});

describe("SIZE_RANGES_KG", () => {
  it("es la misma tabla que sizeFromWeight (tope inclusivo, piso exclusivo)", () => {
    for (let i = 0; i < SIZE_RANGES_KG.length; i++) {
      const { size, upToKg } = SIZE_RANGES_KG[i];
      if (upToKg != null) {
        expect(sizeFromWeight(upToKg)).toBe(size);
        expect(sizeFromWeight(upToKg + 0.1)).not.toBe(size);
      } else {
        expect(sizeFromWeight(SIZE_RANGES_KG[i - 1].upToKg! + 0.1)).toBe(size);
        expect(sizeFromWeight(200)).toBe(size);
      }
    }
  });

  it("etiqueta cada tramo", () => {
    expect(sizeRangeLabel("S")).toBe("≤ 5 kg");
    expect(sizeRangeLabel("M")).toBe("5–15 kg");
    expect(sizeRangeLabel("L")).toBe("15–24 kg");
    expect(sizeRangeLabel("XL")).toBe("> 24 kg");
  });
});

describe("ceilMoney / roundMoney", () => {
  it("ceil a peso entero sin dejarse engañar por el ruido flotante", () => {
    expect(ceilMoney(77.00000000000001)).toBe(77);
    expect(ceilMoney(385 * 0.2)).toBe(77);
    expect(ceilMoney(0.1 * 3 * 100)).toBe(30);
    expect(ceilMoney(35.01)).toBe(36);
    expect(ceilMoney(35)).toBe(35);
    expect(ceilMoney(0)).toBe(0);
  });

  it("roundMoney normaliza a centavos", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(12.345)).toBe(12.35);
    expect(roundMoney(12.344)).toBe(12.34);
  });
});

describe("computeStayPricing", () => {
  const cfg = DEFAULT_LODGING_PRICING;

  it("hospedaje = tarifa por peso × noches, sin recargos", () => {
    const r = computeStayPricing({
      petWeightKg: 12,
      totalDays: 3,
      hasMedication: false,
      sameDay: false,
      config: cfg,
    });
    expect(r).toEqual({
      totalDays: 3,
      pricePerDay: 350,
      lodging: 1050,
      medicationFee: 0,
      addonsAmount: 0,
      discount: 0,
      subtotal: 1050,
      sameDayFee: 0,
      total: 1050,
    });
  });

  it("toma la tarifa de grande a partir del umbral configurado", () => {
    expect(
      computeStayPricing({ petWeightKg: 20, totalDays: 2, hasMedication: false, sameDay: false, config: cfg })
        .pricePerDay
    ).toBe(450);
    expect(
      computeStayPricing({ petWeightKg: 19.9, totalDays: 2, hasMedication: false, sameDay: false, config: cfg })
        .pricePerDay
    ).toBe(350);
  });

  it("cuenta las noches con computeDays cuando vienen fechas (no ceil de milisegundos)", () => {
    const r = computeStayPricing({
      petWeightKg: 5,
      checkIn: new Date("2026-09-10T09:00:00Z"),
      checkOut: new Date("2026-09-15T18:00:00Z"),
      hasMedication: false,
      sameDay: false,
      config: cfg,
    });
    expect(r.totalDays).toBe(5);
    expect(r.lodging).toBe(1750);
  });

  it("totalDays explícito manda sobre las fechas y nunca es negativo", () => {
    const r = computeStayPricing({
      petWeightKg: 5,
      totalDays: 2,
      checkIn: new Date("2026-09-10T00:00:00Z"),
      checkOut: new Date("2026-09-20T00:00:00Z"),
      hasMedication: false,
      sameDay: false,
      config: cfg,
    });
    expect(r.totalDays).toBe(2);
    const neg = computeStayPricing({
      petWeightKg: 5,
      checkIn: new Date("2026-09-20T00:00:00Z"),
      checkOut: new Date("2026-09-10T00:00:00Z"),
      hasMedication: false,
      sameDay: false,
      config: cfg,
    });
    expect(neg.totalDays).toBe(0);
    expect(neg.total).toBe(0);
  });

  it("medicamento: porcentaje CONFIGURABLE sobre el hospedaje, redondeado hacia arriba", () => {
    const base = computeStayPricing({ petWeightKg: 30, totalDays: 3, hasMedication: true, sameDay: false, config: cfg });
    expect(base.lodging).toBe(1350);
    expect(base.medicationFee).toBe(135); // 10 % default
    expect(base.total).toBe(1485);

    const custom = computeStayPricing({
      petWeightKg: 30,
      totalDays: 3,
      hasMedication: true,
      sameDay: false,
      config: { ...cfg, medicationSurchargePct: 0.15 },
    });
    expect(custom.medicationFee).toBe(203); // ceil(202.5)

    const off = computeStayPricing({
      petWeightKg: 30,
      totalDays: 3,
      hasMedication: true,
      sameDay: false,
      config: { ...cfg, medicationSurchargePct: 0 },
    });
    expect(off.medicationFee).toBe(0);
  });

  it("mismo día: 20 % sobre hospedaje + medicamento + add-ons − descuento, hacia arriba", () => {
    const r = computeStayPricing({
      petWeightKg: 10,
      totalDays: 1,
      hasMedication: true,
      sameDay: true,
      addonsAmount: 320,
      config: cfg,
    });
    // 350 + 35 + 320 = 705 → 20 % = 141
    expect(r.subtotal).toBe(705);
    expect(r.sameDayFee).toBe(141);
    expect(r.total).toBe(846);
    expect(SAME_DAY_SURCHARGE_PCT).toBe(0.2);

    const conDescuento = computeStayPricing({
      petWeightKg: 10,
      totalDays: 1,
      hasMedication: false,
      sameDay: true,
      addonsAmount: 320,
      discount: 67.33,
      config: cfg,
    });
    // 670 − 67.33 = 602.67 → 20 % = 120.534 → 121
    expect(conDescuento.subtotal).toBe(602.67);
    expect(conDescuento.sameDayFee).toBe(121);
    expect(conDescuento.total).toBe(723.67);
  });

  it("un descuento mayor que la base no deja el subtotal negativo", () => {
    const r = computeStayPricing({
      petWeightKg: 3,
      totalDays: 1,
      hasMedication: false,
      sameDay: true,
      discount: 1000,
      config: cfg,
    });
    expect(r.subtotal).toBe(0);
    expect(r.sameDayFee).toBe(0);
    expect(r.total).toBe(0);
  });

  it("PARIDAD con la fórmula histórica de create-intent (default 10 %, montos enteros)", () => {
    // Oráculo: lo que /payments/create-intent cobró siempre.
    for (const peso of [4, 12, 22, 35]) {
      for (const noches of [1, 3, 7, 13]) {
        for (const med of [false, true]) {
          const ppd = peso >= 20 ? 450 : 350;
          const lodging = ppd * noches;
          const medFee = med ? Math.ceil(lodging * 0.1) : 0;
          const r = computeStayPricing({ petWeightKg: peso, totalDays: noches, hasMedication: med, sameDay: false, config: cfg });
          expect(r.lodging).toBe(lodging);
          expect(r.medicationFee).toBe(medFee);
          expect(r.total).toBe(lodging + medFee);
          // Mismo día sobre la base completa (hospedaje + medicamento): entero.
          const sd = computeStayPricing({ petWeightKg: peso, totalDays: noches, hasMedication: med, sameDay: true, config: cfg });
          expect(sd.sameDayFee).toBe(Math.ceil((lodging + medFee) * 0.2));
          expect(Number.isInteger(sd.total)).toBe(true);
        }
      }
    }
  });
});

describe("allocateProportional", () => {
  it("reparte a centavos y la última fila absorbe el redondeo", () => {
    const parts = allocateProportional(100, [1, 1, 1]);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });

  it("proporcional a los pesos", () => {
    expect(allocateProportional(90, [700, 200])).toEqual([70, 20]);
  });

  it("una sola fila se lleva todo; sin filas no hay nada", () => {
    expect(allocateProportional(45.678, [3])).toEqual([45.68]);
    expect(allocateProportional(45, [])).toEqual([]);
  });

  it("pesos en cero → partes iguales", () => {
    expect(allocateProportional(10, [0, 0, 0])).toEqual([3.33, 3.33, 3.34]);
  });
});
