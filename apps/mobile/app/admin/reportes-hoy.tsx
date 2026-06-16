import { COLORS } from "@/constants/colors";
import { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getReservations, getAdminStats } from "@/lib/api";
import { formatName } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

export default function AdminReportesHoy() {
  const router = useRouter();

  const { data: hospedados, isLoading: loadingRes, isError: errorRes, error: resError, refetch: refetchRes, isRefetching } = useQuery({
    queryKey: ["admin", "reservations", "CHECKED_IN"],
    queryFn: () => getReservations({ status: "CHECKED_IN" }),
    refetchInterval: 60_000,
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: getAdminStats,
    refetchInterval: 60_000,
  });

  const missingIds = useMemo(() => {
    return new Set(
      (stats?.staysWithoutUpdates ?? []).map((s) => s.reservationId)
    );
  }, [stats]);

  const total = hospedados?.length ?? 0;
  const missing = missingIds.size;
  const done = total - missing;

  const refetch = () => {
    refetchRes();
    refetchStats();
  };

  if (errorRes) {
    return <ErrorState error={resError} onRetry={refetch} />;
  }

  if (loadingRes) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Reportes de hoy</Text>
      <Text style={styles.sub}>
        Estado de los reportes diarios de las mascotas hospedadas
      </Text>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: COLORS.successBg }]}>
          <Ionicons name="checkmark-circle" size={20} color={COLORS.successText} />
          <Text style={[styles.summaryValue, { color: COLORS.successText }]}>
            {done}
          </Text>
          <Text style={styles.summaryLabel}>Con reporte</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: COLORS.errorBg }]}>
          <Ionicons name="alert-circle" size={20} color={COLORS.errorText} />
          <Text style={[styles.summaryValue, { color: COLORS.errorText }]}>
            {missing}
          </Text>
          <Text style={styles.summaryLabel}>Faltan</Text>
        </View>
      </View>

      {total === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="paw-outline" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>No hay mascotas hospedadas</Text>
        </View>
      ) : (
        <FlatList
          data={hospedados}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
          renderItem={({ item }) => {
            const isMissing = missingIds.has(item.id);
            return (
              <TouchableOpacity
                style={[styles.row, isMissing && styles.rowMissing]}
                onPress={() => router.push(`/admin/reservation/${item.id}` as any)}
                activeOpacity={0.85}
              >
                <View style={styles.avatar}>
                  <Ionicons name="paw" size={18} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.petName}>{formatName(item.pet?.name ?? "—")}</Text>
                  <Text style={styles.metaText}>
                    {item.room?.name ? `${item.room.name} · ` : ""}
                    {item.owner
                      ? `${formatName(item.owner.firstName)} ${formatName(item.owner.lastName)}`
                      : ""}
                  </Text>
                </View>
                {isMissing ? (
                  <View style={styles.missingBadge}>
                    <Ionicons name="alert-circle" size={12} color={COLORS.white} />
                    <Text style={styles.missingBadgeText}>Falta reporte</Text>
                  </View>
                ) : (
                  <View style={styles.doneBadge}>
                    <Ionicons name="checkmark" size={12} color={COLORS.successText} />
                    <Text style={styles.doneBadgeText}>OK</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage, padding: 16 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  heading: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary },
  sub: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "800",
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  list: { gap: 8, paddingBottom: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
  },
  rowMissing: {
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  missingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.errorText,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  missingBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.white,
  },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  doneBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.successText,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
});
