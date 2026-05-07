import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getPetAlerts, resolveAdminAlert, type PetAlert } from "@/lib/api";
import { formatName } from "@/lib/format";

const ALERT_LABELS: Record<string, string> = {
  NOT_EATING: "No está comiendo",
  LETHARGIC: "Está decaído",
  BEHAVIOR_ISSUE: "Problema de comportamiento",
  HEALTH_CONCERN: "Preocupación de salud",
  INCIDENT: "Incidente",
};

const SEVERITY: Record<
  string,
  { icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap; color: string; bg: string }
> = {
  NOT_EATING: { icon: "restaurant-outline", color: COLORS.warningText, bg: COLORS.warningBg },
  LETHARGIC: { icon: "sad-outline", color: COLORS.warningText, bg: COLORS.warningBg },
  BEHAVIOR_ISSUE: { icon: "warning-outline", color: COLORS.errorText, bg: COLORS.errorBg },
  HEALTH_CONCERN: { icon: "medkit-outline", color: COLORS.errorText, bg: COLORS.errorBg },
  INCIDENT: { icon: "alert-circle-outline", color: COLORS.errorText, bg: COLORS.errorBg },
};

const TABS: { key: "all" | "unresolved" | "resolved"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "unresolved", label: "Sin resolver" },
  { key: "resolved", label: "Resueltos" },
];

function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function reservationDates(r: PetAlert["reservation"]): string {
  if (r.reservationType === "BATH" && r.appointmentAt) {
    return formatDateTime(r.appointmentAt) + " · Baño";
  }
  if (r.checkIn && r.checkOut) {
    return `${formatDateTime(r.checkIn)} → ${formatDateTime(r.checkOut)}`;
  }
  return "—";
}

export default function PetIncidentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"all" | "unresolved" | "resolved">(
    "all"
  );

  const {
    data: alerts,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ["pet", "alerts", id],
    queryFn: () => getPetAlerts(id!),
    enabled: !!id,
  });

  const resolveMutation = useMutation({
    mutationFn: (alertId: string) => resolveAdminAlert(alertId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pet", "alerts", id] });
      qc.invalidateQueries({ queryKey: ["admin", "alerts"] });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const askResolve = (alertId: string) => {
    Alert.alert("Resolver incidente", "¿Marcar este incidente como resuelto?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Resolver",
        onPress: () => resolveMutation.mutate(alertId),
      },
    ]);
  };

  const all = alerts ?? [];
  const unresolved = all.filter((a) => !a.isResolved);
  const resolved = all.filter((a) => a.isResolved);

  const filtered =
    activeTab === "unresolved"
      ? unresolved
      : activeTab === "resolved"
      ? resolved
      : all;

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
        <Text style={styles.errorText}>Error al cargar incidentes</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const reservationHref = (resId: string) => {
    if (role === "ADMIN") return `/admin/reservation/${resId}`;
    if (role === "STAFF") return `/(staff)/stay/${resId}`;
    return `/reservation/detail/${resId}`;
  };

  return (
    <View style={styles.container}>
      {/* Tabs con counts */}
      <View style={styles.tabsRow}>
        {TABS.map((t) => {
          const count =
            t.key === "all"
              ? all.length
              : t.key === "unresolved"
              ? unresolved.length
              : resolved.length;
          const active = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label} {count > 0 ? `(${count})` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        renderItem={({ item }) => {
          const sev = SEVERITY[item.type] ?? SEVERITY.INCIDENT;
          return (
            <TouchableOpacity
              style={[
                styles.card,
                {
                  borderLeftColor: item.isResolved
                    ? COLORS.successText
                    : sev.color,
                },
                item.isResolved && styles.cardResolved,
              ]}
              activeOpacity={0.85}
              onPress={() => router.push(reservationHref(item.reservation.id) as any)}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.iconWrap,
                    {
                      backgroundColor: item.isResolved
                        ? COLORS.successBg
                        : sev.bg,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      item.isResolved ? "checkmark-circle" : (sev.icon as any)
                    }
                    size={20}
                    color={item.isResolved ? COLORS.successText : sev.color}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardType}>
                    {ALERT_LABELS[item.type] ?? item.type}
                  </Text>
                  <Text style={styles.cardDate}>
                    {formatDateTime(item.createdAt)}
                  </Text>
                </View>
                {item.isResolved && item.resolvedAt && (
                  <View style={styles.resolvedPill}>
                    <Text style={styles.resolvedPillText}>
                      Resuelto {formatDateTime(item.resolvedAt)}
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.description}>{item.description}</Text>

              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Ionicons
                    name="calendar-outline"
                    size={12}
                    color={COLORS.textTertiary}
                  />
                  <Text style={styles.metaText}>
                    {reservationDates(item.reservation)}
                  </Text>
                </View>
                {item.reservation.room && (
                  <View style={styles.metaChip}>
                    <Ionicons
                      name="bed-outline"
                      size={12}
                      color={COLORS.textTertiary}
                    />
                    <Text style={styles.metaText}>
                      {item.reservation.room.name}
                    </Text>
                  </View>
                )}
                <View style={styles.metaChip}>
                  <Ionicons
                    name="person-circle-outline"
                    size={12}
                    color={COLORS.textTertiary}
                  />
                  <Text style={styles.metaText}>
                    Reportó {formatName(item.staff.firstName)}
                  </Text>
                </View>
              </View>

              {role === "ADMIN" && !item.isResolved && (
                <TouchableOpacity
                  style={[
                    styles.resolveBtn,
                    resolveMutation.isPending &&
                      resolveMutation.variables === item.id && { opacity: 0.6 },
                  ]}
                  activeOpacity={0.85}
                  disabled={resolveMutation.isPending}
                  onPress={(e) => {
                    e.stopPropagation();
                    askResolve(item.id);
                  }}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={COLORS.white}
                  />
                  <Text style={styles.resolveBtnText}>
                    {resolveMutation.isPending &&
                    resolveMutation.variables === item.id
                      ? "Resolviendo…"
                      : "Marcar como resuelto"}
                  </Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={
                  activeTab === "resolved"
                    ? "archive-outline"
                    : "shield-checkmark-outline"
                }
                size={36}
                color={COLORS.primary}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {activeTab === "resolved"
                ? "Aún no hay incidentes resueltos"
                : activeTab === "unresolved"
                ? "Sin incidentes pendientes"
                : "Esta mascota no tiene incidentes registrados"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === "all"
                ? "Cuando el equipo HDI registre alguna alerta durante una estancia, aparecerá aquí."
                : ""}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: COLORS.bgPage,
  },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: "600", color: COLORS.textTertiary },
  tabTextActive: { color: COLORS.primary, fontWeight: "700" },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardResolved: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cardType: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary },
  cardDate: { fontSize: 11, color: COLORS.textTertiary, marginTop: 1 },
  resolvedPill: {
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  resolvedPillText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.successText,
  },
  description: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metaText: { fontSize: 11, color: COLORS.textTertiary, fontWeight: "600" },
  resolveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.successText,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  resolveBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 18,
  },
  errorText: {
    fontSize: 15,
    color: COLORS.dangerText,
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: { color: COLORS.white, fontWeight: "700", fontSize: 14 },
});
