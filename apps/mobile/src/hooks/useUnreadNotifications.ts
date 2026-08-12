import { useQuery } from "@tanstack/react-query";

import { getNotifications } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { Notification } from "@holidoginn/shared";

/**
 * Notificaciones del usuario y cuántas van sin leer.
 *
 * La misma query estaba copiada en el layout de tabs, en el menú "Más" y en la
 * pantalla de la lista. Comparten `queryKey`, así que React Query ya servía una
 * sola petición; lo que se ganaba desincronizándose era que un cambio de
 * intervalo o de key en un sitio no llegaba a los otros. Fuente única.
 */
export function useUnreadNotifications(): {
  notifications: Notification[] | undefined;
  unreadCount: number;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const userId = useAuthStore((s) => s.userId);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  return {
    notifications: data,
    unreadCount: data?.filter((n) => !n.isRead).length ?? 0,
    isLoading,
    error,
    refetch,
  };
}
