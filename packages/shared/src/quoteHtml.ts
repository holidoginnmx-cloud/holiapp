// ============================================================
// Plantilla de la cotización — HTML autocontenido.
//
// Este es el DOCUMENTO que ve el cliente: se sirve tal cual en la página
// pública (/cotizacion/<token>, que lo inyecta dentro del shell del sitio) y se
// le pasa a expo-print en la app móvil para generar el PDF que se manda por
// WhatsApp. UNA sola plantilla para los dos, de modo que el PDF y la página no
// puedan desincronizarse, y renderizada en el SERVIDOR para que el diseño se
// pueda iterar con un deploy de API sin rebuild de la app.
//
// Restricciones que NO son negociables:
//  · CSS inline y nada remoto (fuentes, imágenes, scripts): el WebView de
//    expo-print no carga assets externos de forma confiable, y la página va
//    dentro de una CSP restrictiva.
//  · Todo texto libre pasa por esc(): el sitio inyecta esto con
//    dangerouslySetInnerHTML bajo el mismo origen que la sesión del cliente.
//  · La entrada es PublicQuote, que NO tiene los campos internos. Que las notas
//    del equipo no salgan al cliente no depende de acordarse de borrarlas:
//    depende de que aquí no exista dónde ponerlas.
// ============================================================

import { formatQuoteFolio, type QuoteItemKind, type QuoteServiceType } from "./quote";

// ─── Entrada ─────────────────────────────────────────────────

/** Línea tal como se imprime. Sin `courtesyReason`: ese motivo es interno. */
export interface PublicQuoteLine {
  kind: QuoteItemKind;
  label: string;
  detail?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  isCourtesy: boolean;
  listPrice: number;
}

export interface PublicQuotePet {
  name: string;
  breed?: string | null;
  weightKg?: number | null;
  subtotal: number;
  lines: PublicQuoteLine[];
}

/**
 * Lo ÚNICO que sale hacia el cliente. Este tipo es la allowlist: si mañana se
 * agrega una columna a `quotes`, no viaja al público a menos que alguien la
 * agregue aquí a propósito. Nunca añadir `internalNotes` ni `courtesyReason`.
 */
export interface PublicQuote {
  folio: number;
  serviceType: QuoteServiceType;
  status: "DRAFT" | "SENT" | "CONVERTED" | "CANCELLED";
  clientName: string;
  createdAt: string; // ISO
  validUntil: string; // ISO
  /** Derivado en el servidor, no persistido (ver el enum QuoteStatus). */
  isExpired: boolean;

  checkIn?: string | null; // ISO
  checkOut?: string | null; // ISO
  appointmentAt?: string | null; // ISO
  checkInTime?: string | null; // "HH:mm"
  checkOutTime?: string | null; // "HH:mm"
  totalDays?: number | null;
  daycareHours?: number | null;

  pets: PublicQuotePet[];
  /** Líneas del grupo: domicilio, descuento, conceptos libres. */
  groupLines: PublicQuoteLine[];

  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  depositSuggested?: number | null;

  /** Nota VISIBLE que escribió el equipo para el cliente. */
  notes?: string | null;

  hotelName: string;
  hotelPhone: string;
  /** wa.me ya armado, para el botón "Reservar por WhatsApp". */
  whatsappUrl: string;
}

export interface RenderQuoteOptions {
  /**
   * Contexto de render. En "pdf" se ocultan los elementos interactivos (el
   * botón de WhatsApp no se puede tocar en papel) y se ajustan los márgenes.
   */
  target?: "web" | "pdf";
}

// ─── Escapado ────────────────────────────────────────────────

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapa texto para interpolarlo en HTML. TODO campo que venga de la base pasa
 * por aquí: la página pública se inyecta con dangerouslySetInnerHTML en el
 * mismo origen que la sesión de Clerk del cliente, así que un nombre de perro
 * con `<script>` sería XSS de verdad, no teórico.
 */
