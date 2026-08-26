import { describe, expect, it } from "vitest";

import { nightsBetweenYMD } from "./pricing";
import {
  computeQuote,
  formatQuoteFolio,
  type QuoteCatalog,
  type QuoteInput,
} from "./quote";

// Catálogo de prueba con los valores por defecto de LodgingPricing más una
// matriz de variantes recortada. Los precios de baño son inventados pero
// distintos entre sí a propósito: así un test que pase por la variante
// equivocada falla en vez de coincidir por casualidad.
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
    { id: "b-m", petSize: "M", deslanado: false, corte: false, price: 320 },
    { id: "b-m-dc", petSize: "M", deslanado: true, corte: true, price: 610 },
    { id: "b-l", petSize: "L", deslanado: false, corte: false, price: 420 },
    { id: "b-xl", petSize: "XL", deslanado: false, corte: false, price: 520 },
  ],
  dewormVariants: [
    { id: "d-s", petSize: "S", price: 90 },
    { id: "d-m", petSize: "M", price: 140 },
    { id: "d-l", petSize: "L", price: 190 },
    { id: "d-xl", petSize: "XL", price: 240 },
  ],
  extraHoursVariantId: "eh-anchor",
};

const CHICO = { key: "p1", name: "Molly", weightKg: 12 };
const GRANDE = { key: "p2", name: "Bailey", weightKg: 24 };

/** Desenvuelve el resultado feliz o falla el test con el código del error. */
function ok(result: ReturnType<typeof computeQuote>) {
  if (!result.ok) {
    throw new Error(`Se esperaba ok, llegó ${result.code}: ${result.message}`);
  }
  return result.breakdown;
}

function stay(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    serviceType: "STAY",
    pets: [CHICO],
    checkIn: "2026-09-01",
    checkOut: "2026-09-06",
    ...overrides,
  };
}

describe("nightsBetweenYMD", () => {
  it("cuenta días-calendario sin importar la zona horaria del proceso", () => {
    expect(nightsBetweenYMD("2026-09-01", "2026-09-06")).toBe(5);
    expect(nightsBetweenYMD("2026-09-01", "2026-09-02")).toBe(1);
    expect(nightsBetweenYMD("2026-09-01", "2026-09-01")).toBe(0);
  });

  it("cruza fin de mes y año bisiesto", () => {
    expect(nightsBetweenYMD("2026-01-30", "2026-02-02")).toBe(3);
    expect(nightsBetweenYMD("2028-02-27", "2028-03-01")).toBe(3); // 2028 bisiesto
  });

  it("rechaza formatos y fechas inexistentes", () => {
    expect(nightsBetweenYMD("2026-9-1", "2026-09-06")).toBeNaN();
    expect(nightsBetweenYMD("2026-02-31", "2026-03-02")).toBeNaN();
    expect(nightsBetweenYMD("no es fecha", "2026-09-06")).toBeNaN();
  });
});

