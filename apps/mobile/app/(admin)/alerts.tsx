import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { getAdminAlerts, resolveAdminAlert } from "@/lib/api";
import type { AdminAlert } from "@/lib/api";
import { FilterTabs } from "@/components/FilterTabs";

const ALERT_LABELS: Record<string, string> = {
  NOT_EATING: "No está comiendo",
  LETHARGIC: "Está decaído",
  BEHAVIOR_ISSUE: "Problema de comportamiento",
  HEALTH_CONCERN: "Preocupación de salud",
  INCIDENT: "Incidente",
};

const SEVERITY_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  NOT_EATING: { icon: "restaurant-outline", color: COLORS.warningText, bg: COLORS.warningBg },
  LETHARGIC: { icon: "sad-outline", color: COLORS.warningText, bg: COLORS.warningBg },
  BEHAVIOR_ISSUE: { icon: "warning-outline", color: COLORS.errorText, bg: COLORS.errorBg },
  HEALTH_CONCERN: { icon: "medkit-outline", color: COLORS.errorText, bg: COLORS.errorBg },
  INCIDENT: { icon: "alert-circle-outline", color: COLORS.errorText, bg: COLORS.errorBg },
};

const TABS = [
  { key: "unresolved", label: "Sin resolver" },
  { key: "resolved", label: "Resueltas" },
];

export default function AdminAlerts() {
  const router = useRouter();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("unresolved");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "alerts", activeTab],
    queryFn: () => getAdminAlerts(activeTab === "resolved"),
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveAdminAlert(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "alerts"] });
      Alert.alert("Listo", "Alerta marcada como resuelta");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const alerts = data ?? [];
  const unresolvedCount = activeTab === "unresolved" ? alerts.length : 0;
  const tabsWithCounts = TABS.map((t) => ({
    ...t,
    count: t.key === "unresolved" ? alerts.length : undefined,
  }));

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const renderAlert = ({ item }: { item: AdminAlert }) => {
    const severity = SEVERITY_CONFIG[item.type] ?? SEVERITY_CONFIG.INCIDENT;
    const dateStr = new Date(item.createdAt).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <TouchableOpacity
        style={[styles.alertCard, { borderLeftColor: severity.color }]}
        activeOpacity={0.7}
        onPress={() =>
          router.push(`/(admin)/reservation/${item.reservation.id}` as any)
        }
      >
        <View style={styles.alertHeader}>
          <View style={[styles.alertIconWrap, { backgroundColor: severity.bg }]}>
            <Ionicons name={severity.icon as any} size={20} color={severity.color} />
          </View>
          <View style={styles.alertHeaderInfo}>
            <Text style={styles.alertType}>
              {ALERT_LABELS[item.type] ?? item.type}
            </Text>
            <Text style={styles.alertDate}>{dateStr}</Text>
          </View>
          {!item.isResolved && (
            <TouchableOpacity
              style={styles.resolveBtn}
              onPress={() =>
                Alert.alert("Resolver alerta", "¿Marcar como resuelta?", [
                  { text: "Cancelar", style: "cancel" },
                  {
                    text: "Resolver",
                    onPress: () => resolveMutation.mutate(item.id),
                  },
                ])
              }
              disabled={resolveMutation.isPending}
            >
              <Ionicons name="checkmark-circle" size={20} color={COLORS.successText} />
            </TouchableOpacity>
          )}
          {item.isResolved && item.resolvedAt && (
            <Text style={styles.resolvedLabel}>
              Resuelta {new Date(item.resolvedAt).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
              })}
            </Text>
          )}
        </View>

        <Text style={styles.alertDescription}>{item.description}</Text>

        <View style={styles.alertMeta}>
          <View style={styles.metaChip}>
            <Ionicons name="paw" size={12} color={COLORS.primary} />
            <Text style={styles.metaText}>{item.pet.name}</Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="person-outline" size={12} color={COLORS.textTertiary} />
            <Text style={styles.metaText}>
              {item.reservation.owner.firstName} {item.reservation.owner.lastName}
            </Text>
          </View>
          {item.reservation.room && (
            <View style={styles.metaChip}>
              <Ionicons name="bed-outline" size={12} color={COLORS.textTertiary} />
              <Text style={styles.metaText}>{item.reservation.room.name}</Text>
            </View>
          )}
          <View style={styles.metaChip}>
            <Ionicons name="person-circle-outline" size={12} color={COLORS.textTertiary} />
            <Text style={styles.metaText}>
              Staff: {item.staff.firstName}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        <FilterTabs
          tabs={tabsWithCounts}
          activeTab={activeTab}
          onSelect={setActiveTab}
        />
      </View>

      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        renderItem={renderAlert}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons
              name={activeTab === "unresolved" ? "checkmark-circle-outline" : "archive-outline"}
              size={48}
              color={COLORS.border}
            />
            <Text style={styles.emptyText}>
              {activeTab === "unresolved"
                ? "No hay alertas pendientes"
                : "No hay alertas resueltas"}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
    textAlign: "center",
  },
  alertCard: {
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
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  alertIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  alertHeaderInfo: {
    flex: 1,
  },
  alertType: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  alertDate: {
    fontSize: 12,
    color: COLORS.textDisabled,
    marginTop: 1,
  },
  resolveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  resolvedLabel: {
    fontSize: 11,
    color: COLORS.successText,
    fontWeight: "600",
  },
  alertDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  alertMeta: {
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
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
});
