import { describe, expect, it } from "vitest";

import {
  computeQuote,
  type QuoteCatalog,
  type QuotePetInput,
} from "@holidoginn/shared";
import { computeDaycareHours, pricePerDayForWeight } from "./pricing";

// ============================================================
// TESTS DE PARIDAD — computeQuote vs. POST /reservations
//
// El cálculo de precio vive en DOS lugares a propósito: inline en el handler de
// POST /reservations (packages/api/src/routes/reservations.ts, ramas BATH ~615,
// DAYCARE ~764 y STAY ~838) y en computeQuote (packages/shared/src/quote.ts).
// No se refactorizó la ruta porque por ahí pasa el dinero de todos los flujos
// (cliente, admin, staff, invitado) y no tiene tests de integración.
//
// Estos tests SON la red de seguridad de esa decisión: replican la fórmula del
// handler como oráculo y exigen que computeQuote dé el mismo número. Si alguien
// cambia una y no la otra, truenan aquí — que es exactamente lo que se quiere,
// porque la cotización promete un precio que la reserva tiene que cobrar.
//
// ⚠️ Si tocas la fórmula de reservations.ts, actualiza los oráculos de abajo.
// ============================================================

const CATALOG: QuoteCatalog = {
  lodging: {
    pricePerDaySmall: 350,
    pricePerDayLarge: 450,
    priceProbarfSmall: 300,
    priceProbarfLarge: 400,
    largeWeightKg: 20,
    medicationSurchargePct: 0.1,
    daycareHourPrice: 25,
  },
  bathVariants: [
    { id: "b-s", petSize: "S", deslanado: false, corte: false, price: 250 },
    { id: "b-s-d", petSize: "S", deslanado: true, corte: false, price: 380 },
    { id: "b-s-dc", petSize: "S", deslanado: true, corte: true, price: 470 },
    { id: "b-s-c", petSize: "S", deslanado: false, corte: true, price: 340 },
    { id: "b-m", petSize: "M", deslanado: false, corte: false, price: 320 },
    { id: "b-m-d", petSize: "M", deslanado: true, corte: false, price: 450 },
    { id: "b-m-dc", petSize: "M", deslanado: true, corte: true, price: 610 },
    { id: "b-m-c", petSize: "M", deslanado: false, corte: true, price: 480 },
    { id: "b-l", petSize: "L", deslanado: false, corte: false, price: 420 },
    { id: "b-l-d", petSize: "L", deslanado: true, corte: false, price: 560 },
    { id: "b-l-dc", petSize: "L", deslanado: true, corte: true, price: 720 },
    { id: "b-l-c", petSize: "L", deslanado: false, corte: true, price: 590 },
    { id: "b-xl", petSize: "XL", deslanado: false, corte: false, price: 520 },
    { id: "b-xl-d", petSize: "XL", deslanado: true, corte: false, price: 680 },
    { id: "b-xl-dc", petSize: "XL", deslanado: true, corte: true, price: 860 },
    { id: "b-xl-c", petSize: "XL", deslanado: false, corte: true, price: 700 },
  ],
  dewormVariants: [
    { id: "d-s", petSize: "S", price: 90 },
    { id: "d-m", petSize: "M", price: 140 },
    { id: "d-l", petSize: "L", price: 190 },
    { id: "d-xl", petSize: "XL", price: 240 },
  ],
  extraHoursVariantId: "eh-anchor",
};

/** Pesos que cubren los cuatro tramos de talla y los dos de tarifa. */
const PESOS = [4, 12, 22, 35];
const NOCHES = [1, 3, 7];

function petAt(weightKg: number): QuotePetInput {
  return { key: `p-${weightKg}`, name: `Perro ${weightKg}kg`, weightKg };
}

/** Talla facturable de baño, tal como la resuelve el handler (sizeFromWeight). */
function tallaDe(weightKg: number): "S" | "M" | "L" | "XL" {
  if (weightKg <= 5) return "S";
  if (weightKg <= 15) return "M";
  if (weightKg <= 24) return "L";
  return "XL";
}

