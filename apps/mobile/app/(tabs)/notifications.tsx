import { COLORS } from "@/constants/colors";
import { useMemo } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import { getNotifications, markNotificationAsRead } from "@/lib/api";
import { NotificationItem } from "@/components/NotificationItem";
import { ErrorState } from "@/components/ErrorState";
import { dayGroupLabel } from "@/lib/format";

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
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <View style={styles.container} testID="notifications-screen">
      <SectionList
        testID="notifications-list"
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
              const data = item.data as
                | { reservationId?: string; action?: string }
                | null;
              const reservationId = data?.reservationId;

              // CREDIT_ADDED: lleva al historial de saldo a favor.
              if (item.type === "CREDIT_ADDED") {
                router.push("/profile/credit-history" as any);
                return;
              }

              // DAILY_REPORT: lleva directo a los reportes diarios.
              if (item.type === "DAILY_REPORT" && reservationId) {
                router.push(`/reservation/checklists/${reservationId}` as any);
                return;
              }

              // action=CHOOSE_REFUND: abre el detalle con el modal de elegir
              // entre reembolso a tarjeta vs saldo a favor. Lo dispara tanto el
              // admin-cancel (type GENERAL) como REFUND_ISSUED.
              if (data?.action === "CHOOSE_REFUND" && reservationId) {
                router.push(
                  `/reservation/detail/${reservationId}?action=choose-refund` as any
                );
                return;
              }

              // Resto: detalle de la reservación si trae id.
              if (reservationId) {
                router.push(`/reservation/detail/${reservationId}` as any);
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
});
