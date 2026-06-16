import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getAdminRevenueBreakdown } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("es-MX", { minimumFractionDigits: 0 })}`;
}

function methodLabel(m: string): string {
  switch (m) {
    case "STRIPE":
    case "CARD":
      return "Tarjeta";
    case "CASH":
      return "Efectivo";
    case "TRANSFER":
      return "Transferencia";
    case "CREDIT":
      return "Saldo a favor";
    default:
      return m;
  }
}

function methodIcon(
  m: string,
): keyof typeof import("@expo/vector-icons").Ionicons.glyphMap {
  if (m === "CASH") return "cash-outline";
  if (m === "TRANSFER") return "swap-horizontal-outline";
  if (m === "CREDIT") return "wallet-outline";
  return "card-outline";
}

export default function RevenueBreakdown() {
  const monthLabel = new Date().toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "revenue", "current-month"],
    queryFn: () => getAdminRevenueBreakdown(),
    refetchInterval: 60_000,
  });

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const total = data?.total ?? 0;

  const methods = Object.entries(
    Object.entries(data?.byMethod ?? {}).reduce<Record<string, number>>(
      (acc, [m, amt]) => {
        const key = m === "CARD" ? "STRIPE" : m;
        acc[key] = (acc[key] ?? 0) + amt;
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b[1] - a[1]);

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
      <Text style={styles.heading}>Por método de pago</Text>
      <Text style={styles.sub}>{monthLabel}</Text>

      {/* Por método de pago */}
      {methods.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="card" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.sectionTitle}>Por método de pago</Text>
          </View>
          {methods.map(([method, amount], idx) => {
            const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
            return (
              <View
                key={method}
                style={[
                  styles.methodRow,
                  idx === methods.length - 1 && styles.methodRowLast,
                ]}
              >
                <View style={styles.methodIconWrap}>
                  <Ionicons
                    name={methodIcon(method)}
                    size={16}
                    color={COLORS.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodName}>{methodLabel(method)}</Text>
                  <Text style={styles.methodPct}>{pct}% del total</Text>
                </View>
                <Text style={styles.methodAmount}>
                  {formatCurrency(amount)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {total === 0 && (
        <View style={styles.emptyWrap}>
          <Ionicons
            name="cash-outline"
            size={40}
            color={COLORS.textDisabled}
          />
          <Text style={styles.emptyText}>Sin pagos este mes</Text>
        </View>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16 },
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
    textTransform: "capitalize",
    fontWeight: "600",
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  sectionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  // Por método
  methodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  methodRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  methodIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  methodName: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  methodPct: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
    fontWeight: "600",
  },
  methodAmount: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 60,
  },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
});