function precioBano(weightKg: number, deslanado: boolean, corte: boolean): number {
  const talla = tallaDe(weightKg);
  const v = CATALOG.bathVariants.find(
    (x) => x.petSize === talla && x.deslanado === deslanado && x.corte === corte
  );
  if (!v) throw new Error(`Falta variante ${talla} d=${deslanado} c=${corte}`);
  return v.price;
}

function total(result: ReturnType<typeof computeQuote>): number {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.breakdown.total;
}

describe("paridad STAY · reservations.ts:894-940", () => {
  for (const noches of NOCHES) {
    for (const peso of PESOS) {
      for (const medicamento of [false, true]) {
        const etiqueta = `${noches} noche(s) · ${peso} kg · ${
          medicamento ? "con" : "sin"
        } medicamento`;

        it(`coincide sin baño — ${etiqueta}`, () => {
          // ORÁCULO — copia literal de reservations.ts:
          //   const lodging = pricePerDayForWeight(p.weight, cfg) * totalDays
          //   const medicationSurcharge = medication ? lodging * 0.1 : 0
          //   amount = lodging + medicationSurcharge + bathPrice
          const lodging = pricePerDayForWeight(peso, CATALOG.lodging) * noches;
          const esperado = lodging + (medicamento ? lodging * 0.1 : 0);

          const obtenido = total(
            computeQuote(
              {
                serviceType: "STAY",
                pets: [{ ...petAt(peso), hasMedication: medicamento }],
                nightsOverride: noches,
              },
              CATALOG
            )
          );
          expect(obtenido).toBeCloseTo(esperado, 2);
        });

        it(`coincide con baño deslanado+corte — ${etiqueta}`, () => {
          const lodging = pricePerDayForWeight(peso, CATALOG.lodging) * noches;
          const esperado =
            lodging + (medicamento ? lodging * 0.1 : 0) + precioBano(peso, true, true);

          const obtenido = total(
            computeQuote(
              {
                serviceType: "STAY",
                pets: [{ ...petAt(peso), hasMedication: medicamento }],
                nightsOverride: noches,
                bath: { deslanado: true, corte: true },
              },
              CATALOG
            )
          );
          expect(obtenido).toBeCloseTo(esperado, 2);
        });
      }
    }
  }

  it("reparte el grupo igual que splitGroupTotal con total manual", () => {
    // El handler reparte `totalAmountOverride` entre las filas y suma el
    // domicilio APARTE, solo a la primera. La cotización cotiza el grupo
    // completo, así que el total debe ser override + domicilio.
    const obtenido = total(
      computeQuote(
        {
          serviceType: "STAY",
          pets: [petAt(12), petAt(35)],
          nightsOverride: 3,
          totalOverride: 2000,
          homeDelivery: { address: "Calle 1", distanceKm: 6, fee: 240 },
        },
        CATALOG
      )
    );
    expect(obtenido).toBe(2240);
  });

  it("cuenta las noches igual que el handler cuando las fechas van a 00:00 UTC", () => {
    // ORÁCULO — reservations.ts:892: Math.ceil(diffMs / 86_400_000).
    // Con ambas fechas ancladas a medianoche UTC (que es como las manda una
    // cotización convertida) las dos fórmulas dan lo mismo. Si la reserva se
    // creara con horas del día distintas, el ceil contaría una noche de más:
    // por eso la conversión DEBE anclar a 00:00 UTC.
    const ci = new Date("2026-09-01T00:00:00.000Z");
    const co = new Date("2026-09-06T00:00:00.000Z");
    const oraculo = Math.ceil((co.getTime() - ci.getTime()) / 86_400_000);

    const r = computeQuote(
      {
        serviceType: "STAY",
        pets: [petAt(12)],
        checkIn: "2026-09-01",
        checkOut: "2026-09-06",
      },
      CATALOG
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.breakdown.totalDays).toBe(oraculo);
  });
});

