import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getCreditLedger, getMe } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  CREDIT_ADDED: "Saldo agregado",
  CREDIT_APPLIED: "Saldo aplicado",
  CREDIT_ADJUSTED: "Ajuste",
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(n: number | string): string {
  const num = Number(n);
  return `${num < 0 ? "-" : ""}$${Math.abs(num).toLocaleString("es-MX")}`;
}

export default function CreditHistoryScreen() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["credit-ledger"],
    queryFn: getCreditLedger,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const balance = Number(me?.creditBalance ?? 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Saldo actual</Text>
        <Text style={styles.headerAmount}>${balance.toLocaleString("es-MX")} MXN</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>Sin movimientos</Text>
          </View>
        }
        renderItem={({ item }) => {
          const amount = Number(item.amount);
          const isPositive = amount > 0;
          return (
            <View style={styles.row}>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: isPositive ? COLORS.successBg : COLORS.bgSection },
                ]}
              >
                <Ionicons
                  name={isPositive ? "arrow-down" : "arrow-up"}
                  size={18}
                  color={isPositive ? COLORS.successText : COLORS.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.type}>{TYPE_LABEL[item.type] ?? item.type}</Text>
                <Text style={styles.desc} numberOfLines={2}>
                  {item.description}
                </Text>
                <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
              </View>
              <Text
                style={[
                  styles.amount,
                  { color: isPositive ? COLORS.successText : COLORS.textTertiary },
                ]}
              >
                {formatMoney(item.amount)}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  header: {
    backgroundColor: COLORS.primary,
    padding: 20,
    alignItems: "center",
  },
  headerLabel: { color: COLORS.white, fontSize: 13, fontWeight: "600", opacity: 0.9 },
  headerAmount: { color: COLORS.white, fontSize: 28, fontWeight: "800", marginTop: 4 },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  type: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  desc: { fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  date: { fontSize: 11, color: COLORS.textDisabled, marginTop: 4 },
  amount: { fontSize: 15, fontWeight: "800" },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
});
