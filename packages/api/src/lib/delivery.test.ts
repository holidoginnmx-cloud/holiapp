/**
 * Tarifa del servicio a domicilio según los viajes contratados.
 *
 * Lo que se cuida aquí es una confusión de $200 por reserva: la tarifa de UN
 * traslado ya incluye el regreso de la camioneta al hotel (km × 2), así que es
 * fácil creer que "ida y vuelta" ya está pagado. No lo está — un cliente que
 * pide que además se lo regresen está pidiendo una segunda salida.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./maps", () => ({
  distanceKmFromHdi: vi.fn(async () => 8),
}));

import { quoteDelivery } from "./delivery";

// Prisma de mentiras: solo el upsert del singleton de configuración.
function prismaCon(config: {
  baseFee: number;
  pricePerKm: number;
  isActive: boolean;
}) {
  return {
    deliveryConfig: { upsert: vi.fn(async () => config) },
  } as never;
}

const CONFIG = { baseFee: 50, pricePerKm: 10, isActive: true };

describe("quoteDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("un traslado sencillo cobra base + los km de ida y vuelta de la camioneta", async () => {
    // 50 + (8 × 2 × 10) = 210
    const q = await quoteDelivery(prismaCon(CONFIG), 29.1, -110.9);
    expect(q).toEqual({ active: true, distanceKm: 8, fee: 210 });
  });

  it("recoger y entregar cuestan lo mismo: es el mismo recorrido", async () => {
    const ida = await quoteDelivery(prismaCon(CONFIG), 29.1, -110.9, "PICKUP");
    const vuelta = await quoteDelivery(prismaCon(CONFIG), 29.1, -110.9, "DROPOFF");
    expect(vuelta.fee).toBe(ida.fee);
  });

  it("el redondo son DOS salidas y vale el doble, base incluida", async () => {
    const q = await quoteDelivery(prismaCon(CONFIG), 29.1, -110.9, "ROUND_TRIP");
    expect(q.fee).toBe(420);
  });

  // `distanceKm` es lo que se imprime en el documento y en el detalle de la
  // reserva: son los kilómetros hasta la casa, no los que recorre la camioneta.
  it("la distancia reportada no cambia con el viaje contratado", async () => {
    const q = await quoteDelivery(prismaCon(CONFIG), 29.1, -110.9, "ROUND_TRIP");
    expect(q.distanceKm).toBe(8);
  });

  it("con el servicio apagado no cobra nada, sea cual sea el viaje", async () => {
    const q = await quoteDelivery(
      prismaCon({ ...CONFIG, isActive: false }),
      29.1,
      -110.9,
      "ROUND_TRIP"
    );
    expect(q).toEqual({ active: false, distanceKm: 0, fee: 0 });
  });
});
