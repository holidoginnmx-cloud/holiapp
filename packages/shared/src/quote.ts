// ============================================================
// Cotizaciones — cálculo del desglose. FUENTE ÚNICA compartida por la API,
// la app móvil (preview en vivo) y, vía la API, el admin web.
//
// Como `pricing.ts`, este módulo NO importa zod ni Prisma a propósito: es puro
// y determinista (mismas entradas ⇒ mismas salidas, sin I/O y sin Date.now()).
// Todo lo que necesita de la base — tarifas y variantes de servicio — llega en
// `catalog`, que arma el llamador.
//
// Las reglas de precio son las MISMAS de POST /reservations
// (packages/api/src/routes/reservations.ts). Ahí viven inline, mezcladas con
// validaciones de cuarto y de agenda; replicarlas aquí en vez de refactorizar
// esa ruta es deliberado (es por donde pasa el dinero de todos los flujos y no
// tiene tests de integración). La red de seguridad son los tests de paridad en
// packages/api/src/lib/quotePricing.test.ts: si alguien cambia una fórmula y no
// la otra, truenan.
// ============================================================

import {
  bathSizeKey,
  computeDaycareHours,
  dewormSizeFromWeight,
  nightsBetweenYMD,
  pricePerDayForWeight,
  sizeFromWeight,
  type LodgingPricingConfig,
  type SizeKey,
} from "./pricing";

/** Talla de catálogo. XS existe en `pets` pero colapsa a S al cobrar. */
export type PetSizeKey = "XS" | SizeKey;

export type QuoteServiceType = "STAY" | "BATH" | "DAYCARE";

/**
 * Tipo de concepto de una línea. Espeja los cobros que ya sabe generar la API
 * para que la conversión a reserva sea un mapeo 1:1 y no una reinterpretación.
 */
export type QuoteItemKind =
  | "LODGING"
  | "DAYCARE"
  | "BATH"
  | "DEWORMING"
  | "EXTRA_HOURS"
  | "MEDICATION_SURCHARGE"
  | "HOME_DELIVERY"
  | "DISCOUNT"
  | "CUSTOM";

// ─── Entrada ─────────────────────────────────────────────────

/** Perro a cotizar. `key` identifica sus líneas: id de Pet o clave temporal. */
export interface QuotePetInput {
  key: string;
  name: string;
  weightKg: number | null;
  /**
   * Talla guardada del perro. En BAÑO manda sobre el peso: el catálogo de
   * variantes se indexa por talla y un perro puede estar catalogado distinto de
   * lo que dicta su peso. Si falta, se deriva del peso.
   */
  size?: PetSizeKey | null;
  /** Recargo de medicamento: +medicationSurchargePct sobre SU hospedaje. */
  hasMedication?: boolean;
}

export interface QuoteInput {
  serviceType: QuoteServiceType;
  pets: QuotePetInput[];

  // ⚠️ Fechas como "YYYY-MM-DD", NUNCA Date. Recibir Date aquí es la vía por la
  // que un picker local a las 19:00 en Hermosillo (UTC-7) se corre un día al
  // serializarse y la cotización cobra una noche de más.
  /** STAY: primer día. */
  checkIn?: string | null;
  /** STAY: día de salida (no se cobra). */
  checkOut?: string | null;
  /** BATH/DAYCARE: día del servicio. Informativo para el precio. */
  date?: string | null;

  /** "HH:mm" hora local del hotel. En DAYCARE definen el precio. */
  checkInTime?: string | null;
  checkOutTime?: string | null;

  /**
   * Noches pactadas a mano, cuando el cliente todavía no tiene fechas cerradas
   * ("como cinco días en diciembre"). Si viene, manda sobre checkIn/checkOut.
   */
  nightsOverride?: number | null;

  /** Baño: en STAY es complemento de la estancia; en BATH es el servicio. */
  bath?: { deslanado: boolean; corte: boolean } | null;
  deworming?: boolean;
  /** Dieta ProBarf: cambia la tarifa por noche (solo STAY). */
  probarf?: boolean;
  /** Horas extra contratadas por adelantado. */
  extraHours?: number | null;

