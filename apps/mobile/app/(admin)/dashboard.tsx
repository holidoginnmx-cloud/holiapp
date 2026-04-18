import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import { getAdminStats, getReservations, listAdminChangeRequests, getAdminAlerts } from "@/lib/api";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { StatCard } from "@/components/StatCard";
import { AlertItem } from "@/components/AlertItem";
import { ReservationCard } from "@/components/ReservationCard";

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("es-MX", { minimumFractionDigits: 0 })}`;
}

export default function AdminDashboard() {
  const firstName = useAuthStore((s) => s.firstName);
  const router = useRouter();

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

  const today = new Date();
  const todayStr = today.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

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
      <Text style={styles.greeting}>Hola, {firstName ?? "Admin"}</Text>
      <Text style={styles.date}>{todayStr}</Text>

      {pendingCount > 0 && (
        <TouchableOpacity
          style={styles.changeRequestsBanner}
          onPress={() => router.push("/(admin)/change-requests" as any)}
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
          />
          <StatCard
            label="Check-ins hoy"
            value={stats?.todayCheckIns ?? 0}
            icon="log-in-outline"
            color={COLORS.successText}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            label="Check-outs hoy"
            value={stats?.todayCheckOuts ?? 0}
            icon="log-out-outline"
            color={COLORS.warningText}
          />
          <StatCard
            label="Cuartos libres"
            value={`${stats?.availableRooms ?? 0}/${stats?.totalActiveRooms ?? 0}`}
            icon="bed-outline"
            color={COLORS.infoText}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard
            label="Ingresos del mes"
            value={formatCurrency(stats?.monthRevenue ?? 0)}
            icon="cash-outline"
            color={COLORS.successText}
          />
          <StatCard
            label="Alertas staff"
            value={unresolvedAlerts?.length ?? 0}
            icon="warning-outline"
            color={(unresolvedAlerts?.length ?? 0) > 0 ? COLORS.errorText : COLORS.successText}
          />
        </View>
      </View>

      {/* Active Stays */}
      {activeReservations && activeReservations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Estancias activas</Text>
          <FlatList
            data={activeReservations}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.horizontalList}
            renderItem={({ item }) => (
              <View style={styles.horizontalCard}>
                <ReservationCard
                  petName={item.pet.name}
                  roomName={item.room?.name ?? null}
                  status={item.status}
                  checkIn={item.checkIn}
                  checkOut={item.checkOut}
                  totalAmount={Number(item.totalAmount)}
                  ownerName={undefined}
                  onPress={() =>
                    router.push(`/(admin)/reservation/${item.id}` as any)
                  }
                />
              </View>
            )}
          />
        </View>
      )}

      {/* Upcoming Arrivals */}
      {upcomingReservations && upcomingReservations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Proximas llegadas</Text>
          {upcomingReservations.slice(0, 5).map((item) => (
            <ReservationCard
              key={item.id}
              petName={item.pet.name}
              roomName={item.room?.name ?? null}
              status={item.status}
              checkIn={item.checkIn}
              checkOut={item.checkOut}
              totalAmount={Number(item.totalAmount)}
              onPress={() =>
                router.push(`/(admin)/reservation/${item.id}` as any)
              }
            />
          ))}
        </View>
      )}

      {/* Staff Alerts */}
      {unresolvedAlerts && unresolvedAlerts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alertas del staff</Text>
          {unresolvedAlerts.slice(0, 5).map((a) => (
            <AlertItem
              key={a.id}
              icon="warning-outline"
              text={`${a.pet.name} — ${a.type === "NOT_EATING" ? "No come" : a.type === "LETHARGIC" ? "Decaído" : a.type === "HEALTH_CONCERN" ? "Salud" : a.type === "INCIDENT" ? "Incidente" : "Comportamiento"}: ${a.description.slice(0, 60)}${a.description.length > 60 ? "..." : ""}`}
              severity="error"
              onPress={() => router.push("/(admin)/alerts" as any)}
            />
          ))}
          {unresolvedAlerts.length > 5 && (
            <TouchableOpacity onPress={() => router.push("/(admin)/alerts" as any)}>
              <Text style={styles.seeAll}>Ver todas ({unresolvedAlerts.length})</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Alerts */}
      {stats &&
        (stats.expiringVaccines.length > 0 ||
          stats.staysWithoutUpdates.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Alertas</Text>

            {stats.staysWithoutUpdates.map((s) => (
              <AlertItem
                key={s.reservationId}
                icon="camera-outline"
                text={`${s.petName} no tiene evidencia hoy (${s.ownerName})`}
                severity="error"
                onPress={() =>
                  router.push(
                    `/(admin)/reservation/${s.reservationId}` as any
                  )
                }
              />
            ))}

            {stats.expiringVaccines.map((v) => (
              <AlertItem
                key={v.id}
                icon="medical-outline"
                text={`${v.name} de ${v.petName} vence pronto (${v.ownerName})`}
                severity="warning"
                onPress={() =>
                  router.push(`/pet/${v.petId}` as any)
                }
              />
            ))}
          </View>
        )}

      {/* Empty state */}
      {!activeReservations?.length &&
        !upcomingReservations?.length &&
        !stats?.expiringVaccines.length &&
        !stats?.staysWithoutUpdates.length && (
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
    gap: 10,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
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
