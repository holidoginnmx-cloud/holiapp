import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getAdminRevenueBreakdown } from "@/lib/api";
import { formatName } from "@/lib/format";

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

function methodIcon(m: string): keyof typeof import("@expo/vector-icons").Ionicons.glyphMap {
  if (m === "CASH") return "cash-outline";
  if (m === "TRANSFER") return "swap-horizontal-outline";
  if (m === "CREDIT") return "wallet-outline";
  return "card-outline";
}

// Solo fecha (sin hora): la hora de los pagos legacy es un artefacto del
// import (mediodía UTC → 5:00 a.m. local), así que no es confiable mostrarla.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const CATEGORY_STYLE: Record<
  "HOTEL" | "BATH" | "MIXED",
  { label: string; bg: string; color: string; icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap }
> = {
  HOTEL: {
    label: "Hotel",
    bg: COLORS.primaryLight,
    color: COLORS.primary,
    icon: "bed",
  },
  BATH: {
    label: "Baño",
    bg: COLORS.infoBg,
    color: COLORS.infoText,
    icon: "water",
  },
  MIXED: {
    label: "Hotel + Baño",
    bg: COLORS.successBg,
    color: COLORS.successText,
    icon: "sparkles",
  },
};

export default function AdminRevenue() {
  const router = useRouter();
  const monthLabel = new Date().toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "revenue", "current-month"],
    queryFn: () => getAdminRevenueBreakdown(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const total = data?.total ?? 0;
  const gross = data?.gross ?? 0;
  const refunded = data?.refunded ?? 0;
  const hotelTotal = data?.byCategory?.hotel ?? 0;
  const bathTotal = data?.byCategory?.bath ?? 0;
  // Para los porcentajes usamos el bruto positivo (categorías pueden ser
  // negativas si hubo más reembolsos que cobros, lo cual evitamos en la barra).
  const categoriesPositive = Math.max(0, hotelTotal) + Math.max(0, bathTotal);
  const hotelPct =
    categoriesPositive > 0
      ? Math.round((Math.max(0, hotelTotal) / categoriesPositive) * 100)
      : 0;
  const bathPct =
    categoriesPositive > 0
      ? Math.round((Math.max(0, bathTotal) / categoriesPositive) * 100)
      : 0;
  const paymentsCount =
    data?.payments.filter((p) => p.kind === "PAYMENT").length ?? 0;
  const refundsCount =
    data?.payments.filter((p) => p.kind === "REFUND").length ?? 0;

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
      <Text style={styles.heading}>Ingresos del mes</Text>
      <Text style={styles.sub}>{monthLabel}</Text>

      {/* Total cobrado */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>TOTAL COBRADO</Text>
        <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
        {refunded > 0 ? (
          <View style={styles.totalSplitRow}>
            <Text style={styles.totalSplitItem}>
              Cobrado{" "}
              <Text style={styles.totalSplitStrong}>
                {formatCurrency(gross)}
              </Text>
            </Text>
            <Text style={styles.totalSplitDot}>·</Text>
            <Text style={[styles.totalSplitItem, { color: COLORS.dangerText }]}>
              Reembolsado{" "}
              <Text
                style={[styles.totalSplitStrong, { color: COLORS.dangerText }]}
              >
                −{formatCurrency(refunded)}
              </Text>
            </Text>
          </View>
        ) : null}
        <Text style={styles.totalMeta}>
          {paymentsCount} {paymentsCount === 1 ? "pago" : "pagos"}
          {refundsCount > 0
            ? ` · ${refundsCount} ${
                refundsCount === 1 ? "cancelado" : "cancelados"
              }`
            : ""}
        </Text>
      </View>

      {/* Hotel vs Baño */}
      {total > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.categoryRow}>
            <View style={styles.categoryItem}>
              <View
                style={[
                  styles.categoryIconWrap,
                  { backgroundColor: COLORS.primaryLight },
                ]}
              >
                <Ionicons name="bed" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.categoryLabel}>Hotel</Text>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(hotelTotal)}
                </Text>
              </View>
              <View style={styles.categoryPctPill}>
                <Text style={styles.categoryPctText}>{hotelPct}%</Text>
              </View>
            </View>

            <View style={styles.categoryItem}>
              <View
                style={[
                  styles.categoryIconWrap,
                  { backgroundColor: COLORS.infoBg },
                ]}
              >
                <Ionicons name="water" size={20} color={COLORS.infoText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.categoryLabel}>Baños</Text>
                <Text style={styles.categoryAmount}>
                  {formatCurrency(bathTotal)}
                </Text>
              </View>
              <View
                style={[
                  styles.categoryPctPill,
                  { backgroundColor: COLORS.infoBg },
                ]}
              >
                <Text
                  style={[styles.categoryPctText, { color: COLORS.infoText }]}
                >
                  {bathPct}%
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.barWrap}>
            <View style={styles.barTrack}>
              {hotelTotal > 0 && (
                <View
                  style={[
                    styles.barSegment,
                    { flex: hotelTotal, backgroundColor: COLORS.primary },
                  ]}
                />
              )}
              {bathTotal > 0 && (
                <View
                  style={[
                    styles.barSegment,
                    { flex: bathTotal, backgroundColor: COLORS.infoText },
                  ]}
                />
              )}
            </View>
          </View>
        </View>
      )}

      {/* Ver método de pago — botón a pantalla dedicada */}
      {total > 0 && (
        <TouchableOpacity
          style={styles.breakdownButton}
          onPress={() => router.push("/admin/revenue-breakdown" as any)}
          activeOpacity={0.85}
        >
          <View style={styles.breakdownIconWrap}>
            <Ionicons name="card" size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.breakdownTitle}>Por método de pago</Text>
            <Text style={styles.breakdownSubtitle}>
              Tarjeta, efectivo, transferencia, saldo
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.textTertiary}
          />
        </TouchableOpacity>
      )}

      {/* Pagos detalle */}
      <View style={styles.paymentsHeaderRow}>
        <Text style={styles.paymentsTitle}>Pagos</Text>
        {(data?.payments.length ?? 0) > 0 && (
          <View style={styles.countChip}>
            <Text style={styles.countChipText}>{data?.payments.length}</Text>
          </View>
        )}
      </View>

      {(data?.payments.length ?? 0) === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="cash-outline" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>Sin pagos este mes</Text>
        </View>
      ) : (
        data?.payments.map((item) => {
          const owner = item.reservation
            ? `${formatName(item.reservation.owner?.firstName ?? "")} ${formatName(item.reservation.owner?.lastName ?? "")}`.trim() || "—"
            : "—";
          const pet = item.reservation
            ? formatName(item.reservation.pet?.name ?? "—")
            : "—";
          const cat = CATEGORY_STYLE[item.category];
          const isRefund = item.kind === "REFUND";
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.paymentRow, isRefund && styles.paymentRowRefund]}
              disabled={!item.reservation}
              onPress={() =>
                item.reservation &&
                router.push(`/admin/reservation/${item.reservation.id}` as any)
              }
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.catIconWrap,
                  { backgroundColor: isRefund ? COLORS.errorBg : cat.bg },
                ]}
              >
                <Ionicons
                  name={isRefund ? "close-circle" : cat.icon}
                  size={18}
                  color={isRefund ? COLORS.dangerText : cat.color}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.paymentTitleRow}>
                  <Text style={styles.paymentPet} numberOfLines={1}>
                    {pet}
                  </Text>
                  {isRefund ? (
                    <View style={styles.refundPill}>
                      <Text style={styles.refundPillText}>Cancelado</Text>
                    </View>
                  ) : (
                    <View style={[styles.catPill, { backgroundColor: cat.bg }]}>
                      <Text style={[styles.catPillText, { color: cat.color }]}>
                        {cat.label}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.paymentOwner} numberOfLines={1}>
                  {owner}
                </Text>
                <Text style={styles.paymentMeta}>
                  {isRefund ? "Reembolso · " : ""}
                  {methodLabel(item.method)}
                  {item.paidAt ? ` · ${formatDate(item.paidAt)}` : ""}
                </Text>
                <View style={styles.paymentOriginRow}>
                  <View
                    style={[
                      styles.originChip,
                      item.originLegacy ? styles.originChipWeb : styles.originChipApp,
                    ]}
                  >
                    <Ionicons
                      name={item.originLegacy ? "globe-outline" : "phone-portrait-outline"}
                      size={10}
                      color={item.originLegacy ? COLORS.textTertiary : COLORS.primary}
                    />
                    <Text
                      style={[
                        styles.originChipText,
                        { color: item.originLegacy ? COLORS.textTertiary : COLORS.primary },
                      ]}
                    >
                      {item.originLegacy ? "Web" : "App"}
                    </Text>
                  </View>
                  <Text style={styles.paymentRegistered}>
                    Registrado {formatDate(item.createdAt)}
                  </Text>
                </View>
                {!isRefund && item.category === "MIXED" && (
                  <View style={styles.splitRow}>
                    <Text style={styles.splitItem}>
                      Hotel {formatCurrency(item.hotelAmount)}
                    </Text>
                    <Text style={styles.splitDot}>·</Text>
                    <Text style={styles.splitItem}>
                      Baño {formatCurrency(item.bathAmount)}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.paymentAmount,
                  isRefund && styles.paymentAmountRefund,
                ]}
              >
                {isRefund ? "−" : ""}
                {formatCurrency(Number(item.amount))}
              </Text>
            </TouchableOpacity>
          );
        })
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
  // Total hero card
  totalCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 22,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textTertiary,
    letterSpacing: 0.6,
  },
  totalValue: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.primary,
    marginTop: 6,
  },
  totalMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 4,
    fontWeight: "600",
  },
  totalSplitRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    marginTop: 6,
  },
  totalSplitItem: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  totalSplitStrong: {
    fontWeight: "800",
    color: COLORS.textSecondary,
  },
  totalSplitDot: {
    fontSize: 12,
    color: COLORS.textDisabled,
  },
  // Hotel vs Baño card
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
  categoryRow: {
    gap: 10,
  },
  categoryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 12,
  },
  categoryIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  categoryAmount: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  categoryPctPill: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  categoryPctText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },
  barWrap: {
    marginTop: 12,
  },
  barTrack: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.bgSection,
    overflow: "hidden",
  },
  barSegment: {
    height: 8,
  },
  // Botón "Por método"
  breakdownButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  breakdownIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  breakdownTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  breakdownSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
  // Pagos detalle
  paymentsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
  },
  paymentsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  countChip: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    minWidth: 22,
    alignItems: "center",
  },
  countChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },
  paymentRow: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  catIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  paymentPet: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    flexShrink: 1,
  },
  catPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  catPillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  paymentOwner: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
  paymentMeta: {
    fontSize: 11,
    color: COLORS.textDisabled,
    marginTop: 2,
  },
  paymentOriginRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  originChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  originChipWeb: {
    backgroundColor: COLORS.bgSection,
  },
  originChipApp: {
    backgroundColor: COLORS.primaryLight,
  },
  originChipText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  paymentRegistered: {
    fontSize: 11,
    color: COLORS.textDisabled,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  splitItem: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  splitDot: {
    fontSize: 11,
    color: COLORS.textDisabled,
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.primary,
  },
  paymentAmountRefund: {
    color: COLORS.dangerText,
  },
  paymentRowRefund: {
    backgroundColor: COLORS.errorBgLight,
  },
  refundPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.dangerText,
  },
  refundPillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
    color: COLORS.white,
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
  },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
});
