import type { RecurringBooking } from "@/lib/api";
import { formatTimeHHmm } from "@/lib/format";

// Citas recurrentes: piezas compartidas por las pantallas de app/admin/recurring.

export const RECURRING_QUERY_KEY = ["recurring-bookings"] as const;

/** "Baño 10:00 am" / "Guardería 8:00 am–2:00 pm". */
export function horarioDeSerie(
  s: Pick<RecurringBooking, "reservationType" | "startTime" | "checkInTime" | "checkOutTime">
): string {
  if (s.reservationType === "BATH") {
    return `Baño${s.startTime ? ` ${formatTimeHHmm(s.startTime)}` : ""}`;
  }
  const horas =
    s.checkInTime && s.checkOutTime
      ? ` ${formatTimeHHmm(s.checkInTime)}–${formatTimeHHmm(s.checkOutTime)}`
      : "";
  return `Guardería${horas}`;
}

/** Date local del dispositivo (corre en hora del hotel) → "YYYY-MM-DD". */
export function dateToYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → Date local a mediodía (para alimentar al selector). */
export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
