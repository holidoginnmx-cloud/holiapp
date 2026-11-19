import { COLORS } from "@/constants/colors";
import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getUnassignedDeposits, UNASSIGNED_DEPOSITS_KEY } from "@/lib/api";
import { formatCurrency, formatDayShort } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  CARD: "Tarjeta",
};

/**
 * Anticipos que ya se cobraron pero todavía no cuelgan de una reserva (el
 * cliente no mandó los datos del perro). Cuentan como ingreso «Por asignar»;
 * cuando la reserva exista, se asignan desde aquí y bajan su saldo.
 */
export default function UnassignedDepositsScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: UNASSIGNED_DEPOSITS_KEY,
    queryFn: getUnassignedDeposits,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const total = (data ?? []).reduce((s, d) => s + d.amount, 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <TouchableOpacity
        style={styles.newBtn}
        onPress={() => router.push("/admin/deposits/new" as any)}
        activeOpacity={0.85}
        testID="deposits-new"
      >
        <Ionicons name="add-circle" size={20} color={COLORS.white} />
        <Text style={styles.newBtnText}>Registrar anticipo sin reserva</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        Para cuando el cliente ya pagó el anticipo pero todavía no manda los datos del
        perro. Cuenta como ingreso desde ese día.
      </Text>

      {(data ?? []).length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={36} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>No hay anticipos por asignar</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>
            {data!.length} por asignar · {formatCurrency(total)}
          </Text>
          {data!.map((d) => (
            <TouchableOpacity
              key={d.id}
              style={styles.card}
              onPress={() => router.push(`/admin/deposits/assign?id=${d.id}` as any)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{d.clientName ?? d.notes ?? "Anticipo sin reserva"}</Text>
                <Text style={styles.cardSub}>
                  {[
                    d.paidAt ? formatDayShort(d.paidAt) : null,
                    METHOD_LABEL[d.method] ?? d.method,
                    d.clientName && d.notes ? d.notes : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={styles.cardAmount}>{formatCurrency(d.amount)}</Text>
                <Text style={styles.assign}>Asignar ›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  newBtnText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 8,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  cardSub: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  cardAmount: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  assign: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.warningText },
  empty: { alignItems: "center", gap: 8, paddingVertical: 40 },
  emptyText: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary },
});