describe("computeQuote · hospedaje", () => {
  it("cobra tarifa de perro chico × noches", () => {
    const b = ok(computeQuote(stay(), CATALOG));
    expect(b.totalDays).toBe(5);
    expect(b.total).toBe(1750); // 350 × 5
    expect(b.pets[0].lines[0].kind).toBe("LODGING");
    expect(b.pets[0].lines[0].quantity).toBe(5);
    expect(b.pets[0].lines[0].unitPrice).toBe(350);
  });

  it("usa la tarifa grande a partir de largeWeightKg (inclusive)", () => {
    expect(ok(computeQuote(stay({ pets: [GRANDE] }), CATALOG)).total).toBe(2250);
    // Justo en el umbral: 20 kg ya es grande.
    const enElUmbral = { key: "p3", name: "Kira", weightKg: 20 };
    expect(ok(computeQuote(stay({ pets: [enElUmbral] }), CATALOG)).total).toBe(2250);
    const bajoElUmbral = { key: "p4", name: "Nube", weightKg: 19.9 };
    expect(ok(computeQuote(stay({ pets: [bajoElUmbral] }), CATALOG)).total).toBe(1750);
  });

  it("suma una estancia por perro en multi-perro", () => {
    const b = ok(computeQuote(stay({ pets: [CHICO, GRANDE] }), CATALOG));
    expect(b.pets).toHaveLength(2);
    expect(b.pets[0].subtotal).toBe(1750);
    expect(b.pets[1].subtotal).toBe(2250);
    expect(b.total).toBe(4000);
  });

  it("aplica el recargo de medicamento solo al perro que lo lleva", () => {
    const b = ok(
      computeQuote(
        stay({ pets: [{ ...CHICO, hasMedication: true }, GRANDE] }),
        CATALOG
      )
    );
    // 1750 + 10% = 1925 para el primero; el segundo intacto.
    expect(b.pets[0].subtotal).toBe(1925);
    expect(b.pets[1].subtotal).toBe(2250);
    expect(b.pets[0].lines[1].kind).toBe("MEDICATION_SURCHARGE");
    expect(b.pets[0].lines[1].amount).toBe(175);
  });

  it("cambia la tarifa por noche con dieta ProBarf", () => {
    expect(ok(computeQuote(stay({ probarf: true }), CATALOG)).total).toBe(1500);
    expect(
      ok(computeQuote(stay({ pets: [GRANDE], probarf: true }), CATALOG)).total
    ).toBe(2000);
  });

  it("acepta noches pactadas a mano cuando no hay fechas cerradas", () => {
    const b = ok(
      computeQuote(
        stay({ checkIn: null, checkOut: null, nightsOverride: 3 }),
        CATALOG
      )
    );
    expect(b.totalDays).toBe(3);
    expect(b.total).toBe(1050);
  });

  it("exige fechas o noches", () => {
    const r = computeQuote(stay({ checkIn: null, checkOut: null }), CATALOG);
    expect(r).toMatchObject({ ok: false, code: "MISSING_DATES" });
  });

  it("rechaza una salida que no es posterior a la entrada", () => {
    const r = computeQuote(stay({ checkOut: "2026-09-01" }), CATALOG);
    expect(r).toMatchObject({ ok: false, code: "INVALID_RANGE" });
  });
});

describe("computeQuote · baño", () => {
  it("resuelve la variante exacta por talla, deslanado y corte", () => {
    const b = ok(
      computeQuote(
        {
          serviceType: "BATH",
          pets: [CHICO], // 12 kg → M
          date: "2026-09-01",
          bath: { deslanado: true, corte: true },
        },
        CATALOG
      )
    );
    expect(b.total).toBe(610);
    expect(b.pets[0].lines[0].serviceVariantId).toBe("b-m-dc");
    expect(b.pets[0].lines[0].label).toBe("Baño con deslanado y corte");
  });

  it("cotiza cada perro con SU talla dentro del grupo", () => {
    const b = ok(
      computeQuote(
        {
          serviceType: "BATH",
          pets: [CHICO, GRANDE], // 12 kg → M · 24 kg → L
          date: "2026-09-01",
          bath: { deslanado: false, corte: false },
        },
        CATALOG
      )
    );
    expect(b.pets[0].subtotal).toBe(320);
    expect(b.pets[1].subtotal).toBe(420);
    expect(b.total).toBe(740);
  });

  it("colapsa XS a S, que es como está catalogado el servicio", () => {
    const b = ok(
      computeQuote(
        {
          serviceType: "BATH",
          pets: [{ key: "p", name: "Chispa", weightKg: 3, size: "XS" }],
          bath: { deslanado: false, corte: false },
        },
        CATALOG
      )
    );
    expect(b.pets[0].lines[0].serviceVariantId).toBe("b-s");
    expect(b.total).toBe(250);
  });

  it("el PESO manda sobre la talla guardada: es lo que usará la reserva", () => {
    // 28 kg con `pets.size = "M"` capturado a mano. POST /reservations resuelve
    // la variante con sizeFromWeight(peso) y punto, así que cotizar por la talla
    // guardada prometería $320 y después se cobrarían $520. El precio cotizado
    // tiene que ser el que se cobra.
    const b = ok(
      computeQuote(
        {
          serviceType: "BATH",
          pets: [{ key: "p", name: "Rocco", weightKg: 28, size: "M" }],
          bath: { deslanado: false, corte: false },
        },
        CATALOG
      )
    );
    expect(b.pets[0].lines[0].serviceVariantId).toBe("b-xl");
    expect(b.total).toBe(520);
  });

  it("sin peso sí usa la talla guardada: es lo único que hay", () => {
    // El caso del prospecto: "¿es chico o mediano?" sin subirlo a la báscula.
    const b = ok(
      computeQuote(
        {
          serviceType: "BATH",
          pets: [{ key: "p", name: "Nube", weightKg: null, size: "L" }],
          bath: { deslanado: false, corte: false },
        },
        CATALOG
      )
    );
    expect(b.pets[0].lines[0].serviceVariantId).toBe("b-l");
  });

  it("falla claro cuando falta la variante en el catálogo", () => {
    const r = computeQuote(
      {
        serviceType: "BATH",
        pets: [GRANDE], // XL con corte no existe en el catálogo de prueba
        bath: { deslanado: false, corte: true },
      },
      CATALOG
    );
    expect(r).toMatchObject({ ok: false, code: "BATH_VARIANT_MISSING", petKey: "p2" });
  });

  it("suma el baño como complemento de un hospedaje", () => {
    const b = ok(computeQuote(stay({ bath: { deslanado: false, corte: false } }), CATALOG));
    expect(b.pets[0].lines.map((l) => l.kind)).toEqual(["LODGING", "BATH"]);
    expect(b.total).toBe(1750 + 320);
  });
});

