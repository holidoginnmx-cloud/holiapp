import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";

/**
 * Revalida las queries indicadas cada vez que la pantalla recupera el foco
 * (cambiar de pestaña, volver atrás desde un detalle).
 *
 * Por qué hace falta: las pantallas de pestaña viven bajo NativeTabs y por eso
 * NUNCA se desmontan, así que el `refetchOnMount: false` global no es el
 * problema — el problema es que sin esto nada dispara un refetch, jamás. Un
 * cambio hecho en otro teléfono no aparecía hasta matar la app.
 *
 * Invalida en vez de llamar `refetch()`: `invalidateQueries` pinta la caché al
 * instante y refetchea en background, mientras que `refetch()` garantiza una
 * espera de red en cada regreso — exactamente la queja de lentitud que se
 * arregló en su día. Ver el mismo patrón en app/staff/stay/[id].tsx.
 *
 * OJO: invalidar una query INACTIVA solo la marca stale, y con
 * `refetchOnMount: false` no se refetchea al re-montar. Por eso este hook no es
 * redundante con invalidateReservationScope (que corre tras las mutaciones):
 * uno cubre "yo cambié algo", el otro "alguien más cambió algo".
 *
 * @param keys Query keys a invalidar. Se pasan por prefijo, así que
 *   `["admin","reservations"]` alcanza también a `["admin","reservations","CHECKED_IN"]`.
 * @param minIntervalMs Piso entre disparos, para que rebotar entre pestañas no
 *   genere una ráfaga de requests.
 */
export function useRefetchOnFocus(
  keys: QueryKey[],
  { minIntervalMs = 15_000 }: { minIntervalMs?: number } = {}
) {
  const queryClient = useQueryClient();
  const lastRunRef = useRef(0);
  // Las keys llegan como literales en línea (array nuevo en cada render), así
  // que se leen desde una ref: si fueran dependencia del callback, el effect se
  // re-suscribiría en cada render.
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastRunRef.current < minIntervalMs) return;
      lastRunRef.current = now;
      for (const queryKey of keysRef.current) {
        queryClient.invalidateQueries({ queryKey });
      }
    }, [queryClient, minIntervalMs])
  );
}
