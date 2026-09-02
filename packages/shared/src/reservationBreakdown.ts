/**
 * Desglose de lo que se cobra en UNA reservación ya creada.
 *
 * Fuente única para las tres pantallas que lo pintan: el detalle del cliente,
 * el detalle del admin móvil y (a futuro) el admin web. Antes vivía duplicado
 * inline en el admin móvil y en el admin web, con dos consecuencias:
 *
 *   1. El CLIENTE no veía nada: su detalle mostraba una sola cifra ("Total
 *      $X") sin decir qué incluía. Al reservar sí ve el resumen, pero eso se
 *      arma con datos locales del wizard y se pierde en cuanto se crea la
 *      reserva — y una reserva capturada por el equipo nunca pasó por ahí.
 *   2. El gate era `lodgingAmount != null`, así que baños y guarderías —que
 *      nunca guardan ese campo— no tenían desglose para nadie.
 *
 * Aquí la base del servicio se DERIVA cuando no está persistida, así que el
 * desglose existe siempre: en los tres tipos de servicio, en las reservas
 * viejas, en las del sitio público y en las que el equipo capturó con total
 * manual.
 *
 * Módulo puro: sin zod, sin Prisma, sin Date.now() (mismo criterio que
 * ./pricing y ./quote, para no arrastrar bundle a la app móvil).
 *
 * OJO con los Decimal: Fastify los serializa como STRING. Todo monto entra por
 * `num()` antes de sumarse.
 */

/** Monto tal como puede llegar: Decimal serializado, número o ausente. */
type Money = string | number | null | undefined;

export type BreakdownRow = {
  /** Estable, para el `key` de React. */
  key: string;
  label: string;
  /** SIEMPRE positivo; el signo lo lleva `negative`. */
  amount: number;
  /** Resta del total (descuentos, ajustes a la baja). */
  negative?: boolean;
  /** Servicio regalado: se muestra con precio de catálogo tachado y aporta 0. */
  isCourtesy?: boolean;
  /** Precio de lista de un servicio de cortesía (lo que se regaló). */
  listPrice?: number;
};

export type ReservationBreakdown = {
  /** La suma con signo cuadra con `total` (±0.5, ver `sumBreakdownRows`). */
  rows: BreakdownRow[];
  total: number;
  /**
   * Deslanado/corte que el staff cotizó DESPUÉS del servicio y aún no se
   * cobran. NO están en `totalAmount` ni en `rows`: se pagan aparte
   * (PaymentCardFlow). Van sueltos para que la UI pueda advertirlos.
   */
  pendingExtras: BreakdownRow[];
};

type BreakdownAddon = {
  id?: string | null;
  unitPrice?: Money;
  quantity?: number | null;
  paidWith?: string | null;
  isCourtesy?: boolean | null;
  extraPrice?: Money;
  extraDeslanadoPrice?: Money;
  extraCortePrice?: Money;
  extraPaymentStatus?: string | null;
  variant?: {
    deslanado?: boolean | null;
    corte?: boolean | null;
    serviceType?: { code?: string | null; name?: string | null } | null;
  } | null;
};

export type BreakdownInput = {
  reservationType?: string | null;
  totalAmount?: Money;
  totalDays?: number | null;
  lodgingAmount?: Money;
  medicationFee?: Money;
  sameDayFee?: Money;
  discountTotal?: Money;
  homeDelivery?: boolean | null;
  homeDeliveryFee?: Money;
  /** "HH:mm" — para deducir las horas de una guardería. */
  checkInTime?: string | null;
  checkOutTime?: string | null;
  durationMinutes?: number | null;
  addons?: BreakdownAddon[] | null;
};

function num(v: Money): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Por debajo de esto un descuadre es ruido de redondeo (el medicamento se
 * calcula con `Math.ceil` en una ruta y sin él en otra) y no merece una línea
 * de "Ajuste". Mismo umbral que usaba el desglose del admin.
 */
const AJUSTE_MIN = 0.5;

/** Suma con signo. Es el invariante que debe cuadrar con `total`. */
export function sumBreakdownRows(rows: BreakdownRow[]): number {
  return round2(
    rows.reduce((s, r) => s + (r.negative ? -r.amount : r.amount), 0),
  );
}

function addonLabel(a: BreakdownAddon): string {
  const code = a.variant?.serviceType?.code;
  if (code === "EXTRA_HOURS") {
    const q = a.quantity ?? 1;
    return `Horas extra · ${q} ${q === 1 ? "hora" : "horas"}`;
  }
  if (code === "BATH") {
    const d = !!a.variant?.deslanado;
    const c = !!a.variant?.corte;
    if (d && c) return "Baño con deslanado y corte";
    if (d) return "Baño con deslanado";
    if (c) return "Baño con corte";
    return "Baño";
  }
  if (code === "DEWORMING") return "Desparasitante";
  return a.variant?.serviceType?.name ?? "Servicio";
}

