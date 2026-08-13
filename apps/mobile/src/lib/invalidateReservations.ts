import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalida TODO lo que pinta una reservación, en los tres namespaces.
 *
 * `["admin","reservations"]`, `["staff","stays"]` y `["reservations"]` son la
 * MISMA fila de la base vista por tres roles, pero como query keys están
 * desconectadas: invalidar una dejaba las otras dos viejas EN EL MISMO teléfono
 * (y ojo, `["reservations"]` tampoco alcanza a `["admin","reservations"]` por
 * prefijo — el primer segmento no coincide). Cada mutación traía su propia
 * lista de keys a mano y todas se olvidaban de algo: la de crear reserva no
 * invalidaba stats ni cuartos.
 *
 * OJO — esto NO sustituye a useRefetchOnFocus: invalidar una query INACTIVA
 * solo la marca stale, y con el `refetchOnMount: false` global no se refetchea
 * al re-montar la pantalla. Este helper cubre "yo cambié algo"; el hook cubre
 * "alguien más cambió algo desde otro teléfono".
 */
export function invalidateReservationScope(
  queryClient: QueryClient,
  reservationId?: string | null
) {
  const keys = [
    ["admin", "reservations"],
    ["admin", "stats"],
    ["admin", "rooms"],
    ["staff", "stays"],
    ["staff-baths"],
    ["staff", "daycares"],
    ["reservations"],
  ];
  if (reservationId) {
    keys.push(["reservation", reservationId]);
    keys.push(["staff", "stay", reservationId]);
  }
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey });
  }
}