  /** Ya cotizado por POST /delivery/quote — este módulo NO calcula distancias. */
  homeDelivery?: { address: string; distanceKm: number; fee: number } | null;
  /** Ya resuelto por resolveDiscount() — este módulo NO valida códigos. */
  discount?: { code: string; amount: number } | null;

  /** Conceptos REGALADOS: se imprimen con su precio pero no suman al total. */
  courtesy?: QuoteItemKind[];
  customItems?: QuoteCustomItemInput[];

  /**
   * Precio pactado del GRUPO. Reemplaza el total calculado; el desglose se
   * conserva como referencia (`totalIsManual` lo marca). El domicilio SIEMPRE
   * se suma aparte, igual que `totalAmountOverride` en POST /reservations.
   */
  totalOverride?: number | null;
}

export interface QuoteCustomItemInput {
  label: string;
  detail?: string | null;
  quantity: number;
  unitPrice: number;
}

/** Catálogo leído de la base por el llamador. El módulo no consulta nada. */
export interface QuoteCatalog {
  lodging: LodgingPricingConfig & {
    priceProbarfSmall: number;
    priceProbarfLarge: number;
  };
  bathVariants: {
    id: string;
    petSize: PetSizeKey;
    deslanado: boolean;
    corte: boolean;
    price: number;
  }[];
  dewormVariants: { id: string; petSize: PetSizeKey; price: number }[];
  /**
   * Ancla del catálogo para horas extra. La variante vale $0 a propósito: solo
   * satisface el FK del add-on, el precio real es horas × daycareHourPrice
   * (ver el comentario en routes/admin.ts, alta manual de EXTRA_HOURS).
   */
  extraHoursVariantId: string | null;
}

// ─── Salida ──────────────────────────────────────────────────

export interface QuoteLine {
  kind: QuoteItemKind;
  /** null = línea del GRUPO (domicilio, descuento, concepto libre). */
  petKey: string | null;
  label: string;
  detail?: string;
  quantity: number;
  /**
   * Precio POR UNIDAD. ⚠️ Distinto de `reservation_addons.unitPrice`, que
   * guarda el monto TOTAL de la línea. Quien mapee QuoteItem → ReservationAddon
   * debe escribir `unitPrice: line.amount`, no `line.unitPrice`.
   */
  unitPrice: number;
  /** Total de la línea. Negativo solo en DISCOUNT. 0 si es cortesía. */
  amount: number;
  /**
   * Servicio regalado. Mismo criterio que `ReservationAddon.isCourtesy`: la
   * línea se IMPRIME con su precio de catálogo (el cliente debe ver el valor de
   * lo que se le regaló) pero aporta 0 al total. Un `amount` de 0 no distingue
   * "regalado" de "mal capturado", por eso es una bandera.
   */
  isCourtesy: boolean;
  /** Precio de catálogo, para tacharlo en el PDF cuando es cortesía. */
  listPrice: number;
  serviceVariantId?: string | null;
}

export interface QuotePetBreakdown {
  key: string;
  name: string;
  weightKg: number | null;
  size: PetSizeKey | null;
  /** Suma de SUS líneas. El domicilio y el descuento son del grupo. */
  subtotal: number;
  lines: QuoteLine[];
}