describe("computeQuote · guardería", () => {
  it("cobra horas redondeadas hacia arriba × tarifa, por perro", () => {
    const b = ok(
      computeQuote(
        {
          serviceType: "DAYCARE",
          pets: [CHICO, GRANDE],
          date: "2026-09-01",
          checkInTime: "09:00",
          checkOutTime: "17:00",
        },
        CATALOG
      )
    );
    expect(b.daycareHours).toBe(8);
    expect(b.total).toBe(400); // 8 × 25 × 2 perros
  });

  it("redondea la fracción de hora hacia arriba", () => {
    const b = ok(
      computeQuote(
        {
          serviceType: "DAYCARE",
          pets: [CHICO],
          checkInTime: "09:00",
          checkOutTime: "12:15",
        },
        CATALOG
      )
    );
    expect(b.daycareHours).toBe(4); // 3h15 → 4
    expect(b.total).toBe(100);
  });

  it("exige las dos horas", () => {
    const r = computeQuote(
      { serviceType: "DAYCARE", pets: [CHICO], checkInTime: "09:00" },
      CATALOG
    );
    expect(r).toMatchObject({ ok: false, code: "MISSING_DAYCARE_TIMES" });
  });

  it("rechaza una salida que no es posterior a la entrada", () => {
    const r = computeQuote(
      {
        serviceType: "DAYCARE",
        pets: [CHICO],
        checkInTime: "14:00",
        checkOutTime: "09:00",
      },
      CATALOG
    );
    expect(r).toMatchObject({ ok: false, code: "INVALID_DAYCARE_RANGE" });
  });
});

describe("computeQuote · desparasitante", () => {
  it("usa su escala de peso PROPIA, distinta de la del baño", () => {
    // 28 kg: XL para el baño (>24) pero L para el desparasitante (15.1–30).
    // Los tramos NO coinciden; unificarlos cobraría de más.
    const pesado = { key: "p", name: "Rocco", weightKg: 28 };
    const b = ok(
      computeQuote(
        stay({
          pets: [pesado],
          deworming: true,
          bath: { deslanado: false, corte: false },
        }),
        CATALOG
      )
    );
    expect(b.pets[0].lines.find((l) => l.kind === "BATH")?.serviceVariantId).toBe("b-xl");
    expect(b.pets[0].lines.find((l) => l.kind === "DEWORMING")?.serviceVariantId).toBe("d-l");
    expect(b.total).toBe(2250 + 520 + 190);
  });

  it("no cotiza fuera del rango cubierto (3.6–60 kg)", () => {
    const chiquito = { key: "p", name: "Pulga", weightKg: 3 };
    const r = computeQuote(stay({ pets: [chiquito], deworming: true }), CATALOG);
    expect(r).toMatchObject({ ok: false, code: "DEWORM_OUT_OF_RANGE" });

    const sinPeso = { key: "p", name: "Anónimo", weightKg: null };
    expect(computeQuote(stay({ pets: [sinPeso], deworming: true }), CATALOG)).toMatchObject(
      { ok: false, code: "DEWORM_OUT_OF_RANGE" }
    );
  });
});

