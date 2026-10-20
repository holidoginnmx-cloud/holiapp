/**
 * Pedidos de la tienda en línea: arriba los que faltan por enviar/entregar
 * (los mismos que manda el recordatorio de las 9:00), abajo los recientes.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import { getAdminStoreOrders, type StoreOrder } from "@/lib/api";
import { formatCurrencyExact, formatDateTimeShort } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import { FULFILLMENT_LABEL, estadoPedido } from "@/lib/storeOrderLabels";

export default function StoreOrdersScreen() {
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "storeOrders", "list"],
    queryFn: getAdminStoreOrders,
  });

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const renderPedido = (o: StoreOrder) => {
    const estado = estadoPedido(o);
    const articulos = o.items
      .map((it) => (it.quantity > 1 ? `${it.quantity}× ${it.name}` : it.name))
      .join(", ");
    return (
      <Pressable
        key={o.id}
        onPress={() => router.push(`/admin/store-order/${o.id}` as any)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.iconWrap}>
          <Ionicons
            name={o.fulfillmentType === "NATIONAL_SHIPPING" ? "cube-outline" : "bag-handle-outline"}
            size={18}
            color={COLORS.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowTop}>
            <Text style={styles.rowTitle}>#{o.orderNumber}</Text>
            <View style={[styles.pill, { backgroundColor: estado.bg }]}>
              <Text style={[styles.pillText, { color: estado.fg }]}>{estado.label}</Text>
            </View>
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {articulos}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {FULFILLMENT_LABEL[o.fulfillmentType]}
            {o.paidAt ? ` · ${formatDateTimeShort(o.paidAt)}` : ""}
            {o.customerName || o.email ? ` · ${o.customerName ?? o.email}` : ""}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.amount}>{formatCurrencyExact(o.total)}</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.textDisabled} />
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
      }
    >
      <View style={[styles.card, data.pending.length > 0 && styles.cardAviso]}>
        <Text style={styles.cardTitle}>
          {data.pending.length > 0 ? `Por despachar (${data.pending.length})` : "Por despachar"}
        </Text>
        {data.pending.length === 0 ? (
          <Text style={styles.empty}>No hay pedidos pendientes. 🎉</Text>
        ) : (
          data.pending.map(renderPedido)
        )}
      </View>

      {data.recent.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recientes</Text>
          {data.recent.map(renderPedido)}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  card: {
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
  cardAviso: { borderWidth: 1, borderColor: COLORS.warningBg },
  cardTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary, marginBottom: 4 },
  empty: { fontSize: 13, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_400Regular", paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  pressed: { opacity: 0.7 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  rowSub: { fontSize: 13, color: COLORS.textSecondary, fontFamily: "PlusJakartaSans_400Regular", marginTop: 2 },
  rowMeta: { fontSize: 12, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_400Regular", marginTop: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  pillText: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold" },
  right: { flexDirection: "row", alignItems: "center", gap: 4 },
  amount: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
  },
});
