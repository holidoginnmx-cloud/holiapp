import { HOTEL_TZ_OFFSET_HOURS } from "./pricing";

// ─────────────────────────────────────────────────────────────────────────────
//  Citas recurrentes — calendario de una serie
//
//  Todo aquí trabaja con DÍAS DEL HOTEL "YYYY-MM-DD", nunca con instantes: la
//  serie dice "los viernes", no "el viernes a las 17:00 UTC". La conversión a
//  un instante se hace hasta el final, al crear cada cita (API). Así no hay
//  forma de que un viernes salga jueves por leer una fecha en UTC.
//
//  Las semanas se cuentan de LUNES a domingo. "Cada 2 semanas" significa: las
//  semanas que están a 0, 2, 4… semanas de la semana de `anchorDate`.
// ─────────────────────────────────────────────────────────────────────────────

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export const WEEKDAY_SHORT_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
export const WEEKDAY_LONG_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

export type RecurrenceRule = {
  intervalWeeks: number;
  /** 0 = domingo … 6 = sábado. */
  weekdays: readonly number[];
  anchorDate: string;
  endDate?: string | null;
  skipDates?: readonly string[] | null;
};

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isYMD(s: unknown): s is string {
  if (typeof s !== "string" || !YMD_RE.test(s)) return false;
  return utcMsToYmd(ymdToUtcMs(s)) === s; // descarta 2026-02-30
}

export function addDaysYMD(ymd: string, days: number): string {
  return utcMsToYmd(ymdToUtcMs(ymd) + days * MS_PER_DAY);
}

/** Días de `a` a `b` (b − a). */
export function daysBetweenYMD(a: string, b: string): number {
  return Math.round((ymdToUtcMs(b) - ymdToUtcMs(a)) / MS_PER_DAY);
}

/** 0 = domingo. Se construye y lee en UTC: no depende de la zona del proceso. */
export function weekdayOfDateYMD(ymd: string): number {
  return new Date(ymdToUtcMs(ymd)).getUTCDay();
}

/** Lunes de la semana a la que pertenece el día. */
export function mondayOfYMD(ymd: string): string {
  const wd = weekdayOfDateYMD(ymd);
  return addDaysYMD(ymd, -((wd + 6) % 7));
}

/** "YYYY-MM-DD" del día del HOTEL para un instante (Hermosillo, UTC−7 fijo). */
export function hotelTodayYMD(now: Date = new Date()): string {
  return utcMsToYmd(now.getTime() - HOTEL_TZ_OFFSET_HOURS * 3600 * 1000);
}

/** ¿Ese día cae en la serie? (sin mirar `skipDates`). */
export function matchesRule(rule: RecurrenceRule, ymd: string): boolean {
  if (ymd < rule.anchorDate) return false;
  if (rule.endDate && ymd > rule.endDate) return false;
  if (!rule.weekdays.includes(weekdayOfDateYMD(ymd))) return false;
  const interval = Math.max(1, Math.trunc(rule.intervalWeeks));
  const weeks = daysBetweenYMD(mondayOfYMD(rule.anchorDate), mondayOfYMD(ymd)) / 7;
  return weeks % interval === 0;
}

/**
 * Fechas de la serie en [fromYmd, toYmd] (las dos incluidas), en orden.
 * Excluye `skipDates`. Recorre día por día: las ventanas son de semanas, no
 * de años, y así no hay aritmética de semanas que se pueda equivocar.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  fromYmd: string,
  toYmd: string
): string[] {
  const out: string[] = [];
  if (toYmd < fromYmd) return out;
  const skip = new Set(rule.skipDates ?? []);
  const start = fromYmd < rule.anchorDate ? rule.anchorDate : fromYmd;
  const end = rule.endDate && rule.endDate < toYmd ? rule.endDate : toYmd;
  // Tope defensivo: ~3 años de días.
  for (let d = start, i = 0; d <= end && i < 1100; d = addDaysYMD(d, 1), i++) {
    if (matchesRule(rule, d) && !skip.has(d)) out.push(d);
  }
  return out;
}

/** Las próximas `count` fechas desde `fromYmd` (incluido), para mostrarlas. */
export function nextOccurrences(rule: RecurrenceRule, fromYmd: string, count: number): string[] {
  const out: string[] = [];
  let cursor = fromYmd;
  // Ventanas de 8 semanas hasta juntar `count` o agotar ~2 años.
  for (let i = 0; i < 13 && out.length < count; i++) {
    const until = addDaysYMD(cursor, 55);
    out.push(...occurrencesBetween(rule, cursor, until));
    cursor = addDaysYMD(until, 1);
    if (rule.endDate && cursor > rule.endDate) break;
  }
  return out.slice(0, count);
}

/** "Cada 2 semanas · viernes", "Cada semana · lun, mié y vie". */
export function describeRecurrence(rule: Pick<RecurrenceRule, "intervalWeeks" | "weekdays">): string {
  const n = Math.max(1, Math.trunc(rule.intervalWeeks));
  const freq = n === 1 ? "Cada semana" : `Cada ${n} semanas`;
  // Orden de lunes a domingo, que es como lo piensa el equipo.
  const days = [...new Set(rule.weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 0) return freq;
  if (days.length === 1) return `${freq} · ${WEEKDAY_LONG_ES[days[0]] ?? "?"}`;
  const names = days.map((d) => WEEKDAY_SHORT_ES[d] ?? "?");
  return `${freq} · ${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** "vie 27 nov" para listas cortas de fechas. */
export function shortDateLabelES(ymd: string): string {
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [, m, d] = ymd.split("-").map(Number);
  return `${WEEKDAY_SHORT_ES[weekdayOfDateYMD(ymd)]} ${d} ${MESES[m - 1] ?? ""}`.trim();
}

/** Reglas que cruzan campos. Se aplican al alta y al resultado de un PATCH. */
export type RecurringIssueInput = {
  reservationType: "BATH" | "DAYCARE";
  weekdays: readonly number[];
  anchorDate: string;
  endDate?: string | null;
  startTime?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
};

export function recurringBookingIssues(v: RecurringIssueInput): string[] {
  const issues: string[] = [];
  if (v.reservationType === "BATH" && !v.startTime) {
    issues.push("Falta la hora de la cita de baño");
  }
  if (v.reservationType === "DAYCARE") {
    if (!v.checkInTime || !v.checkOutTime) {
      issues.push("Faltan la hora de entrada y de salida de la guardería");
    } else if (v.checkOutTime <= v.checkInTime) {
      issues.push("La salida de la guardería debe ser después de la entrada");
    }
  }
  if (v.endDate && v.endDate < v.anchorDate) {
    issues.push("La fecha final es anterior a la primera fecha");
  }
  if (!v.weekdays.includes(weekdayOfDateYMD(v.anchorDate))) {
    issues.push(
      `La primera fecha cae en ${WEEKDAY_LONG_ES[weekdayOfDateYMD(v.anchorDate)]}, que no es uno de los días elegidos`
    );
  }
  return issues;
}