describe("computeQuote · horas extra", () => {
  it("cobra horas × la tarifa única, no el ancla de $0 del catálogo", () => {
    const b = ok(computeQuote(stay({ extraHours: 3 }), CATALOG));
    const linea = b.pets[0].lines.find((l) => l.kind === "EXTRA_HOURS");
    expect(linea?.amount).toBe(75); // 3 × 25, NO 0
    expect(linea?.serviceVariantId).toBe("eh-anchor");
  });

  it("no deja cotizarlas si falta el ancla o la tarifa", () => {
    expect(
      computeQuote(stay({ extraHours: 2 }), { ...CATALOG, extraHoursVariantId: null })
    ).toMatchObject({ ok: false, code: "EXTRA_HOURS_NOT_CONFIGURED" });

    expect(
      computeQuote(stay({ extraHours: 2 }), {
        ...CATALOG,
        lodging: { ...CATALOG.lodging, daycareHourPrice: 0 },
      })
    ).toMatchObject({ ok: false, code: "EXTRA_HOURS_NOT_CONFIGURED" });
  });

  it("rechaza cantidades fuera de 1–24", () => {
    expect(computeQuote(stay({ extraHours: 25 }), CATALOG)).toMatchObject({
      ok: false,
      code: "INVALID_EXTRA_HOURS",
    });
  });
});

describe("computeQuote · descuento y domicilio", () => {
  it("aplica el descuento al subtotal y NO al domicilio", () => {
    const b = ok(
      computeQuote(
        stay({
          discount: { code: "PROMO", amount: 200 },
          homeDelivery: { address: "Calle 1", distanceKm: 5, fee: 180 },
        }),
        CATALOG
      )
    );
    expect(b.subtotal).toBe(1750);
    expect(b.discountTotal).toBe(200);
    expect(b.deliveryFee).toBe(180);
    expect(b.total).toBe(1730); // 1750 − 200 + 180
  });

  it("acota el descuento al subtotal para que el total nunca sea negativo", () => {
    const b = ok(
      computeQuote(stay({ discount: { code: "REGALO", amount: 99999 } }), CATALOG)
    );
    expect(b.discountTotal).toBe(1750);
    expect(b.total).toBe(0);
  });

  it("el domicilio de cortesía no cobra pero conserva su precio de lista", () => {
    const b = ok(
      computeQuote(
        stay({
          homeDelivery: { address: "Calle 1", distanceKm: 5, fee: 180 },
          courtesy: ["HOME_DELIVERY"],
        }),
        CATALOG
      )
    );
    expect(b.deliveryFee).toBe(0);
    expect(b.total).toBe(1750);
    const linea = b.lines.find((l) => l.kind === "HOME_DELIVERY");
    expect(linea?.isCourtesy).toBe(true);
    expect(linea?.amount).toBe(0);
    expect(linea?.listPrice).toBe(180); // el cliente ve lo que se le regaló
  });
});

