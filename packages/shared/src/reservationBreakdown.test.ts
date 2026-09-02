import { describe, expect, it } from "vitest";
import {
  buildReservationBreakdown,
  sumBreakdownRows,
  type BreakdownInput,
} from "./reservationBreakdown";

const fmt = (n: number) => `$${Math.round(n)}`;

function build(r: BreakdownInput) {
  return buildReservationBreakdown(r, { formatMoney: fmt });
}

/**
 * El invariante que sostiene toda la feature: al cliente no se le puede
 * enseñar un desglose cuyas líneas no sumen el total que se le cobra.
 */
function expectCuadra(r: BreakdownInput) {
  const b = build(r);
  expect(Math.abs(sumBreakdownRows(b.rows) - b.total)).toBeLessThanOrEqual(0.5);
  return b;
}

const bathAddon = (over: Record<string, unknown> = {}) => ({
  id: "ad_1",
  unitPrice: "350",
  paidWith: "BOOKING",
  isCourtesy: false,
  variant: {
    deslanado: false,
    corte: false,
    serviceType: { code: "BATH", name: "Baño" },
  },
  ...over,
});

describe("buildReservationBreakdown", () => {
  it("estancia con desglose persistido: hospedaje con tarifa, medicamento y mismo día", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "1_710".replace("_", ""), // 1710
      totalDays: 3,
      lodgingAmount: "1350",
      medicationFee: "135",
      sameDayFee: "225",
    });
    expect(b.rows.map((r) => r.label)).toEqual([
      "Hospedaje · $450 × 3 noches",
      "Administración de medicamento (+10%)",
      "Reserva el mismo día (+20%)",
    ]);
    expect(b.rows[0].amount).toBe(1350);
  });

  it("estancia con total manual del equipo: deriva el hospedaje, sin línea de ajuste", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "1200",
      totalDays: 3,
      lodgingAmount: null,
      addons: [bathAddon()],
    });
    expect(b.rows.map((r) => r.label)).toEqual(["Hospedaje", "Baño"]);
    // 1200 − 350 de baño
    expect(b.rows[0].amount).toBe(850);
    expect(b.rows.some((r) => r.key === "adjustment")).toBe(false);
  });

  it("baño: la base es el add-on, con deslanado y corte en la etiqueta", () => {
    const b = expectCuadra({
      reservationType: "BATH",
      totalAmount: "550",
      addons: [
        bathAddon({
          unitPrice: "550",
          variant: {
            deslanado: true,
            corte: true,
            serviceType: { code: "BATH", name: "Baño" },
          },
        }),
      ],
    });
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].label).toBe("Baño con deslanado y corte");
  });

  it("guardería: deriva las horas del horario capturado", () => {
    const b = expectCuadra({
      reservationType: "DAYCARE",
      totalAmount: "150",
      checkInTime: "09:00",
      checkOutTime: "15:00",
    });
    expect(b.rows[0].label).toBe("Guardería · 6 horas");
    expect(b.rows[0].amount).toBe(150);
  });

  it("horas extra: usa la cantidad y no la tarifa unitaria", () => {
    const b = expectCuadra({
      reservationType: "DAYCARE",
      totalAmount: "225",
      durationMinutes: 360,
      addons: [
        bathAddon({
          id: "ad_h",
          unitPrice: "75",
          quantity: 3,
          variant: {
            serviceType: { code: "EXTRA_HOURS", name: "Horas extra" },
          },
        }),
      ],
    });
    expect(b.rows.map((r) => r.label)).toEqual([
      "Guardería · 6 horas",
      "Horas extra · 3 horas",
    ]);
  });

  it("cortesía: se ve el servicio regalado sin sumar al total", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "900",
      totalDays: 2,
      lodgingAmount: "900",
      addons: [bathAddon({ isCourtesy: true, unitPrice: "350" })],
    });
    const cortesia = b.rows.find((r) => r.isCourtesy);
    expect(cortesia).toMatchObject({ amount: 0, listPrice: 350 });
    expect(b.total).toBe(900);
  });

  it("descuento y domicilio entran con su signo", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "1050",
      totalDays: 2,
      lodgingAmount: "900",
      discountTotal: "100",
      homeDelivery: true,
      homeDeliveryFee: "250",
    });
    const desc = b.rows.find((r) => r.key === "discount");
    expect(desc).toMatchObject({ amount: 100, negative: true });
    expect(b.rows.find((r) => r.key === "delivery")?.amount).toBe(250);
  });

  it("total editado después de crear: la diferencia sale como ajuste", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "1500",
      totalDays: 3,
      lodgingAmount: "1350",
    });
    expect(b.rows.at(-1)).toMatchObject({
      key: "adjustment",
      label: "Ajuste del equipo",
      amount: 150,
    });
  });

  it("total bajado a mano: el ajuste se muestra como descuento", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "1200",
      totalDays: 3,
      lodgingAmount: "1350",
    });
    expect(b.rows.at(-1)).toMatchObject({
      key: "adjustment",
      label: "Descuento aplicado",
      amount: 150,
      negative: true,
    });
  });

  it("descuadres de centavos no generan línea de ajuste", () => {
    const b = build({
      reservationType: "STAY",
      totalAmount: "1350.30",
      totalDays: 3,
      lodgingAmount: "1350",
    });
    expect(b.rows.some((r) => r.key === "adjustment")).toBe(false);
  });

  it("los add-ons STANDALONE no entran: se cobran por su cuenta", () => {
    const b = expectCuadra({
      reservationType: "STAY",
      totalAmount: "900",
      totalDays: 2,
      lodgingAmount: "900",
      addons: [bathAddon({ paidWith: "STANDALONE", unitPrice: "350" })],
    });
    expect(b.rows).toHaveLength(1);
  });

  it("extras del baño sin cobrar salen aparte, nunca dentro del total", () => {
    const b = expectCuadra({
      reservationType: "BATH",
      totalAmount: "350",
      addons: [
        bathAddon({
          extraDeslanadoPrice: "200",
          extraCortePrice: "150",
          extraPaymentStatus: "PAY_ON_PICKUP",
        }),
      ],
    });
    expect(b.total).toBe(350);
    expect(b.pendingExtras.map((e) => e.label)).toEqual(["Deslanado", "Corte"]);
  });

  it("extras ya pagados no se repiten como pendientes", () => {
    const b = build({
      reservationType: "BATH",
      totalAmount: "350",
      addons: [
        bathAddon({
          extraDeslanadoPrice: "200",
          extraPaymentStatus: "PAID",
        }),
      ],
    });
    expect(b.pendingExtras).toHaveLength(0);
  });

  it("reserva sin datos no revienta", () => {
    const b = build({});
    expect(b.total).toBe(0);
    expect(b.rows).toEqual([]);
  });
});
