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
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/api";
import type { Notification } from "@holidoginn/shared";
import { NotificationItem } from "@/components/NotificationItem";
import { ScreenContainer } from "@/components/ScreenContainer";
import { dayGroupLabel } from "@/lib/format";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";

export default function StaffNotificationsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();

  const { data: notifications, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    refetchInterval: 30_000,
  });

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

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

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
    <ScreenContainer backgroundColor={COLORS.white}>
      {unreadCount > 0 && (
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
      )}

      <SectionList
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
            title={item.title}
            body={item.body}
            isRead={item.isRead}
            createdAt={item.createdAt}
            onPress={() => {
              if (!item.isRead) markOneMutation.mutate(item.id);
              const reservationId = (item.data as { reservationId?: string } | null)?.reservationId;
              if (reservationId) {
                router.push(`/staff/stay/${reservationId}` as any);
              }
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No tienes notificaciones</Text>
          </View>
        }
      />
    </ScreenContainer>
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
    fontWeight: "700",
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
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
  errorText: {
    fontSize: 16,
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
    fontWeight: "600",
    fontSize: 14,
  },
});
