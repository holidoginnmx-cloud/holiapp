/**
 * A qué pantalla lleva tocar una reservación, según el rol y el tipo de
 * servicio. Cada área tiene su propio detalle:
 *   - ADMIN → /admin/reservation/:id (soporta hospedaje, baño y guardería)
 *   - STAFF → una pantalla por tipo (/staff/stay, /staff/bath, /staff/daycare)
 *   - OWNER → /reservation/detail/:id
 *
 * Ojo con los baños de STAFF: /staff/bath lee la lista de /staff/baths, que por
 * omisión trae los próximos 30 días. Para una cita vieja (historial) hay que
 * pasarle el día con `?date=YYYY-MM-DD`, si no la pantalla no la encuentra.
 */
import { hotelYMD } from "@/lib/format";

export function reservationHref(
  role: string | null,
  reservationId: string,
  reservationType?: string | null,
  appointmentAt?: string | Date | null
): string {
  if (role === "ADMIN") return `/admin/reservation/${reservationId}`;

  if (role === "STAFF") {
    if (reservationType === "BATH") {
      const ymd = ymdHermosillo(appointmentAt);
      return `/staff/bath/${reservationId}${ymd ? `?date=${ymd}` : ""}`;
    }
    if (reservationType === "DAYCARE") return `/staff/daycare/${reservationId}`;
    return `/staff/stay/${reservationId}`;
  }

  return `/reservation/detail/${reservationId}`;
}

/**
 * Día (YYYY-MM-DD) de una cita en hora del hotel, que es la zona con la que el
 * backend arma los horarios. Usar la fecha local del dispositivo daría el día
 * equivocado para citas de la madrugada si el teléfono está en otra TZ.
 */
function ymdHermosillo(iso?: string | Date | null): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return hotelYMD(d);
}