describe("paridad BATH · reservations.ts:626-651", () => {
  for (const peso of PESOS) {
    for (const [deslanado, corte] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      it(`coincide — ${peso} kg · d=${deslanado} c=${corte}`, () => {
        // ORÁCULO: el handler resuelve la variante por
        // serviceTypeId_petSize_deslanado_corte con petSize = sizeFromWeight(p.weight)
        // y cobra Number(variant.price), sin recargos.
        const esperado = precioBano(peso, deslanado, corte);
        const obtenido = total(
          computeQuote(
            {
              serviceType: "BATH",
              pets: [petAt(peso)],
              date: "2026-09-01",
              bath: { deslanado, corte },
            },
            CATALOG
          )
        );
        expect(obtenido).toBe(esperado);
      });
    }
  }

  it("suma una variante por mascota en el grupo", () => {
    const esperado = PESOS.reduce((acc, p) => acc + precioBano(p, false, false), 0);
    const obtenido = total(
      computeQuote(
        {
          serviceType: "BATH",
          pets: PESOS.map(petAt),
          date: "2026-09-01",
          bath: { deslanado: false, corte: false },
        },
        CATALOG
      )
    );
    expect(obtenido).toBe(esperado);
  });
});

describe("paridad DAYCARE · reservations.ts:776-798", () => {
  for (const [entrada, salida] of [
    ["09:00", "10:00"],
    ["09:00", "13:00"],
    ["08:30", "17:30"],
    ["09:00", "12:15"],
  ] as const) {
    it(`coincide — ${entrada} a ${salida}`, () => {
      // ORÁCULO — reservations.ts:776 y 796:
      //   const hours = computeDaycareHours(inTime, outTime)
      //   amounts = groupPets.map(() => hours * pricingConfig.daycareHourPrice)
      const hours = computeDaycareHours(entrada, salida);
      const esperado = hours * CATALOG.lodging.daycareHourPrice * 2;

      const obtenido = total(
        computeQuote(
          {
            serviceType: "DAYCARE",
            pets: [petAt(12), petAt(35)],
            date: "2026-09-01",
            checkInTime: entrada,
            checkOutTime: salida,
          },
          CATALOG
        )
      );
      expect(obtenido).toBe(esperado);
    });
  }
});

describe("paridad de add-ons · routes/admin.ts", () => {
  it("cobra las horas extra como horas × tarifa, no el ancla de $0", () => {
    // ORÁCULO — admin.ts (alta manual de EXTRA_HOURS):
    //   unitPrice = Number((tarifa * quantity).toFixed(2))
    // La variante del catálogo vale $0 y solo satisface el FK.
    const r = computeQuote(
      { serviceType: "DAYCARE", pets: [petAt(12)], checkInTime: "09:00", checkOutTime: "13:00", extraHours: 3 },
      CATALOG
    );
    if (!r.ok) throw new Error(r.code);
    const linea = r.breakdown.lines.find((l) => l.kind === "EXTRA_HOURS");
    expect(linea?.amount).toBe(Number((CATALOG.lodging.daycareHourPrice * 3).toFixed(2)));
  });

  it("una línea de cotización guarda el precio UNITARIO, el addon guarda el TOTAL", () => {
    // Diferencia de convención que el mapeo a ReservationAddon debe respetar:
    // reservation_addons.unitPrice es el monto total de la línea.
    const r = computeQuote(
      { serviceType: "DAYCARE", pets: [petAt(12)], checkInTime: "09:00", checkOutTime: "13:00", extraHours: 3 },
      CATALOG
    );
    if (!r.ok) throw new Error(r.code);
    const linea = r.breakdown.lines.find((l) => l.kind === "EXTRA_HOURS")!;
    expect(linea.unitPrice).toBe(25); // por hora
    expect(linea.amount).toBe(75); // <- esto es lo que va a addon.unitPrice
  });
});
