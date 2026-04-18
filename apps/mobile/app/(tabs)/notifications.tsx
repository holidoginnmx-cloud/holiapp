import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/api";
import { NotificationItem } from "@/components/NotificationItem";

export default function NotificationsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: notifications, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
  });

  const markOneMutation = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userId] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsAsRead(userId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userId] }),
  });

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

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
    <View style={styles.container} testID="notifications-screen">
      {unreadCount > 0 && (
        <TouchableOpacity
          style={styles.markAllButton}
          onPress={() => markAllMutation.mutate()}
          disabled={markAllMutation.isPending}
          activeOpacity={0.7}
          testID="notifications-mark-all-button"
        >
          <Text style={styles.markAllText}>
            {markAllMutation.isPending
              ? "Marcando..."
              : `Marcar todas como leídas (${unreadCount})`}
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        testID="notifications-list"
        data={notifications}
        keyExtractor={(item) => item.id}
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
                router.push(`/reservation/${reservationId}` as any);
              }
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center} testID="notifications-empty-state">
            <Text style={styles.emptyText}>No tienes notificaciones</Text>
          </View>
        }
      />
    </View>
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
