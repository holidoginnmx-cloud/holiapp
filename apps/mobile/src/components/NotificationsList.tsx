import { COLORS } from "@/constants/colors";
import { useMemo } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import {
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/api";
import type { Notification } from "@holidoginn/shared";
import { NotificationItem } from "@/components/NotificationItem";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";
import { dayGroupLabel } from "@/lib/format";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";

interface NotificationsListProps {
  /**
   * A qué pantalla lleva cada notificación. Depende del rol (el mismo aviso
   * manda al cliente a su detalle y al admin al panel), así que lo decide quien
   * monta la lista, no la lista misma.
   */
  resolveRoute: (notification: Notification) => string | null;
}

/**
 * Lista de notificaciones agrupada por día, con "marcar todas como leídas".
 *
 * Es la misma pantalla para cliente, staff y admin: lo único que cambia entre
 * ellos es a dónde navega un tap, que entra por `resolveRoute`.
 */
export function NotificationsList({ resolveRoute }: NotificationsListProps) {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const { isTablet } = useResponsive();

  const { notifications, unreadCount, isLoading, error, refetch } =
    useUnreadNotifications();

  // Optimistas: leída/todas se reflejan al instante (lista + badge del tab).
  const markOneMutation = useOptimisticMutation({
    mutationFn: markNotificationAsRead,
    patches: [
      {
        queryKey: ["notifications", userId],
        updater: (old, id) =>
          (old as Notification[]).map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          ),
      },
    ],
    invalidateKeys: [["notifications", userId]],
  });

  const markAllMutation = useOptimisticMutation<{ updated: number }, void>({
    mutationFn: () => markAllNotificationsAsRead(userId!),
    patches: [
      {
        queryKey: ["notifications", userId],
        updater: (old) =>
          (old as Notification[]).map((n) =>
            n.isRead ? n : { ...n, isRead: true }
          ),
      },
    ],
    invalidateKeys: [["notifications", userId]],
  });

  const sections = useMemo(() => {
    if (!notifications || notifications.length === 0) return [];
    const groups = new Map<
      string,
      { title: string; sortKey: number; data: typeof notifications }
    >();
    for (const n of notifications) {
      const d = new Date(n.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const sortKey = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
      ).getTime();
      const bucket = groups.get(key);
      if (bucket) {
        bucket.data.push(n);
      } else {
        groups.set(key, {
          title: dayGroupLabel(d),
          sortKey,
          data: [n],
        });
      }
    }
    return Array.from(groups.values())
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ title, data }) => ({ title, data }));
  }, [notifications]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al cargar notificaciones</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    // La lista es la RAÍZ de la pantalla (nada de ScreenContainer envolviéndola):
    // iOS 26 solo engancha el minimize del tab bar al scroll que es primera
    // subvista del view controller. "Marcar todas" pasa a ser cabecera de la
    // lista y el ancho máximo de iPad se aplica en el contentContainer.
    <SectionList
      style={styles.container}
      contentContainerStyle={
        isTablet
          ? { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" }
          : undefined
      }
      ListHeaderComponent={
        unreadCount > 0 ? (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            activeOpacity={0.7}
          >
            <Text style={styles.markAllText}>
              {markAllMutation.isPending
                ? "Marcando..."
                : `Marcar todas como leídas (${unreadCount})`}
            </Text>
          </TouchableOpacity>
        ) : null
      }
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section: { title } }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <NotificationItem
          type={item.type}
          kind={(item.data as { kind?: string } | null)?.kind}
          title={item.title}
          body={item.body}
          isRead={item.isRead}
          createdAt={item.createdAt}
          onPress={() => {
            if (!item.isRead) markOneMutation.mutate(item.id);
            const route = resolveRoute(item);
            if (route) router.push(route as never);
          }}
        />
      )}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No tienes notificaciones</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  markAllButton: {
    backgroundColor: COLORS.reviewBgAlt,
    paddingVertical: 12,
    paddingHorizontal: 20,
    margin: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  markAllText: {
    color: COLORS.primary,
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 14,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
    backgroundColor: COLORS.white,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
  },
  errorText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.dangerText,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: COLORS.white,
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 14,
  },
});