/** Horas de una guardería, para poder decir "Guardería · 6 horas". */
function daycareHours(r: BreakdownInput): number | null {
  if (r.durationMinutes && r.durationMinutes > 0) {
    return Math.round((r.durationMinutes / 60) * 10) / 10;
  }
  const parse = (t?: string | null) => {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const inMin = parse(r.checkInTime);
  const outMin = parse(r.checkOutTime);
  if (inMin == null || outMin == null || outMin <= inMin) return null;
  return Math.round(((outMin - inMin) / 60) * 10) / 10;
}

export type BreakdownOptions = {
  /**
   * Formateador de moneda de quien llama (cada app tiene el suyo). Solo se usa
   * para la tarifa dentro de la etiqueta de hospedaje; los montos de las filas
   * salen como número y los formatea la UI.
   */
  formatMoney?: (n: number) => string;
};

export function buildReservationBreakdown(
  r: BreakdownInput,
  opts: BreakdownOptions = {},
): ReservationBreakdown {
  const money = opts.formatMoney ?? ((n: number) => `$${Math.round(n)}`);
  const total = round2(num(r.totalAmount));
  const type = r.reservationType ?? "STAY";

  const allAddons = r.addons ?? [];
  // Solo los que vienen dentro del total de la reserva. Los STANDALONE se
  // cobran por su cuenta (venta suelta) y no tienen nada que hacer aquí.
  const booking = allAddons.filter((a) => (a.paidWith ?? "BOOKING") === "BOOKING");

  const paidAddons = booking.filter(
    (a) => !a.isCourtesy && num(a.unitPrice) > 0,
  );
  const courtesyAddons = booking.filter((a) => a.isCourtesy);

  const addonRows: BreakdownRow[] = paidAddons.map((a, i) => ({
    key: a.id ?? `addon-${i}`,
    label: addonLabel(a),
    amount: round2(num(a.unitPrice)),
  }));
  const courtesyRows: BreakdownRow[] = courtesyAddons.map((a, i) => ({
    key: a.id ?? `courtesy-${i}`,
    label: addonLabel(a),
    amount: 0,
    isCourtesy: true,
    listPrice: round2(num(a.unitPrice)),
  }));
  const addonsSum = round2(addonRows.reduce((s, x) => s + x.amount, 0));

  const delivery = r.homeDelivery ? round2(num(r.homeDeliveryFee)) : 0;
  const discount = round2(num(r.discountTotal));

  // Medicamento y recargo de mismo día solo se separan si la reserva guardó su
  // desglose. Con total manual van implícitos en la base y sacarlos aparte
  // descuadraría la suma.
  const hasStayBreakdown = type === "STAY" && r.lodgingAmount != null;
  const med = hasStayBreakdown ? round2(num(r.medicationFee)) : 0;
  const sameDay = hasStayBreakdown ? round2(num(r.sameDayFee)) : 0;

  // Base explícita: solo la estancia la persiste. En baño la base es el propio
  // add-on; en guardería no hay dónde guardarla.
  const explicitBase = hasStayBreakdown ? round2(num(r.lodgingAmount)) : 0;

  const known = round2(
    explicitBase + med + addonsSum - discount + sameDay + delivery,
  );
  const residual = round2(total - known);

  const rows: BreakdownRow[] = [];

  if (hasStayBreakdown) {
    const noches = r.totalDays ?? 0;
    rows.push({
      key: "lodging",
      label:
        noches > 0
          ? `Hospedaje · ${money(explicitBase / noches)} × ${noches} ${
              noches === 1 ? "noche" : "noches"
            }`
          : "Hospedaje",
      amount: explicitBase,
    });
  } else if (type === "STAY" && residual > 0) {
    rows.push({ key: "lodging", label: "Hospedaje", amount: residual });
  } else if (type === "DAYCARE" && residual > 0) {
    const h = daycareHours(r);
    rows.push({
      key: "daycare",
      label: h ? `Guardería · ${h} ${h === 1 ? "hora" : "horas"}` : "Guardería",
      amount: residual,
    });
  }
  // La base derivada consume el residual: solo queda ajuste donde había base
  // explícita (estancia con desglose) o donde la base es el add-on (baño).
  const baseTookResidual =
    !hasStayBreakdown && (type === "STAY" || type === "DAYCARE") && residual > 0;

  if (med > 0) {
    rows.push({
      key: "medication",
      label: "Administración de medicamento (+10%)",
      amount: med,
    });
  }

  rows.push(...addonRows, ...courtesyRows);

  if (discount > 0) {
    rows.push({
      key: "discount",
      label: "Descuento",
      amount: discount,
      negative: true,
    });
  }
  if (sameDay > 0) {
    rows.push({
      key: "same-day",
      label: "Reserva el mismo día (+20%)",
      amount: sameDay,
    });
  }
  if (delivery > 0) {
    rows.push({
      key: "delivery",
      label: "Servicio a domicilio",
      amount: delivery,
    });
  }

  // Lo que el equipo cambió después de crear la reserva (editar el total,
  // extender fechas, aplicar un precio especial). El desglose original NO se
  // recalcula al mover `totalAmount`, así que sin esta línea la suma no cuadra.
  if (!baseTookResidual && Math.abs(residual) > AJUSTE_MIN) {
    rows.push({
      key: "adjustment",
      label: residual < 0 ? "Descuento aplicado" : "Ajuste del equipo",
      amount: Math.abs(residual),
      negative: residual < 0,
    });
  }

  // Extras del baño aún sin cobrar: viven fuera de `totalAmount`.
  const pendingExtras: BreakdownRow[] = [];
  for (const a of allAddons) {
    if (!a.extraPaymentStatus || a.extraPaymentStatus === "PAID") continue;
    const d = num(a.extraDeslanadoPrice);
    const c = num(a.extraCortePrice);
    if (d > 0) {
      pendingExtras.push({
        key: `${a.id ?? "extra"}-deslanado`,
        label: "Deslanado",
        amount: round2(d),
      });
    }
    if (c > 0) {
      pendingExtras.push({
        key: `${a.id ?? "extra"}-corte`,
        label: "Corte",
        amount: round2(c),
      });
    }
    if (d === 0 && c === 0 && num(a.extraPrice) > 0) {
      pendingExtras.push({
        key: `${a.id ?? "extra"}-extra`,
        label: "Servicios adicionales",
        amount: round2(num(a.extraPrice)),
      });
    }
  }

  return { rows, total, pendingExtras };
}
