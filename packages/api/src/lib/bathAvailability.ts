/**
 * Motor de disponibilidad de la agenda de estética.
 *
 * La agenda vieja modelaba una cita como un INSTANTE (`appointmentAt`) y la
 * disponibilidad como igualdad de timestamp sobre una rejilla uniforme de
 * `slotMinutes`. El negocio la vive como un INTERVALO: un baño+corte de perro
 * chico toma hora y media y un deslanado de perro grande dos horas o más. De
 * ahí salían los dos problemas reales: citas encimadas (se agendaba a las 16 y
 * a las 17 un servicio de dos horas) y la última cita del día terminando
 * después de que sale la estilista.
 *
 * Aquí vive solo la aritmética, sin Prisma ni I/O, para poder razonarla y
 * verificarla aparte. La parte con base de datos está en `bathAvailabilityDb`.
 *
 * Convención de zona horaria: Hermosillo no observa horario de verano, así que
 * la hora local del hotel es UTC-7 fijo. Todo lo que entra y sale son `Date`
 * en UTC; los "minutos locales" son minutos desde la medianoche del hotel.
 */

/**
 * Zona del negocio. Sonora es el único estado de México que nunca observó
 * horario de verano, así que Hermosillo es UTC-7 fijo todo el año. Desde que el
 * país abolió el horario de verano (2022), la Ciudad de México quedó en UTC-6
 * permanente: las dos zonas difieren SIEMPRE una hora.
 *
 * Fuente única de la API. Debe coincidir con `TZ_OFFSET_HOTEL_HORAS` del admin
 * web (HolidogInn-web_app/lib/date.ts) y con el de la app móvil
 * (apps/mobile/src/lib/format.ts).
 */
export const TZ_HOTEL = "America/Hermosillo";

/** Offset fijo del hotel en horas (ver TZ_HOTEL). */
export const TZ_OFFSET_HOURS = 7;

const MS_PER_MIN = 60_000;
const TZ_SHIFT_MS = TZ_OFFSET_HOURS * 60 * MS_PER_MIN;

/**
 * Cota superior de lo que puede durar un servicio. Se usa para ensanchar hacia
 * atrás la ventana de la consulta de ocupación: una cita que empezó ayer a las
 * 23:00 no puede seguir estorbando hoy, pero una que empezó a las 8:30 con dos
 * horas por delante sí pisa el arranque del día.
 */
export const MAX_BATH_DURATION_MIN = 480;

export type BathScheduleCfg = {
  /** Hora de apertura, inclusive (0–23). */
  openHour: number;
  /** Hora a la que sale la estilista, exclusive (0–23). */
  closeHour: number;
  /** Cada cuántos minutos se ofrece un inicio de cita. */
  slotStepMinutes: number;
  /** Duración de respaldo cuando no se puede resolver la variante. */
  defaultBathDurationMinutes: number;
  /** Tope duro opcional del último inicio. null = solo aplica la regla de cierre. */
  lastStartHour: number | null;
  /** Limpieza/preparación entre perro y perro. */
  bufferMinutes: number;
  /** Cuántas citas pueden correr a la vez (hoy: una estilista → 1). */
  maxConcurrentBaths: number;
  isActive: boolean;
};

/** Una cita ya agendada, como intervalo. */
export type BusyInterval = {
  startMs: number;
  endMs: number;
  /** id de la reservación (o del addon, para baños de hospedaje). */
  id: string;
  /** Nombre de la mascota, para poder decir "se encima con Luna". */
  label: string;
};

export type SlotReason =
  | "PAST" // el horario ya pasó
  | "CAPACITY" // se encima con otra cita
  | "CLOSES_TOO_LATE" // termina después de que sale la estilista
  | "AFTER_LAST_START" // pasa el tope duro de último inicio
  | "OUT_OF_WINDOW"; // antes de abrir o fuera del día