export interface QuoteBreakdown {
  serviceType: QuoteServiceType;
  totalDays: number | null;
  daycareHours: number | null;
  pets: QuotePetBreakdown[];
  /** Todas las líneas en orden de presentación (por perro y luego de grupo). */
  lines: QuoteLine[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  /** true si `totalOverride` reemplazó la suma (el desglose es informativo). */
  totalIsManual: boolean;
  /** Avisos no bloqueantes ("sin peso, se cotizó como perro chico"). */
  warnings: string[];
}

export type QuoteErrorCode =
  | "NO_PETS"
  | "MISSING_DATES"
  | "INVALID_RANGE"
  | "MISSING_DAYCARE_TIMES"
  | "INVALID_DAYCARE_RANGE"
  | "DAYCARE_NOT_CONFIGURED"
  | "BATH_VARIANT_MISSING"
  | "DEWORM_OUT_OF_RANGE"
  | "DEWORM_VARIANT_MISSING"
  | "EXTRA_HOURS_NOT_CONFIGURED"
  | "INVALID_EXTRA_HOURS";

export type ComputeQuoteResult =
  | { ok: true; breakdown: QuoteBreakdown }
  | { ok: false; code: QuoteErrorCode; message: string; petKey?: string };

// ─── Helpers ─────────────────────────────────────────────────

/** Redondeo a centavos. Todo monto que sale de este módulo pasa por aquí. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Formato de moneda para las etiquetas del desglose ("$450"). */
function money(n: number): string {
  return `$${n.toLocaleString("es-MX", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Talla FACTURABLE de un perro. Sale del PESO, no de `pets.size`.
 *
 * Es tentador respetar la talla guardada (alguien la capturó a mano), pero
 * POST /reservations resuelve la variante de baño con `sizeFromWeight(peso)` y
 * punto. Cotizar por `pets.size` produce un precio que después no se cobra: un
 * perro de 18 kg registrado como M se cotiza en $350 y se le cobra $450.
 * Mientras la reserva mande el peso, la cotización tiene que mandar el peso.
 *
 * La talla guardada solo entra cuando NO hay peso — que es justo el caso de un
 * prospecto al que le preguntaron "¿es chico o mediano?" sin subirlo a la
 * báscula.
 */
function resolveSize(pet: QuotePetInput): PetSizeKey {
  if (pet.weightKg != null) return sizeFromWeight(pet.weightKg);
  return pet.size ?? sizeFromWeight(null);
}

// ─── Cálculo ─────────────────────────────────────────────────

/**
 * Calcula el desglose completo de una cotización para los tres servicios.
 * El servidor es la autoridad: la app móvil corre esto solo para el preview en
 * vivo, y lo que se guarda es siempre lo que devolvió la API.
 */
export function computeQuote(
  input: QuoteInput,
  catalog: QuoteCatalog
): ComputeQuoteResult {
  if (!input.pets || input.pets.length === 0) {
    return { ok: false, code: "NO_PETS", message: "Agrega al menos una mascota" };
  }

  const warnings: string[] = [];
  const courtesy = new Set<QuoteItemKind>(input.courtesy ?? []);
  const cfg = catalog.lodging;

  // ── Unidades facturables, comunes a todos los perros ──────────────────────
  let totalDays: number | null = null;
  let daycareHours: number | null = null;

  if (input.serviceType === "STAY") {
    if (input.nightsOverride != null) {
      if (!Number.isFinite(input.nightsOverride) || input.nightsOverride < 1) {
        return {
          ok: false,
          code: "INVALID_RANGE",
          message: "Las noches deben ser al menos 1",
        };
      }
      totalDays = Math.floor(input.nightsOverride);
    } else {
      if (!input.checkIn || !input.checkOut) {
        return {
          ok: false,
          code: "MISSING_DATES",
          message: "Indica las fechas de entrada y salida, o cuántas noches",
        };
      }
      const nights = nightsBetweenYMD(input.checkIn, input.checkOut);
      if (Number.isNaN(nights)) {
        return { ok: false, code: "MISSING_DATES", message: "Fechas inválidas" };
      }
      if (nights < 1) {
        return {
          ok: false,
          code: "INVALID_RANGE",
          message: "La salida debe ser posterior a la entrada",
        };
      }
      totalDays = nights;
    }
  }

  if (input.serviceType === "DAYCARE") {
    if (!input.checkInTime || !input.checkOutTime) {
      return {
        ok: false,
        code: "MISSING_DAYCARE_TIMES",
        message: "Indica la hora de entrada y de salida",
      };
    }
    const hours = computeDaycareHours(input.checkInTime, input.checkOutTime);
    if (hours <= 0) {
      return {
        ok: false,
        code: "INVALID_DAYCARE_RANGE",
        message: "La hora de salida debe ser posterior a la de entrada",
      };
    }
    // La columna daycareExtraHourPrice tiene DEFAULT 0 en la base: hasta que
    // alguien la configura en Config → Tarifas, una guardería se cotizaría en
    // $0. Prometerle al cliente por escrito una guardería gratis es mucho peor
    // que negarse a cotizar, así que se niega. Misma regla que EXTRA_HOURS.
    if (cfg.daycareHourPrice <= 0) {
      return {
        ok: false,
        code: "DAYCARE_NOT_CONFIGURED",
        message: "Configura la tarifa por hora de guardería en Config → Tarifas",
      };
    }
    daycareHours = hours;
  }

  if (input.extraHours != null && input.extraHours !== 0) {
    if (!Number.isFinite(input.extraHours) || input.extraHours < 1 || input.extraHours > 24) {
      return {
        ok: false,
        code: "INVALID_EXTRA_HOURS",
        message: "Las horas extra deben ir de 1 a 24",
      };
    }
    if (!catalog.extraHoursVariantId) {
      return {
        ok: false,
        code: "EXTRA_HOURS_NOT_CONFIGURED",
        message: "Configura la tarifa de hora extra en Config → Tarifas",
      };
    }
    if (cfg.daycareHourPrice <= 0) {
      return {
        ok: false,
        code: "EXTRA_HOURS_NOT_CONFIGURED",
        message: "Configura la tarifa de hora extra en Config → Tarifas",
      };
    }
  }

  // ── Líneas por perro ──────────────────────────────────────────────────────
  const pets: QuotePetBreakdown[] = [];

  for (const pet of input.pets) {
    const size = resolveSize(pet);
    const lines: QuoteLine[] = [];

    if (pet.weightKg == null && !pet.size) {
      warnings.push(`${pet.name}: sin peso registrado, se cotizó como perro chico`);
    }

    // Hospedaje ────────────────────────────────────────────────────────────
    if (input.serviceType === "STAY" && totalDays != null) {
      const isLarge = (pet.weightKg ?? 0) >= cfg.largeWeightKg;
      const pricePerDay = input.probarf
        ? isLarge
          ? cfg.priceProbarfLarge
          : cfg.priceProbarfSmall
        : pricePerDayForWeight(pet.weightKg, cfg);

      const lodging = round2(pricePerDay * totalDays);
      lines.push(
        line({
          kind: "LODGING",
          petKey: pet.key,
          label: `Hospedaje · ${plural(totalDays, "noche", "noches")}`,
          detail: `${isLarge ? "Perro grande" : "Perro chico"}${
            pet.weightKg != null ? ` (${pet.weightKg} kg)` : ""
          } · ${money(pricePerDay)} por noche${input.probarf ? " · dieta ProBarf" : ""}`,
          quantity: totalDays,
          unitPrice: pricePerDay,
          listPrice: lodging,
          courtesy,
        })
      );

      // Recargo por medicamento: porcentaje sobre el hospedaje de ESTE perro.
      // La ruta de reservas lo escribe con `.toFixed(2)`; aquí el round2 hace
      // lo mismo. Es por-perro, no por cotización.
      if (pet.hasMedication && cfg.medicationSurchargePct > 0) {
        const fee = round2(lodging * cfg.medicationSurchargePct);
        lines.push(
          line({
            kind: "MEDICATION_SURCHARGE",
            petKey: pet.key,
            label: "Administración de medicamento",
            detail: `${Math.round(cfg.medicationSurchargePct * 100)}% sobre el hospedaje`,
            quantity: 1,
            unitPrice: fee,
            listPrice: fee,
            courtesy,
          })
        );
      }
    }

    // Guardería ────────────────────────────────────────────────────────────
    if (input.serviceType === "DAYCARE" && daycareHours != null) {
      const amount = round2(daycareHours * cfg.daycareHourPrice);
      lines.push(
        line({
          kind: "DAYCARE",
          petKey: pet.key,
          label: `Guardería · ${plural(daycareHours, "hora", "horas")}`,
          detail: `${input.checkInTime} a ${input.checkOutTime} · ${money(
            cfg.daycareHourPrice
          )} por hora`,
          quantity: daycareHours,
          unitPrice: cfg.daycareHourPrice,
          listPrice: amount,
          courtesy,
        })
      );
    }

    // Baño / estética ──────────────────────────────────────────────────────
    // En BATH es el servicio; en STAY es un complemento opcional. En DAYCARE
    // también se permite: la guardería con baño de salida es una venta común.
    if (input.bath || input.serviceType === "BATH") {
      const deslanado = input.bath?.deslanado ?? false;
      const corte = input.bath?.corte ?? false;
      const variant = findBathVariant(catalog, size, deslanado, corte);
      if (!variant) {
        return {
          ok: false,
          code: "BATH_VARIANT_MISSING",
          message: `No hay tarifa de baño configurada para ${pet.name} (talla ${bathSizeKey(size)})`,
          petKey: pet.key,
        };
      }
      const extras = [deslanado && "deslanado", corte && "corte"].filter(Boolean);
      lines.push(
        line({
          kind: "BATH",
          petKey: pet.key,
          label: extras.length > 0 ? `Baño con ${extras.join(" y ")}` : "Baño",
          detail: `Talla ${bathSizeKey(size)}`,
          quantity: 1,
          unitPrice: variant.price,
          listPrice: variant.price,
          courtesy,
          serviceVariantId: variant.id,
        })
      );
    }

    // Desparasitante ───────────────────────────────────────────────────────
    // Escala de peso PROPIA (dewormSizeFromWeight): sus tramos no coinciden con
    // los del baño. Fuera de 3.6–60 kg no hay tarifa y no se puede cotizar.
    if (input.deworming) {
      const dewormSize = dewormSizeFromWeight(pet.weightKg);
      if (!dewormSize) {
        return {
          ok: false,
          code: "DEWORM_OUT_OF_RANGE",
          message: `El peso de ${pet.name} no está en el rango del desparasitante (3.6 a 60 kg)`,
          petKey: pet.key,
        };
      }
      const variant = catalog.dewormVariants.find((v) => v.petSize === dewormSize);
      if (!variant) {
        return {
          ok: false,
          code: "DEWORM_VARIANT_MISSING",
          message: `No hay tarifa de desparasitante para la talla ${dewormSize}`,
          petKey: pet.key,
        };
      }
      lines.push(
        line({
          kind: "DEWORMING",
          petKey: pet.key,
          label: "Desparasitante",
          detail: `Talla ${dewormSize}${pet.weightKg != null ? ` (${pet.weightKg} kg)` : ""}`,
          quantity: 1,
          unitPrice: variant.price,
          listPrice: variant.price,
          courtesy,
          serviceVariantId: variant.id,
        })
      );
    }

    // Horas extra ──────────────────────────────────────────────────────────
    if (input.extraHours != null && input.extraHours > 0) {
      const hours = Math.floor(input.extraHours);
      const amount = round2(hours * cfg.daycareHourPrice);
      lines.push(
        line({
          kind: "EXTRA_HOURS",
          petKey: pet.key,
          label: `Horas extra · ${plural(hours, "hora", "horas")}`,
          detail: `${money(cfg.daycareHourPrice)} por hora`,
          quantity: hours,
          unitPrice: cfg.daycareHourPrice,
          listPrice: amount,
          courtesy,
          serviceVariantId: catalog.extraHoursVariantId,
        })
      );
    }

    pets.push({
      key: pet.key,
      name: pet.name,
      weightKg: pet.weightKg,
      size,
      subtotal: round2(lines.reduce((acc, l) => acc + l.amount, 0)),
      lines,
    });
  }

  // ── Líneas del grupo ──────────────────────────────────────────────────────
  const groupLines: QuoteLine[] = [];

  for (const item of input.customItems ?? []) {
    const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    groupLines.push(
      line({
        kind: "CUSTOM",
        petKey: null,
        label: item.label,
        detail: item.detail ?? undefined,
        quantity,
        unitPrice: item.unitPrice,
        listPrice: round2(quantity * item.unitPrice),
        courtesy,
      })
    );
  }

  // Subtotal = servicios cotizados, ANTES de descuento y domicilio. Es la base
  // sobre la que se aplica el descuento, igual que en resolveDiscount.
  const petsSubtotal = pets.reduce((acc, p) => acc + p.subtotal, 0);
  const customSubtotal = groupLines.reduce((acc, l) => acc + l.amount, 0);
  const subtotal = round2(petsSubtotal + customSubtotal);

  // Descuento: acotado al subtotal (nunca deja el total en negativo) y NUNCA
  // aplicado al domicilio — misma regla que resolveDiscount en la API.
  //
  // Con un precio pactado a mano el descuento NO se aplica ni se imprime: el
  // total pactado ya ES el precio final. Mostrar "Subtotal $1,050 / Descuento
  // −$210 / Total $900" hace que el cliente reste y llegue al mostrador
  // pidiendo $840.
  let discountTotal = 0;
  if (input.discount && input.discount.amount > 0 && input.totalOverride == null) {
    discountTotal = round2(Math.min(input.discount.amount, subtotal));
    groupLines.push(
      line({
        kind: "DISCOUNT",
        petKey: null,
        label: `Descuento ${input.discount.code}`,
        quantity: 1,
        unitPrice: -discountTotal,
        listPrice: -discountTotal,
        courtesy,
        // El descuento nunca es "cortesía": ya viene restado del total.
        forceCourtesy: false,
      })
    );
  }

  // Domicilio: se suma DESPUÉS del descuento y siempre aparte del override de
  // total, igual que `deliveryFee` en POST /reservations.
  let deliveryFee = 0;
  if (input.homeDelivery && input.homeDelivery.fee > 0) {
    const isCourtesy = courtesy.has("HOME_DELIVERY");
    deliveryFee = isCourtesy ? 0 : round2(input.homeDelivery.fee);
    groupLines.push(
      line({
        kind: "HOME_DELIVERY",
        petKey: null,
        label: "Servicio a domicilio",
        detail: `${input.homeDelivery.address} · ${input.homeDelivery.distanceKm} km`,
        quantity: 1,
        unitPrice: input.homeDelivery.fee,
        listPrice: round2(input.homeDelivery.fee),
        courtesy,
      })
    );
  }

  const totalIsManual = input.totalOverride != null;
  const calculatedTotal = round2(subtotal - discountTotal + deliveryFee);
  const total = totalIsManual
    ? round2(input.totalOverride! + deliveryFee)
    : calculatedTotal;

  return {
    ok: true,
    breakdown: {
      serviceType: input.serviceType,
      totalDays,
      daycareHours,
      pets,
      lines: [...pets.flatMap((p) => p.lines), ...groupLines],
      subtotal,
      discountTotal,
      deliveryFee,
      total,
      totalIsManual,
      warnings,
    },
  };
}

// ─── Construcción de líneas ──────────────────────────────────

function line(args: {
  kind: QuoteItemKind;
  petKey: string | null;
  label: string;
  detail?: string;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  courtesy: Set<QuoteItemKind>;
  serviceVariantId?: string | null;
  forceCourtesy?: boolean;
}): QuoteLine {
  const isCourtesy = args.forceCourtesy ?? args.courtesy.has(args.kind);
  return {
    kind: args.kind,
    petKey: args.petKey,
    label: args.label,
    detail: args.detail,
    quantity: args.quantity,
    unitPrice: round2(args.unitPrice),
    // Una cortesía aporta 0 al total pero conserva su precio de catálogo en
    // `listPrice` para que el PDF pueda mostrar lo que se regaló.
    amount: isCourtesy ? 0 : round2(args.listPrice),
    isCourtesy,
    listPrice: round2(args.listPrice),
    serviceVariantId: args.serviceVariantId ?? null,
  };
}

/**
 * Variante de baño exacta para (talla, deslanado, corte). XS colapsa a S, que es
 * como está catalogado el servicio (@@unique en service_variants).
 */
function findBathVariant(
  catalog: QuoteCatalog,
  size: PetSizeKey,
  deslanado: boolean,
  corte: boolean
) {
  const key = bathSizeKey(size);
  return catalog.bathVariants.find(
    (v) =>
      bathSizeKey(v.petSize) === key &&
      v.deslanado === deslanado &&
      v.corte === corte
  );
}

// ─── Presentación ────────────────────────────────────────────

/** Folio humano: 123 → "COT-000123". Se usa en el PDF, el link y el WhatsApp. */
export function formatQuoteFolio(folio: number): string {
  return `COT-${String(folio).padStart(6, "0")}`;
}

/** Vigencia por defecto de una cotización nueva. Editable al cotizar. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;
