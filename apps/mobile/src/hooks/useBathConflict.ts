import { useMemo } from "react";
import type { BathSlotsResponse } from "@/lib/api/baths";
import { formatTime, hotelYMD, TZ_OFFSET_HOURS } from "@/lib/format";

// Date → "YYYY-MM-DD" del día local (el dispositivo corre en hora del hotel).
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDurationMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hora" : `${h} horas`;
  return `${h} h ${m} min`;
}

export type BathConflictKind =
  | "CLOSED_DAY"
  | "PAST"
  | "BEFORE_OPEN"
  | "CLOSES_TOO_LATE"
  | "AFTER_LAST_START"
  | "CAPACITY"
  | "UNAVAILABLE";

export type BathConflict = {
  kind: BathConflictKind;
  /** El problema y el dato que lo explica, para pintarse como error. */
  message: string;
  /** Lo que queda dicho cuando el equipo ya decidió agendar de todos modos. */
  forcedNote: string;
  /** Hasta dos horarios libres de ESE día, los más cercanos a la hora elegida. */
  suggestions: Date[];
};

const MS_PER_MIN = 60_000;

/** Cierra la oración sin duplicar el punto de «p.m.». */
function oracion(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** Minutos desde la medianoche del hotel. */
function hotelMinutesOfDay(d: Date): number {
  const local = new Date(d.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** El instante de `minutes` en el día del hotel al que pertenece `d`. */
function hotelDayAt(d: Date, minutes: number): Date {
  const [y, m, day] = hotelYMD(d).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, TZ_OFFSET_HOURS, minutes));
}

/**
 * ¿La hora elegida cabe en la agenda de estética? Devuelve el conflicto para el
 * equipo, o null si el horario es viable.
 *
 * Cada mensaje trae el dato que lo explica (a qué hora sale la estilista, cuál
 * es el último inicio posible, qué hora es) y los horarios libres más cercanos,
 * para que corregir sea un toque y no una adivinanza.
 *
 * Se compara contra el horario exacto de la rejilla; si el operador eligió una
 * hora fuera de ella, se clasifica contra la configuración del día. Los días en
 * que la estética no abre se atajan aparte: ahí la rejilla viene vacía y no hay
 * nada contra qué comparar.
 * El pasado también cuenta como conflicto (se avisa y se deja forzar: el
 * equipo registra baños que ya ocurrieron).
 *
 * Compartido entre crear reservación, baño de invitado y reagendar cita — si
 * los mensajes cambian, cambian en los tres flujos a la vez.
 */
export function useBathConflict(
  bathSlots: BathSlotsResponse | undefined,
  appointmentAt: Date | null,
): BathConflict | null {
  return useMemo(() => {
    if (!bathSlots || !appointmentAt) return null;
    const t = appointmentAt.getTime();
    const now = Date.now();
    const { config, durationMinutes } = bathSlots;

    const libres = bathSlots.slots.filter((s) => s.available && !s.inPast);
    const suggestions = [...libres]
      .sort(
        (a, b) =>
          Math.abs(new Date(a.startUtc).getTime() - t) -
          Math.abs(new Date(b.startUtc).getTime() - t),
      )
      .slice(0, 2)
      .map((s) => new Date(s.startUtc))
      .sort((a, b) => a.getTime() - b.getTime());

    const conflict = (
      kind: BathConflictKind,
      message: string,
      forcedNote: string,
    ): BathConflict => ({ kind, message, forcedNote, suggestions });

    // Día cerrado: la rejilla viene vacía, así que lo de más abajo diría que
    // cabe por falta de evidencia. Se corta aquí, y va antes que el pasado
    // porque el problema es el DÍA.
    if (bathSlots.closedDay) {
      return conflict(
        "CLOSED_DAY",
        bathSlots.closedReason ?? "Ese día la estética no abre.",
        "Se agenda en un día que la estética no abre.",
      );
    }

    if (t <= now) {
      const mismoDia = hotelYMD(appointmentAt) === hotelYMD(new Date(now));
      return conflict(
        "PAST",
        (mismoDia
          ? `Ese horario ya pasó (son las ${formatTime(new Date(now))}).`
          : "Esa fecha ya pasó.") +
          " Si el baño ya se hizo, activa «Agendar de todos modos» para registrarlo.",
        "Se registra como un baño que ya ocurrió.",
      );
    }

    const exact = bathSlots.slots.find((s) => new Date(s.startUtc).getTime() === t);
    if (exact?.available) return null;
    if (exact?.reason === "CAPACITY") {
      return conflict("CAPACITY", "Se encima con otra cita.", "Se agenda encimada con otra cita.");
    }

    const startMin = hotelMinutesOfDay(appointmentAt);
    const openMin = config.openHour * 60;
    const closeMin = config.closeHour * 60;

    if (startMin < openMin) {
      return conflict(
        "BEFORE_OPEN",
        oracion(`La estética abre a las ${formatTime(hotelDayAt(appointmentAt, openMin))}`),
        "Se agenda antes de que abra la estética.",
      );
    }

    if (startMin + durationMinutes > closeMin) {
      const cierre = hotelDayAt(appointmentAt, closeMin);
      // La rejilla solo trae inicios que terminan antes del cierre: el último
      // es, literalmente, lo más tarde que se puede empezar.
      const ultimo = bathSlots.slots[bathSlots.slots.length - 1];
      const tope = ultimo
        ? `y lo más tarde que puede empezar es a las ${formatTime(new Date(ultimo.startUtc))}`
        : `y un servicio de ${formatDurationMin(durationMinutes)} no cabe en el horario de ese día`;
      const excede = t + durationMinutes * MS_PER_MIN - cierre.getTime();
      return conflict(
        "CLOSES_TOO_LATE",
        oracion(`La estilista sale a las ${formatTime(cierre)} ${tope}`),
        `Se agenda fuera de horario: termina ${formatDurationMin(
          Math.round(excede / MS_PER_MIN),
        )} después de que salga la estilista.`,
      );
    }

    if (config.lastStartHour != null && startMin > config.lastStartHour * 60) {
      return conflict(
        "AFTER_LAST_START",
        oracion(
          `La última cita del día se agenda a las ${formatTime(
            hotelDayAt(appointmentAt, config.lastStartHour * 60),
          )}`,
        ),
        "Se agenda después de la última cita del día.",
      );
    }

    const end = t + durationMinutes * MS_PER_MIN;
    const choca = bathSlots.slots.some(
      (s) =>
        !s.available &&
        s.reason === "CAPACITY" &&
        s.endUtc != null &&
        t < new Date(s.endUtc).getTime() &&
        new Date(s.startUtc).getTime() < end,
    );
    if (choca) {
      return conflict("CAPACITY", "Se encima con otra cita.", "Se agenda encimada con otra cita.");
    }

    if (exact) {
      return conflict(
        "UNAVAILABLE",
        "Ese horario no está disponible.",
        "Se agenda en un horario no disponible.",
      );
    }
    return null;
  }, [bathSlots, appointmentAt]);
}
