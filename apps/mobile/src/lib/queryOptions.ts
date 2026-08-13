/**
 * Opciones para datos OPERATIVOS: los que dos teléfonos del equipo miran y
 * editan a la vez (reservaciones, estancias, baños del día). Jessica creaba una
 * reserva en su teléfono y en el de Javi no aparecía hasta cerrar la app.
 *
 * Se aplica QUERY POR QUERY, nunca como default global: el resto de la app
 * (mascotas, cuartos, catálogo, revenue, cartillas) conserva el `staleTime` de
 * 5 min de lib/queryClient.ts, que es lo que arregló el "tarda en toda
 * navegación". Ver lib/queryClient.ts para el porqué de esos defaults.
 *
 * Los 30 s de `staleTime` NO son decorativos:
 *  - El refetch por foco solo dispara si la query está STALE. Con los 5 min
 *    globales, volver a la app 40 s después no refrescaría nada y esto no
 *    serviría de nada.
 *  - Hacen de throttle natural contra los `AppState → active` espurios de iOS
 *    (cerrar el Control Center, descartar un alert del sistema).
 *
 * `refetchOnWindowFocus` requiere el puente de lib/queryFocus.ts para hacer
 * algo en React Native.
 */
export const LIVE_OPS = {
  staleTime: 30_000,
  refetchOnWindowFocus: true,
} as const;
