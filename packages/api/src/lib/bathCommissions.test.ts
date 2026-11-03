import { describe, expect, it } from "vitest";
import {
  bathCharged,
  commissionRow,
  hotelWeek,
  weekTotals,
  type CommissionBathInput,
} from "./bathCommissions";

const RATES = { basePct: 0.3, extrasPct: 0.5 };

function bath(over: Partial<CommissionBathInput> = {}): CommissionBathInput {
  const addonId = over.addonId ?? "bath1";
  return {
    addonId,
    reservationId: "r1",
    reservationType: "BATH",
    reservationStatus: "CHECKED_OUT",
    completedAt: new Date("2026-10-28T18:00:00Z"),
    petName: "Camila",
    ownerName: "Ana López",
    unitPrice: 350,
    isCourtesy: false,
    variantCorte: false,
    variantDeslanado: false,
    variantPrice: 350,
    extraCortePrice: null,
    extraDeslanadoPrice: null,
    extraPaymentStatus: null,
    totalAmount: 350,
    homeDeliveryFee: 0,
    siblings: [{ id: addonId, unitPrice: 350, isCourtesy: false, isBath: true }],
    ...over,
  };
}

describe("hotelWeek", () => {
  it("lleva cualquier día al lunes de su semana", () => {
    const w = hotelWeek("2026-10-30"); // viernes
    expect(w.weekStart).toBe("2026-10-26");
    expect(w.weekEnd).toBe("2026-11-01");
  });

  it("el domingo pertenece a la semana que empezó el lunes anterior", () => {
    expect(hotelWeek("2026-11-01").weekStart).toBe("2026-10-26");
    expect(hotelWeek("2026-11-02").weekStart).toBe("2026-11-02");
  });

  it("los límites van en hora del hotel (UTC-7)", () => {
    const w = hotelWeek("2026-10-26");
    expect(w.from.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-11-02T07:00:00.000Z");
    // Domingo 23:00 en Hermosillo = lunes 06:00 UTC: aún es esta semana.
    const domingoNoche = new Date("2026-11-02T06:00:00Z");
    expect(domingoNoche >= w.from && domingoNoche < w.to).toBe(true);
  });

  it("sin fecha usa el día del hotel, no el de UTC", () => {
    // Lunes 2-nov 02:00 UTC = domingo 1-nov 19:00 en el hotel.
    const w = hotelWeek(undefined, new Date("2026-11-02T02:00:00Z"));
    expect(w.weekStart).toBe("2026-10-26");
  });
});

describe("bathCharged", () => {
  it("cita suelta: el total pactado sin domicilio", () => {
    expect(bathCharged(bath({ totalAmount: 450, homeDeliveryFee: 100 }))).toBe(350);
  });

  it("cita suelta con otro add-on cobrable: se le resta su precio", () => {
    const b = bath({
      totalAmount: 660,
      siblings: [
        { id: "bath1", unitPrice: 350, isCourtesy: false, isBath: true },
        { id: "dw", unitPrice: 310, isCourtesy: false, isBath: false },
      ],
    });
    expect(bathCharged(b)).toBe(350);
  });

  it("baño de perro hospedado: el unitPrice del add-on", () => {
    expect(bathCharged(bath({ reservationType: "STAY", totalAmount: 2400, unitPrice: 450 }))).toBe(450);
  });
});

describe("commissionRow (15% sobre el precio normal)", () => {
  const R15 = { basePct: 0.15, extrasPct: 0.15 };

  it("baño + corte + deslanado capturados", () => {
    const row = commissionRow(
      bath({ variantCorte: true, variantDeslanado: true, extraCortePrice: 150, extraDeslanadoPrice: 200 }),
      R15,
    );
    expect(row.base).toBe(350);
    expect(row.corte).toBe(150);
    expect(row.deslanado).toBe(200);
    expect(row.commission).toBe(105);
    expect(row.flags).toEqual([]);
  });

  it("con descuento se paga sobre el precio normal", () => {
    const row = commissionRow(bath({ totalAmount: 300 }), R15);
    expect(row.base).toBe(350);
    expect(row.commission).toBe(52.5);
    expect(row.flags).toEqual(["DESCUENTO"]);
  });

  it("cortesía se paga sobre el precio normal", () => {
    const row = commissionRow(bath({ isCourtesy: true, totalAmount: 0 }), R15);
    expect(row.base).toBe(350);
    expect(row.commission).toBe(52.5);
    expect(row.flags).toEqual(["CORTESIA"]);
  });

  it("el domicilio no entra", () => {
    const row = commissionRow(bath({ totalAmount: 450, homeDeliveryFee: 100 }), R15);
    expect(row.commission).toBe(52.5);
    expect(row.flags).toEqual([]);
  });

  it("baño de perro hospedado: igual que uno suelto", () => {
    const row = commissionRow(bath({ reservationType: "STAY", totalAmount: 2400 }), R15);
    expect(row.commission).toBe(52.5);
  });

  it("aplica un % al baño y otro a los extras", () => {
    const row = commissionRow(
      bath({ variantCorte: true, variantDeslanado: true, extraCortePrice: 150, extraDeslanadoPrice: 200 }),
      RATES,
    );
    expect(row.commission).toBe(105 + 175);
  });

  it("extras a medio capturar: cuenta lo capturado y avisa lo que falta", () => {
    const row = commissionRow(
      bath({ variantCorte: true, variantDeslanado: true, extraCortePrice: 150 }),
      RATES,
    );
    expect(row.corte).toBe(150);
    expect(row.deslanado).toBe(0);
    expect(row.flags).toContain("EXTRAS_SIN_PRECIO");
  });

  it("corte dentro del total manual: lo que pasa de la lista es corte", () => {
    const row = commissionRow(bath({ variantCorte: true, totalAmount: 520 }), R15);
    expect(row.base).toBe(350);
    expect(row.extrasIncluded).toBe(170);
    expect(row.commission).toBe(78);
    expect(row.flags).toEqual(["EXTRAS_EN_TOTAL"]);
  });

  it("baño de estancia capturado en la web con el corte sumado al precio", () => {
    const row = commissionRow(
      bath({ reservationType: "STAY", variantCorte: true, unitPrice: 520, variantPrice: 350, totalAmount: 3000 }),
      R15,
    );
    expect(row.base).toBe(350);
    expect(row.extrasIncluded).toBe(170);
    expect(row.flags).toEqual(["EXTRAS_EN_TOTAL"]);
  });

  it("precio por encima de la lista SIN corte en la variante: se paga la lista", () => {
    const row = commissionRow(bath({ totalAmount: 400 }), R15);
    expect(row.base).toBe(350);
    expect(row.extrasIncluded).toBe(0);
    expect(row.flags).toEqual([]);
  });

  it("precio especial editado en el add-on: se paga la lista", () => {
    const row = commissionRow(bath({ reservationType: "STAY", unitPrice: 200, totalAmount: 2000 }), R15);
    expect(row.base).toBe(350);
    expect(row.flags).toEqual(["DESCUENTO"]);
  });

  it("cita suelta sin liquidar cuenta igual, marcada por cobrar", () => {
    const row = commissionRow(bath({ reservationStatus: "CONFIRMED" }), R15);
    expect(row.commission).toBe(52.5);
    expect(row.flags).toContain("POR_COBRAR");
  });

  it("redondea a centavos", () => {
    const row = commissionRow(bath({ variantPrice: 333.33 }), { basePct: 0.15, extrasPct: 0 });
    expect(row.commission).toBe(50);
  });
});

describe("weekTotals", () => {
  it("suma la semana en orden de fecha", () => {
    const t = weekTotals(
      [
        bath({ addonId: "b", completedAt: new Date("2026-10-29T18:00:00Z") }),
        bath({ addonId: "a", completedAt: new Date("2026-10-27T18:00:00Z") }),
        bath({ addonId: "c", extraCortePrice: 100, variantCorte: true }),
      ],
      RATES,
    );
    expect(t.baths.map((r) => r.addonId)).toEqual(["a", "c", "b"]);
    expect(t.count).toBe(3);
    expect(t.baseTotal).toBe(1050);
    expect(t.extrasTotal).toBe(100);
    expect(t.commission).toBe(105 * 3 + 50); // RATES: 30% baño, 50% extras
  });
});
