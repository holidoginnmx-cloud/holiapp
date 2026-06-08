import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Navegar entre tabs/pantallas ya visitadas reutiliza la caché en vez de
      // volver a pedir todo (la causa de "tarda en toda navegación").
      staleTime: 1000 * 60 * 5, // 5 min: datos considerados frescos
      gcTime: 1000 * 60 * 30, // 30 min: conservar en memoria tras desmontar
      refetchOnMount: false, // confiar en staleTime; no refetch al re-montar
      refetchOnWindowFocus: false,
      retry: 1, // menos espera ante fallos de red
      // Las mutaciones siguen refrescando vía invalidateQueries, y las
      // pantallas que necesitan datos en vivo usan su propio refetchInterval.
    },
  },
});