export function esc(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// ─── Formato ─────────────────────────────────────────────────

const mx = (n: number): string =>
  `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Zona del hotel. Las FECHAS DEL SERVICIO (entrada, salida, día de la cita) se
// guardan ancladas a UTC y deben leerse en UTC: son días de calendario, no
// instantes. En cambio los INSTANTES reales (emisión, vigencia) hay que
// mostrarlos en hora de Hermosillo o se corren de día: un createdAt de las 6 pm
// del 26 es "2026-08-27T01:00Z" y en UTC se imprimiría como día 27.
const HOTEL_TZ = "America/Hermosillo";

const esDate = (iso: string, zona: "utc" | "hotel" = "utc"): string =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: zona === "hotel" ? HOTEL_TZ : "UTC",
  });

const esDateShort = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const SERVICE_LABEL: Record<QuoteServiceType, string> = {
  STAY: "Hospedaje",
  BATH: "Estética",
  DAYCARE: "Guardería",
  DELIVERY: "Servicio a domicilio",
};

// ─── Paleta ──────────────────────────────────────────────────
// Identidad del rediseño (2026-07), la misma que ve el cliente en el sitio y
// que usa el admin web. Como constantes y no como variables CSS porque el
// WebView de expo-print es viejo en algunos Android.
const C = {
  teal: "#17414D",
  tealDeep: "#123540",
  mustard: "#F5B142",
  cream: "#FAF3EC",
  sand: "#EFE7DA",
  border: "#ECE1D3",
  ink: "#26302F",
  muted: "#8B8172",
  white: "#FFFFFF",
};

// ─── Render ──────────────────────────────────────────────────

export function renderQuoteHtml(quote: PublicQuote, opts: RenderQuoteOptions = {}): string {
  const isPdf = opts.target === "pdf";
  const folio = formatQuoteFolio(quote.folio);

  return `
<div class="hdi-quote">
  ${styles(isPdf)}
  ${banner(quote)}
  <header class="q-head">
    <div>
      <div class="q-brand">${esc(quote.hotelName)}</div>
      <div class="q-kicker">Cotización de ${esc(SERVICE_LABEL[quote.serviceType])}</div>
    </div>
    <div class="q-folio">
      <span class="q-folio-num">${esc(folio)}</span>
      <span class="q-folio-date">${esc(esDate(quote.createdAt, "hotel"))}</span>
    </div>
  </header>

  <section class="q-meta">
    <div class="q-meta-item">
      <span class="q-label">Para</span>
      <span class="q-value">${esc(quote.clientName)}</span>
    </div>
    ${fechasBlock(quote)}
  </section>

  ${quote.pets.map((pet) => petBlock(pet)).join("")}
  ${(() => {
    // El descuento y el domicilio ya tienen su renglón en el bloque de totales;
    // imprimirlos aquí también los mostraba DOS veces y hacía que la suma
    // visible no cuadrara con el total.
    //
    // La excepción es la cotización de SOLO traslado: ahí el domicilio no es un
    // extra al final, es el único concepto. Sin esta fila el documento llegaría
    // sin decir a dónde va la camioneta ni qué viajes cubre.
    const soloDomicilio = quote.serviceType === "DELIVERY";
    const sueltas = quote.groupLines.filter(
      (l) => l.kind !== "DISCOUNT" && (soloDomicilio || l.kind !== "HOME_DELIVERY")
    );
    return sueltas.length > 0 ? groupBlock(sueltas) : "";
  })()}
  ${totalsBlock(quote)}
  ${quote.notes ? notaBlock(quote.notes) : ""}
  ${vigenciaBlock(quote)}
  ${isPdf ? "" : ctaBlock(quote)}

  <footer class="q-foot">
    <div>${esc(quote.hotelName)} · Hermosillo, Sonora</div>
    <div>${esc(quote.hotelPhone)}</div>
    <div class="q-foot-fine">
      Los precios de esta cotización son válidos hasta la fecha indicada y no
      apartan lugar. La disponibilidad se confirma al reservar.
    </div>
  </footer>
</div>`.trim();
}

// ─── Bloques ─────────────────────────────────────────────────

function banner(quote: PublicQuote): string {
  if (quote.status === "CONVERTED") {
    return `<div class="q-banner q-banner-ok">
      Esta cotización ya se convirtió en reservación. ¡Nos vemos pronto!
    </div>`;
  }
  if (quote.status === "CANCELLED") {
    return `<div class="q-banner q-banner-warn">
      Esta cotización fue cancelada. Escríbenos y con gusto te preparamos una nueva.
    </div>`;
  }
  // Vencida: se muestra el documento igual. Un 404 sobre un link que el cliente
  // guardó hace dos semanas parece un negocio caído; esto invita a escribir.
  if (quote.isExpired) {
    return `<div class="q-banner q-banner-warn">
      Esta cotización venció el ${esc(esDate(quote.validUntil, "hotel"))}. Los precios pueden
      haber cambiado — escríbenos y la actualizamos sin compromiso.
    </div>`;
  }
  return "";
}

function fechasBlock(quote: PublicQuote): string {
  if (quote.serviceType === "STAY") {
    if (quote.checkIn && quote.checkOut) {
      return `
      <div class="q-meta-item">
        <span class="q-label">Entrada</span>
        <span class="q-value">${esc(esDateShort(quote.checkIn))}</span>
      </div>
      <div class="q-meta-item">
        <span class="q-label">Salida</span>
        <span class="q-value">${esc(esDateShort(quote.checkOut))}</span>
      </div>`;
    }
    // Cotización sin fechas cerradas: se cotizó por número de noches.
    return quote.totalDays
      ? `<div class="q-meta-item">
          <span class="q-label">Estancia</span>
          <span class="q-value">${quote.totalDays} ${
            quote.totalDays === 1 ? "noche" : "noches"
          }</span>
        </div>`
      : "";
  }

  const partes: string[] = [];
  if (quote.appointmentAt) {
    partes.push(`
      <div class="q-meta-item">
        <span class="q-label">${quote.serviceType === "BATH" ? "Cita" : "Día"}</span>
        <span class="q-value">${esc(esDateShort(quote.appointmentAt))}</span>
      </div>`);
  }
  if (quote.checkInTime && quote.checkOutTime) {
    partes.push(`
      <div class="q-meta-item">
        <span class="q-label">Horario</span>
        <span class="q-value">${esc(quote.checkInTime)} a ${esc(quote.checkOutTime)}</span>
      </div>`);
  }
  return partes.join("");
}

function petBlock(pet: PublicQuotePet): string {
  const datos = [
    pet.breed,
    pet.weightKg != null ? `${pet.weightKg} kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `
  <section class="q-pet">
    <div class="q-pet-head">
      <span class="q-pet-name">${esc(pet.name)}</span>
      ${datos ? `<span class="q-pet-info">${esc(datos)}</span>` : ""}
    </div>
    <table class="q-lines">
      <tbody>
        ${pet.lines.map(lineRow).join("")}
      </tbody>
    </table>
    ${
      pet.lines.length > 1
        ? `<div class="q-pet-sub">
            <span>Subtotal ${esc(pet.name)}</span>
            <span class="q-num">${esc(mx(pet.subtotal))}</span>
          </div>`
        : ""
    }
  </section>`;
}