export type StartVerdict =
  | { ok: true }
  | { ok: false; reason: SlotReason; message: string; conflicts: BusyInterval[] };

// ────────────────────────────────────────────────────────────────────────────
//  Conversión entre UTC y la hora local del hotel
// ────────────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" del día LOCAL del hotel al que pertenece un instante. */
export function localYMD(d: Date): string {
  const local = new Date(d.getTime() - TZ_SHIFT_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Minutos desde la medianoche local del hotel. */
export function localMinutesOfDay(d: Date): number {
  const local = new Date(d.getTime() - TZ_SHIFT_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Día local + minutos desde su medianoche → instante UTC. */
export function ymdAtLocalMinutes(dateYMD: string, minutesLocal: number): Date {
  const [y, m, d] = dateYMD.split("-").map(Number);
  const hh = Math.floor(minutesLocal / 60);
  const mm = minutesLocal % 60;
  return new Date(Date.UTC(y, m - 1, d, hh + TZ_OFFSET_HOURS, mm));
}

/** Rango UTC que cubre el día local completo: [00:00, 24:00). */
export function dayRangeUtc(dateYMD: string): { start: Date; end: Date } {
  return {
    start: ymdAtLocalMinutes(dateYMD, 0),
    end: ymdAtLocalMinutes(dateYMD, 24 * 60),
  };
}

export function isValidDateYMD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** "9:30 am" en hora del hotel, para los mensajes que lee el equipo. */
export function formatLocalTime(d: Date): string {
  const min = localMinutesOfDay(d);
  const h24 = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, "0");
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** "1 h 30 min" / "2 h" / "45 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function endOf(start: Date, durationMinutes: number): Date {
  return new Date(start.getTime() + durationMinutes * MS_PER_MIN);
}

// ────────────────────────────────────────────────────────────────────────────
//  Rejilla de inicios
// ────────────────────────────────────────────────────────────────────────────

/**
 * Los inicios que se pueden ofrecer para un servicio de `durationMinutes` en
 * un día dado.
 *
 * La diferencia con la agenda vieja está en la condición de corte: antes se
 * paraba cuando el SLOT no cabía; ahora se para cuando el SERVICIO no termina
 * antes del cierre. Con cierre a las 18:00, un baño de una hora se sigue
 * ofreciendo a las 17:00, pero uno de dos horas se corta a las 16:00 — solo,
 * sin que nadie mueva un número.
 *
 * El paso ya no es la duración sino `slotStepMinutes`, así que una cita de dos
 * horas puede empezar a las 9:30 en lugar de forzarse a horas en punto.
 */
export function buildStartCandidates(
  dateYMD: string,
  cfg: BathScheduleCfg,
  durationMinutes: number
): Date[] {
  if (!isValidDateYMD(dateYMD)) return [];
  const step = Math.max(5, cfg.slotStepMinutes);
  const openMin = cfg.openHour * 60;
  const closeMin = cfg.closeHour * 60;
  const lastStartMin = cfg.lastStartHour != null ? cfg.lastStartHour * 60 : Infinity;

  const starts: Date[] = [];
  for (let min = openMin; min + durationMinutes <= closeMin; min += step) {
    if (min > lastStartMin) break;
    starts.push(ymdAtLocalMinutes(dateYMD, min));
  }
  return starts;
}

// ────────────────────────────────────────────────────────────────────────────
//  Traslapes
// ────────────────────────────────────────────────────────────────────────────

/**
 * Las citas existentes que chocan con `[start, start + duración)`.
 *
 * El buffer de limpieza se aplica ensanchando el intervalo ya agendado por
 * ambos lados: separa a la cita nueva tanto si va antes como si va después.
 */
export function conflictsWith(
  start: Date,
  durationMinutes: number,
  cfg: BathScheduleCfg,
  busy: BusyInterval[]
): BusyInterval[] {
  const s = start.getTime();
  const e = s + durationMinutes * MS_PER_MIN;
  const pad = Math.max(0, cfg.bufferMinutes) * MS_PER_MIN;
  return busy.filter((b) => s < b.endMs + pad && b.startMs - pad < e);
}

export function overlapCount(
  start: Date,
  durationMinutes: number,
  cfg: BathScheduleCfg,
  busy: BusyInterval[]
): number {
  return conflictsWith(start, durationMinutes, cfg, busy).length;
}

// ────────────────────────────────────────────────────────────────────────────
//  Veredicto de un inicio concreto
// ────────────────────────────────────────────────────────────────────────────

/**
 * ¿Se puede agendar un servicio de `durationMinutes` que empieza en `start`?
 *
 * Los mensajes son los que ve el equipo y el cliente, así que dicen la hora
 * concreta del problema en vez de un error genérico.
 */
export function evaluateStart(
  start: Date,
  durationMinutes: number,
  cfg: BathScheduleCfg,
  busy: BusyInterval[],
  now: Date = new Date()
): StartVerdict {
  const startMin = localMinutesOfDay(start);
  const closeMin = cfg.closeHour * 60;
  const openMin = cfg.openHour * 60;

  if (start.getTime() <= now.getTime()) {
    return { ok: false, reason: "PAST", message: "Ese horario ya pasó.", conflicts: [] };
  }
  if (startMin < openMin) {
    return {
      ok: false,
      reason: "OUT_OF_WINDOW",
      message: `La estética abre a las ${formatLocalTime(ymdAtLocalMinutes(localYMD(start), openMin))}.`,
      conflicts: [],
    };
  }
  if (startMin + durationMinutes > closeMin) {
    const fin = endOf(start, durationMinutes);
    const cierre = ymdAtLocalMinutes(localYMD(start), closeMin);
    return {
      ok: false,
      reason: "CLOSES_TOO_LATE",
      message:
        `El servicio toma ${formatDuration(durationMinutes)}: empezando a las ` +
        `${formatLocalTime(start)} terminaría a las ${formatLocalTime(fin)}, ` +
        `después del cierre (${formatLocalTime(cierre)}).`,
      conflicts: [],
    };
  }
  if (cfg.lastStartHour != null && startMin > cfg.lastStartHour * 60) {
    const tope = ymdAtLocalMinutes(localYMD(start), cfg.lastStartHour * 60);
    return {
      ok: false,
      reason: "AFTER_LAST_START",
      message: `La última cita del día se agenda a las ${formatLocalTime(tope)}.`,
      conflicts: [],
    };
  }

  const conflicts = conflictsWith(start, durationMinutes, cfg, busy);
  if (conflicts.length >= Math.max(1, cfg.maxConcurrentBaths)) {
    const c = conflicts[0];
    return {
      ok: false,
      reason: "CAPACITY",
      message:
        `Se encima con ${c.label} (${formatLocalTime(new Date(c.startMs))} – ` +
        `${formatLocalTime(new Date(c.endMs))}).`,
      conflicts,
    };
  }

  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
//  Multi-perro
// ────────────────────────────────────────────────────────────────────────────

/**
 * Encadena las citas de un grupo multi-mascota: cada perro empieza cuando
 * termina el anterior (más el buffer).
 *
 * Sin esto, las reservaciones de varios perros se guardaban todas con la MISMA
 * hora — que es exactamente el encime que se reportó ("agendo uno a las cuatro
 * y el otro a las cinco, pero ni de chiste va a terminar uno en una hora").
 */
export function chainStarts(
  start: Date,
  durations: number[],
  bufferMinutes: number
): Date[] {
  const pad = Math.max(0, bufferMinutes);
  const starts: Date[] = [];
  let cursor = start.getTime();
  for (const d of durations) {
    starts.push(new Date(cursor));
    cursor += (d + pad) * MS_PER_MIN;
  }
  return starts;
}