describe("computeQuote · cortesías y total manual", () => {
  it("una cortesía aporta 0 pero se sigue imprimiendo con su precio", () => {
    const b = ok(
      computeQuote(
        {
          serviceType: "BATH",
          pets: [CHICO],
          bath: { deslanado: false, corte: false },
          courtesy: ["BATH"],
        },
        CATALOG
      )
    );
    expect(b.total).toBe(0);
    expect(b.pets[0].lines[0].isCourtesy).toBe(true);
    expect(b.pets[0].lines[0].amount).toBe(0);
    expect(b.pets[0].lines[0].listPrice).toBe(320);
  });

  it("el total manual reemplaza la suma y el domicilio se suma aparte", () => {
    const b = ok(
      computeQuote(
        stay({
          totalOverride: 1500,
          homeDelivery: { address: "Calle 1", distanceKm: 5, fee: 180 },
        }),
        CATALOG
      )
    );
    expect(b.totalIsManual).toBe(true);
    expect(b.subtotal).toBe(1750); // el desglose se conserva como referencia
    expect(b.total).toBe(1680); // 1500 pactado + 180 de domicilio
  });
});

describe("computeQuote · conceptos libres y avisos", () => {
  it("suma los conceptos capturados a mano", () => {
    const b = ok(
      computeQuote(
        stay({
          customItems: [
            { label: "Transporte al veterinario", quantity: 2, unitPrice: 150 },
          ],
        }),
        CATALOG
      )
    );
    expect(b.total).toBe(2050); // 1750 + 300
  });

  it("avisa (sin bloquear) cuando el perro no tiene peso", () => {
    const b = ok(
      computeQuote(stay({ pets: [{ key: "p", name: "Anónimo", weightKg: null }] }), CATALOG)
    );
    expect(b.warnings[0]).toContain("sin peso");
    expect(b.total).toBe(1750); // cotizado como chico
  });

  it("exige al menos una mascota", () => {
    expect(computeQuote(stay({ pets: [] }), CATALOG)).toMatchObject({
      ok: false,
      code: "NO_PETS",
    });
  });
});

describe("formatQuoteFolio", () => {
  it("rellena a seis dígitos", () => {
    expect(formatQuoteFolio(1)).toBe("COT-000001");
    expect(formatQuoteFolio(123)).toBe("COT-000123");
    expect(formatQuoteFolio(1234567)).toBe("COT-1234567");
  });
});

describe("computeQuote · configuración faltante", () => {
  it("se niega a cotizar guardería con la tarifa por hora en 0", () => {
    // `daycareExtraHourPrice` tiene DEFAULT 0 en la base. Sin esta guarda, una
    // guardería se cotizaría en $0 y ESE documento es el que se le manda al
    // cliente por WhatsApp.
    const r = computeQuote(
      {
        serviceType: "DAYCARE",
        pets: [CHICO],
        checkInTime: "09:00",
        checkOutTime: "17:00",
      },
      { ...CATALOG, lodging: { ...CATALOG.lodging, daycareHourPrice: 0 } }
    );
    expect(r).toMatchObject({ ok: false, code: "DAYCARE_NOT_CONFIGURED" });
  });
});

describe("computeQuote · el documento tiene que cuadrar", () => {
  it("un precio pactado ANULA el descuento en vez de imprimir los dos", () => {
    // Sin esto el documento decía "Subtotal $1,750 / Descuento −$200 / Total
    // $1,500": el cliente resta, le da $1,550 y llega al mostrador con esa cifra.
    const b = ok(
      computeQuote(
        stay({
          discount: { code: "VERANO20", amount: 200 },
          totalOverride: 1500,
        }),
        CATALOG
      )
    );
    expect(b.discountTotal).toBe(0);
    expect(b.lines.some((l) => l.kind === "DISCOUNT")).toBe(false);
    expect(b.total).toBe(1500);
  });

  it("las líneas impresas suman exactamente el total cuando no hay precio pactado", () => {
    const b = ok(
      computeQuote(
        stay({
          pets: [CHICO, GRANDE],
          bath: { deslanado: false, corte: false },
          discount: { code: "PROMO", amount: 300 },
          homeDelivery: { address: "Calle 1", distanceKm: 5, fee: 180 },
        }),
        CATALOG
      )
    );
    const suma = b.lines.reduce((acc, l) => acc + l.amount, 0);
    expect(Math.round(suma * 100) / 100).toBe(b.total);
  });
});