function groupBlock(lines: PublicQuoteLine[]): string {
  return `
  <section class="q-pet q-group">
    <table class="q-lines">
      <tbody>
        ${lines.map(lineRow).join("")}
      </tbody>
    </table>
  </section>`;
}

function lineRow(line: PublicQuoteLine): string {
  // Cortesía: el importe es $0 pero se muestra el precio de catálogo tachado.
  // El cliente tiene que VER lo que se le regaló — es el argumento de venta.
  const importe = line.isCourtesy
    ? `<span class="q-strike">${esc(mx(line.listPrice))}</span> <span class="q-gift">Cortesía</span>`
    : esc(mx(line.amount));

  return `
    <tr>
      <td class="q-line-desc">
        <span class="q-line-label">${esc(line.label)}</span>
        ${line.detail ? `<span class="q-line-detail">${esc(line.detail)}</span>` : ""}
      </td>
      <td class="q-line-amount q-num ${line.kind === "DISCOUNT" ? "q-neg" : ""}">${importe}</td>
    </tr>`;
}

function totalsBlock(quote: PublicQuote): string {
  const filas: string[] = [];

  // En la cotización de solo traslado el domicilio ya salió como concepto: aquí
  // sería el mismo renglón dos veces, y un "Subtotal $0" arriba del total.
  const soloDomicilio = quote.serviceType === "DELIVERY";

  // El subtotal solo aporta información si hay algo que lo modifique.
  if (!soloDomicilio && (quote.discountTotal > 0 || quote.deliveryFee > 0)) {
    filas.push(row("Subtotal", mx(quote.subtotal)));
  }
  if (quote.discountTotal > 0) {
    filas.push(row("Descuento", `−${mx(quote.discountTotal)}`, "q-neg"));
  }
  if (!soloDomicilio && quote.deliveryFee > 0) {
    filas.push(row("Servicio a domicilio", mx(quote.deliveryFee)));
  }

  return `
  <section class="q-totals">
    ${filas.join("")}
    <div class="q-total-row">
      <span class="q-total-label">Total</span>
      <span class="q-total-num q-num">${esc(mx(quote.total))}</span>
    </div>
    ${
      quote.depositSuggested != null && quote.depositSuggested > 0
        ? `<div class="q-deposit">
            <span>Para apartar</span>
            <span class="q-num">${esc(mx(quote.depositSuggested))}</span>
          </div>`
        : ""
    }
  </section>`;

  function row(label: string, value: string, cls = ""): string {
    return `<div class="q-total-line">
      <span>${esc(label)}</span>
      <span class="q-num ${cls}">${esc(value)}</span>
    </div>`;
  }
}

