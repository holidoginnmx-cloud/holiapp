import { useMemo } from "react";
import type { BathSlotsResponse } from "@/lib/api/baths";

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

/**
 * ¿La hora elegida cabe en la agenda de estética? Devuelve el mensaje de
 * conflicto para el equipo, o null si el horario es viable.
 *
 * Se compara contra el horario exacto de la rejilla; si el operador eligió
 * una hora fuera de ella, se revisa el traslape con los slots ocupados.
 * El pasado también cuenta como conflicto (se avisa y se deja forzar: el
 * equipo registra baños que ya ocurrieron).
 *
 * Compartido entre crear reservación (admin) y reagendar cita — si los
 * mensajes cambian, cambian en los dos flujos a la vez.
 */
export function useBathConflict(
  bathSlots: BathSlotsResponse | undefined,
  appointmentAt: Date | null,
): string | null {
  return useMemo(() => {
    if (!bathSlots || !appointmentAt) return null;
    const t = appointmentAt.getTime();
    if (t <= Date.now()) return "Ese horario ya pasó.";
    const exact = bathSlots.slots.find((s) => new Date(s.startUtc).getTime() === t);
    if (exact) {
      if (exact.available) return null;
      return exact.reason === "CAPACITY"
        ? "Se encima con otra cita."
        : exact.reason === "CLOSES_TOO_LATE"
          ? "No alcanza a terminar antes de que salga la estilista."
          : exact.reason === "PAST"
            ? "Ese horario ya pasó."
            : "Ese horario no está disponible.";
    }
    const end = t + bathSlots.durationMinutes * 60000;
    const choca = bathSlots.slots.some(
      (s) =>
        !s.available &&
        s.reason === "CAPACITY" &&
        s.endUtc != null &&
        t < new Date(s.endUtc).getTime() &&
        new Date(s.startUtc).getTime() < end,
    );
    if (choca) return "Se encima con otra cita.";
    const ultimo = [...bathSlots.slots].reverse().find((s) => s.available);
    if (ultimo && t > new Date(ultimo.startUtc).getTime()) {
      return "No alcanza a terminar antes de que salga la estilista.";
    }
    return null;
  }, [bathSlots, appointmentAt]);
}
