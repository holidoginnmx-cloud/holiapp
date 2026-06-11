import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import { getAdminStats, getReservations, listAdminChangeRequests, getAdminAlerts, getPendingCartillasCount } from "@/lib/api";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { StatCard } from "@/components/StatCard";
import { ReservationCard } from "@/components/ReservationCard";
import { formatName } from "@/lib/format";
import { useDashboardSeen } from "@/lib/dashboardSeen";

type SectionKey = "active" | "stays" | "baths";

export default function AdminDashboard() {
  const firstName = useAuthStore((s) => s.firstName);
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    active: false,
    stays: false,
    baths: false,
  });
  const toggleSection = (key: SectionKey) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const {
    data: stats,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: getAdminStats,
    refetchInterval: 60_000,
  });

  const { data: activeReservations } = useQuery({
    queryKey: ["admin", "reservations", "CHECKED_IN"],
    queryFn: () => getReservations({ status: "CHECKED_IN" }),
  });

  const { data: upcomingReservations } = useQuery({
    queryKey: ["admin", "reservations", "CONFIRMED"],
    queryFn: () => getReservations({ status: "CONFIRMED" }),
  });

  const { upcomingStays, upcomingBaths } = useMemo(() => {
    const stays = (upcomingReservations ?? []).filter(
      (r) => r.reservationType !== "BATH"
    );
    const baths = (upcomingReservations ?? []).filter(
      (r) => r.reservationType === "BATH"
    );
    return { upcomingStays: stays, upcomingBaths: baths };
  }, [upcomingReservations]);

  const { data: pendingChangeRequests } = useQuery({
    queryKey: ["admin", "change-requests", "PENDING"],
    queryFn: () => listAdminChangeRequests("PENDING"),
    refetchInterval: 60_000,
  });
  const pendingCount = pendingChangeRequests?.length ?? 0;

  const { data: unresolvedAlerts } = useQuery({
    queryKey: ["admin", "alerts", "unresolved"],
    queryFn: () => getAdminAlerts(false),
    refetchInterval: 60_000,
  });

  const { data: cartillasPending } = useQuery({
    queryKey: ["admin", "cartillas", "pending-count"],
    queryFn: getPendingCartillasCount,
    refetchInterval: 60_000,
  });

  const today = new Date();
  const todayStr = today.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Total de alertas: staff (manuales) + sin evidencia + vacunas por vencer.
  // Las cartillas pendientes viven en su propio tile y no cuentan como alerta.
  const totalAlertsCount =
    (unresolvedAlerts?.length ?? 0) +
    (stats?.staysWithoutUpdates.length ?? 0) +
    (stats?.expiringVaccines.length ?? 0);

  // Counts que llevan badge "nuevos desde la última visita".
  const counts = useMemo(
    () => ({
      checkins: stats?.todayCheckIns,
      checkouts: stats?.todayCheckOuts,
      alerts: totalAlertsCount,
      cartillas: cartillasPending?.pending,
    }),
    [
      stats?.todayCheckIns,
      stats?.todayCheckOuts,
      totalAlertsCount,
      cartillasPending?.pending,
    ]
  );
  const { badges, markSeen } = useDashboardSeen(userId, counts);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* Greeting */}
      <Text style={styles.greeting}>Hola, {formatName(firstName) || "Admin"}</Text>
      <Text style={styles.date}>{todayStr}</Text>

      {pendingCount > 0 && (
        <TouchableOpacity
          style={styles.changeRequestsBanner}
          onPress={() => router.push("/admin/change-requests" as any)}
          activeOpacity={0.85}
        >
          <View style={styles.changeRequestsIcon}>
            <Ionicons name="swap-horizontal" size={20} color={COLORS.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.changeRequestsTitle}>
              {pendingCount} solicitud{pendingCount === 1 ? "" : "es"} de cambio
            </Text>
            <Text style={styles.changeRequestsSubtitle}>
              Revisa y aprueba las extensiones pendientes
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.white} />
        </TouchableOpacity>
      )}

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statsRow}>
          <StatCard
            label="Hospedados"
            value={stats?.checkedInCount ?? 0}
            icon="paw"
            color={COLORS.primary}
            onPress={() => router.push("/admin/hospedados" as any)}
          />
          <StatCard
            label="Check-ins hoy"
            value={stats?.todayCheckIns ?? 0}
            icon="log-in-outline"
            color={COLORS.successText}
            badge={badges.checkins}
            onPress={() => {
              markSeen("checkins");
              router.push("/admin/checkins" as any);
            }}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            label="Check-outs hoy"
            value={stats?.todayCheckOuts ?? 0}
            icon="log-out-outline"
            color={COLORS.warningText}
            badge={badges.checkouts}
            onPress={() => {
              markSeen("checkouts");
              router.push("/admin/checkouts" as any);
            }}
          />
          <StatCard
            label="Reportes hoy"
            value={(() => {
              const total = stats?.checkedInCount ?? 0;
              const missing = stats?.staysWithoutUpdates?.length ?? 0;
              return total === 0 ? "—" : `${total - missing}/${total}`;
            })()}
            icon="document-text-outline"
            color={
              (stats?.staysWithoutUpdates?.length ?? 0) > 0
                ? COLORS.warningText
                : COLORS.successText
            }
            onPress={() => router.push("/admin/reportes-hoy" as any)}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            label="Alertas"
            value={totalAlertsCount}
            icon="warning-outline"
            color={totalAlertsCount > 0 ? COLORS.errorText : COLORS.successText}
            badge={badges.alerts}
            onPress={() => {
              markSeen("alerts");
              router.push("/admin/alerts" as any);
            }}
          />
          <StatCard
            label="Cartillas"
            value={cartillasPending?.pending ?? 0}
            icon="document-text-outline"
            color={(cartillasPending?.pending ?? 0) > 0 ? COLORS.warningText : COLORS.successText}
            badge={badges.cartillas}
            onPress={() => {
              markSeen("cartillas");
              router.push("/admin/cartillas" as any);
            }}
          />
        </View>
      </View>

      {/* Active Stays */}
      {activeReservations && activeReservations.length > 0 && (
        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeaderPressable}
            onPress={() => toggleSection("active")}
            hitSlop={8}
            android_ripple={{ color: COLORS.bgSection }}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="home-outline" size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitleInline}>Estancias activas</Text>
              <View style={styles.sectionCountBadge}>
                <Text style={styles.sectionCountText}>
                  {activeReservations.length}
                </Text>
              </View>
            </View>
            <Ionicons
              name={collapsed.active ? "chevron-down" : "chevron-up"}
              size={18}
              color={COLORS.textTertiary}
            />
          </Pressable>
          {!collapsed.active && (
            <FlatList
              data={activeReservations}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.horizontalList}
              renderItem={({ item }) => (
                <View style={styles.horizontalCard}>
                  <ReservationCard
                    petName={item.pet?.name ?? "—"}
                    roomName={item.room?.name ?? null}
                    status={item.status}
                    checkIn={item.checkIn}
                    checkOut={item.checkOut}
                    reservationType={item.reservationType}
                    appointmentAt={item.appointmentAt}
                    totalAmount={Number(item.totalAmount)}
                    paymentType={item.paymentType}
                    hasBalance={item.hasBalance}
                    hasPendingChangeRequest={item.hasPendingChangeRequest}
                    lastUpdateAt={item.lastUpdateAt}
                    hasReview={item.hasReview}
                    reviewRating={item.reviewRating}
                    adminView
                    hasDeslanado={item.hasDeslanado}
                    hasCorte={item.hasCorte}
                    ownerName={undefined}
                    onPress={() =>
                      router.push(`/admin/reservation/${item.id}` as any)
                    }
                  />
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Upcoming Stays */}
      {upcomingStays.length > 0 && (
        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeaderPressable}
            onPress={() => toggleSection("stays")}
            hitSlop={8}
            android_ripple={{ color: COLORS.bgSection }}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="bed-outline" size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitleInline}>Próximas llegadas</Text>
              <View style={styles.sectionCountBadge}>
                <Text style={styles.sectionCountText}>{upcomingStays.length}</Text>
              </View>
            </View>
            <Ionicons
              name={collapsed.stays ? "chevron-down" : "chevron-up"}
              size={18}
              color={COLORS.textTertiary}
            />
          </Pressable>
          {!collapsed.stays &&
            upcomingStays.slice(0, 5).map((item) => (
            <ReservationCard
              key={item.id}
              petName={item.pet?.name ?? "—"}
              roomName={item.room?.name ?? null}
              status={item.status}
              checkIn={item.checkIn}
              checkOut={item.checkOut}
              reservationType={item.reservationType}
              appointmentAt={item.appointmentAt}
              totalAmount={Number(item.totalAmount)}
              paymentType={item.paymentType}
              hasBalance={item.hasBalance}
              hasPendingChangeRequest={item.hasPendingChangeRequest}
              lastUpdateAt={item.lastUpdateAt}
              hasReview={item.hasReview}
              reviewRating={item.reviewRating}
              adminView
              hasDeslanado={item.hasDeslanado}
              hasCorte={item.hasCorte}
              ownerName={`${item.owner?.firstName ?? ""} ${item.owner?.lastName ?? ""}`.trim() || "Sin dueño"}
              onPress={() =>
                router.push(`/admin/reservation/${item.id}` as any)
              }
            />
          ))}
        </View>
      )}

      {/* Upcoming Baths */}
      {upcomingBaths.length > 0 && (
        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeaderPressable}
            onPress={() => toggleSection("baths")}
            hitSlop={8}
            android_ripple={{ color: COLORS.bgSection }}
          >
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="water-outline" size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitleInline}>Próximos baños</Text>
              <View style={styles.sectionCountBadge}>
                <Text style={styles.sectionCountText}>{upcomingBaths.length}</Text>
              </View>
            </View>
            <Ionicons
              name={collapsed.baths ? "chevron-down" : "chevron-up"}
              size={18}
              color={COLORS.textTertiary}
            />
          </Pressable>
          {!collapsed.baths &&
            upcomingBaths.slice(0, 5).map((item) => (
            <ReservationCard
              key={item.id}
              petName={item.pet?.name ?? "—"}
              roomName={item.room?.name ?? null}
              status={item.status}
              checkIn={item.checkIn}
              checkOut={item.checkOut}
              reservationType={item.reservationType}
              appointmentAt={item.appointmentAt}
              totalAmount={Number(item.totalAmount)}
              paymentType={item.paymentType}
              hasBalance={item.hasBalance}
              hasPendingChangeRequest={item.hasPendingChangeRequest}
              lastUpdateAt={item.lastUpdateAt}
              hasReview={item.hasReview}
              reviewRating={item.reviewRating}
              adminView
              hasDeslanado={item.hasDeslanado}
              hasCorte={item.hasCorte}
              ownerName={`${item.owner?.firstName ?? ""} ${item.owner?.lastName ?? ""}`.trim() || "Sin dueño"}
              onPress={() =>
                router.push(`/admin/reservation/${item.id}` as any)
              }
            />
          ))}
        </View>
      )}

      {/* Empty state */}
      {!activeReservations?.length &&
        !upcomingStays.length &&
        !upcomingBaths.length && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Todo en orden. No hay actividad pendiente.
            </Text>
          </View>
        )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  greeting: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  date: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 2,
    textTransform: "capitalize",
    marginBottom: 20,
  },
  statsGrid: {
    gap: 8,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionHeaderPressable: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginBottom: 8,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  sectionTitleInline: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  sectionCountBadge: {
    minWidth: 22,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },
  horizontalList: {
    gap: 12,
  },
  horizontalCard: {
    width: 280,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
  changeRequestsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    marginTop: 12,
    marginBottom: 8,
  },
  changeRequestsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  changeRequestsTitle: { color: COLORS.white, fontWeight: "800", fontSize: 15 },
  changeRequestsSubtitle: { color: COLORS.white, opacity: 0.85, fontSize: 12, marginTop: 2 },
  seeAll: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
    textAlign: "center",
    paddingVertical: 8,
  },
});