function notaBlock(notes: string): string {
  return `
  <section class="q-note">
    <div class="q-note-title">Nota</div>
    <div class="q-note-body">${esc(notes).replace(/\n/g, "<br>")}</div>
  </section>`;
}

function vigenciaBlock(quote: PublicQuote): string {
  const abierta = quote.status === "DRAFT" || quote.status === "SENT";
  if (quote.isExpired || !abierta) return "";
  return `<div class="q-vigencia">Vigente hasta el ${esc(esDate(quote.validUntil, "hotel"))}</div>`;
}

function ctaBlock(quote: PublicQuote): string {
  if (quote.status === "CONVERTED" || quote.status === "CANCELLED") return "";
  // "Reservar" no aplica a una cotización de solo traslado: el domicilio viaja
  // pegado a un servicio, así que lo que sigue es preguntar, no apartar.
  const texto =
    quote.serviceType === "DELIVERY"
      ? "Escríbenos por WhatsApp"
      : "Reservar por WhatsApp";
  return `
  <div class="q-cta">
    <a class="q-btn" href="${esc(quote.whatsappUrl)}" target="_blank" rel="noopener noreferrer">
      ${esc(texto)}
    </a>
  </div>`;
}

// ─── Estilos ─────────────────────────────────────────────────

function styles(isPdf: boolean): string {
  return `<style>
  .hdi-quote {
    --teal: ${C.teal};
    box-sizing: border-box;
    max-width: 720px;
    margin: 0 auto;
    padding: ${isPdf ? "0" : "24px 20px 40px"};
    background: ${C.white};
    color: ${C.ink};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
  }
  .hdi-quote *, .hdi-quote *::before, .hdi-quote *::after { box-sizing: inherit; }

  .q-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .q-neg { color: #B44A1E; }

  .q-banner {
    padding: 12px 16px; border-radius: 12px; font-size: 14px;
    margin-bottom: 20px; line-height: 1.45;
  }
  .q-banner-warn { background: #FDF0DC; color: #7A4A08; border: 1px solid ${C.mustard}; }
  .q-banner-ok { background: #E6F4EA; color: #1B5E33; border: 1px solid #8FD8A8; }

  .q-head {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 16px; padding-bottom: 16px; border-bottom: 2px solid ${C.teal};
  }
  .q-brand { font-size: 22px; font-weight: 700; color: ${C.teal}; letter-spacing: -0.02em; }
  .q-kicker { font-size: 14px; color: ${C.muted}; margin-top: 2px; }
  .q-folio { text-align: right; }
  .q-folio-num {
    display: block; font-size: 15px; font-weight: 700; color: ${C.teal};
    font-variant-numeric: tabular-nums;
  }
  .q-folio-date { display: block; font-size: 13px; color: ${C.muted}; }

  .q-meta {
    display: flex; flex-wrap: wrap; gap: 20px 32px;
    padding: 16px 0; border-bottom: 1px solid ${C.border};
  }
  .q-meta-item { display: flex; flex-direction: column; gap: 2px; }
  .q-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: ${C.muted}; font-weight: 600;
  }
  .q-value { font-size: 15px; font-weight: 600; }

  .q-pet { padding: 18px 0 6px; border-bottom: 1px solid ${C.border}; }
  .q-pet-head {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .q-pet-name { font-size: 16px; font-weight: 700; color: ${C.teal}; }
  .q-pet-info { font-size: 13px; color: ${C.muted}; }
  .q-group { padding-top: 6px; }

  .q-lines { width: 100%; border-collapse: collapse; }
  .q-lines td { padding: 7px 0; vertical-align: top; }
  .q-line-desc { padding-right: 16px; }
  .q-line-label { display: block; }
  .q-line-detail { display: block; font-size: 13px; color: ${C.muted}; margin-top: 1px; }
  .q-line-amount { text-align: right; font-weight: 600; width: 1%; }
  .q-strike { text-decoration: line-through; color: ${C.muted}; font-weight: 400; }
  .q-gift {
    display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px;
    background: #E6F4EA; color: #1B5E33; font-size: 12px; font-weight: 700;
  }

  .q-pet-sub {
    display: flex; justify-content: space-between; padding: 8px 0 4px;
    font-size: 13px; color: ${C.muted}; border-top: 1px dashed ${C.border};
  }

  .q-totals { padding: 16px 0 4px; }
  .q-total-line {
    display: flex; justify-content: space-between; padding: 5px 0;
    font-size: 14px; color: ${C.muted};
  }
  .q-total-row {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 10px; padding: 14px 18px; border-radius: 14px;
    background: ${C.teal}; color: ${C.white};
  }
  .q-total-label { font-size: 15px; font-weight: 600; }
  .q-total-num { font-size: 24px; font-weight: 700; }
  .q-deposit {
    display: flex; justify-content: space-between; margin-top: 8px;
    padding: 11px 18px; border-radius: 12px;
    background: ${C.cream}; border: 1px solid ${C.mustard};
    font-size: 14px; font-weight: 600; color: #7A4A08;
  }

  .q-note {
    margin-top: 18px; padding: 14px 16px; border-radius: 12px;
    background: ${C.cream}; border: 1px solid ${C.border};
  }
  .q-note-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: ${C.muted}; font-weight: 700; margin-bottom: 4px;
  }
  .q-note-body { font-size: 14px; }

  .q-vigencia {
    margin-top: 16px; text-align: center; font-size: 13px; color: ${C.muted};
  }

  .q-cta { margin-top: 20px; text-align: center; }
  .q-btn {
    display: inline-block; padding: 13px 28px; border-radius: 14px;
    background: ${C.mustard}; color: #3D2A06; font-weight: 700;
    text-decoration: none; font-size: 15px;
  }

  .q-foot {
    margin-top: 28px; padding-top: 16px; border-top: 1px solid ${C.border};
    font-size: 12px; color: ${C.muted}; text-align: center; line-height: 1.5;
  }
  .q-foot-fine { margin-top: 6px; }

  /* Impresión: el navegador guarda como PDF desde la misma página. */
  @page { size: letter; margin: 14mm; }
  @media print {
    .hdi-quote { max-width: none; padding: 0; font-size: 12pt; }
    .q-cta, .q-banner-ok { display: none; }
    .q-pet, .q-totals { break-inside: avoid; }
    .q-total-row, .q-deposit, .q-note {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  }

  @media (max-width: 420px) {
    .q-head { flex-direction: column; gap: 8px; }
    .q-folio { text-align: left; }
    .q-total-num { font-size: 21px; }
  }
</style>`;
}
