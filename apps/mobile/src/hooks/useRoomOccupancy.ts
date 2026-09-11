import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRoomsOccupancy, type RoomRangeOccupant } from "@/lib/api";
import { formatStayDay } from "@/lib/format";
import type { Room } from "@holidoginn/shared";

/**
 * Ocupación de los cuartos en un rango, para pintar en gris los que no tienen
 * lugar en vez de dejar que el equipo los elija y choque con el 409 al guardar.
 *
 * El mapa es `null` cuando NO se sabe (sin fechas, cargando, error). `null` no
 * es "todo libre": react-query no borra `data` al deshabilitar la query, así
 * que sin ese candado la pantalla pintaría la ocupación del rango anterior.
 */
export function useRoomOccupancy(args: {
  checkIn?: string | Date | null;
  checkOut?: string | Date | null;
  /** Al reasignar: la propia estancia no debe contarse a sí misma. */
  excludeReservationId?: string;
  /** Para no pedir nada hasta que el modal esté abierto, p. ej. */
  enabled?: boolean;
}) {
  const { checkIn, checkOut, excludeReservationId, enabled = true } = args;
  const ciISO = checkIn ? new Date(checkIn).toISOString() : null;
  const coISO = checkOut ? new Date(checkOut).toISOString() : null;
  const listo = enabled && !!ciISO && !!coISO && ciISO < coISO;

  const query = useQuery({
    queryKey: ["admin", "rooms", "occupancy", ciISO, coISO, excludeReservationId ?? null],
    queryFn: () =>
      getRoomsOccupancy({
        checkIn: ciISO!,
        checkOut: coISO!,
        ...(excludeReservationId ? { excludeReservationId } : {}),
      }),
    enabled: listo,
    staleTime: 15_000,
  });

  const ocupacionPorCuarto = useMemo(() => {
    if (!listo || query.isFetching || !query.data) return null;
    return new Map(query.data.map((r) => [r.id, r.occupied]));
  }, [listo, query.isFetching, query.data]);

  // Mismo candado que ocupacionPorCuarto: sin él se pintarían los perros del
  // rango anterior mientras llega el nuevo.
  const ocupantesPorCuarto = useMemo(() => {
    if (!listo || query.isFetching || !query.data) return null;
    return new Map(query.data.map((r) => [r.id, r.occupants ?? []]));
  }, [listo, query.isFetching, query.data]);

  return { ocupacionPorCuarto, ocupantesPorCuarto, ...query };
}

const MAX_OCUPANTES = 3;

/**
 * Quiénes ocupan el cuarto en esas fechas: "Pepito (sale 12 sep) · Max (llega
 * 13 sep)". Es información, no un motivo de bloqueo. Las fechas son días de
 * estadía y van en UTC (formatStayDay) o se corren un día. `undefined` si no
 * hay nadie, para no pintar un renglón vacío.
 */
export function textoOcupantes(
  occupants: RoomRangeOccupant[] | null | undefined,
): string | undefined {
  if (!occupants?.length) return undefined;
  const nombres = occupants.slice(0, MAX_OCUPANTES).map((o) => {
    if (o.status === "CHECKED_IN" && o.checkOut) {
      return `${o.petName} (sale ${formatStayDay(o.checkOut)})`;
    }
    if (o.checkIn) return `${o.petName} (llega ${formatStayDay(o.checkIn)})`;
    return o.petName;
  });
  const resto = occupants.length - MAX_OCUPANTES;
  return nombres.join(" · ") + (resto > 0 ? ` y ${resto} más` : "");
}

/**
 * Cómo se lee un cuarto en la lista: "disponible", "ocupado" o "2 de 4
 * disponibles". Devuelve `null` en texto cuando la ocupación no se conoce, para
 * que la pantalla caiga a lo que mostraba antes.
 */
export function textoDisponibilidad(
  room: Pick<Room, "capacity">,
  ocupados: number | null | undefined,
): { texto: string | null; lleno: boolean } {
  if (ocupados == null) return { texto: null, lleno: false };
  const libres = room.capacity - ocupados;
  if (libres <= 0) {
    return {
      texto:
        room.capacity > 1
          ? `Ocupado en esas fechas (${ocupados} de ${room.capacity})`
          : "Ocupado en esas fechas",
      lleno: true,
    };
  }
  return {
    texto:
      room.capacity > 1
        ? `${libres} de ${room.capacity} disponibles`
        : "Disponible",
    lleno: false,
  };
}
