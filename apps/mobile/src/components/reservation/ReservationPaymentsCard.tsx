import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import type { Payment } from "@holidoginn/shared";
import { formatCurrency, formatDayShort } from "@/lib/format";
import { styles } from "@/styles/ownerReservationDetailStyles";

const PAYMENT_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  UNPAID: { label: "Sin pagar", bg: COLORS.errorBg, color: COLORS.errorText },
  PARTIAL: { label: "Anticipo", bg: COLORS.warningBg, color: COLORS.warningText },
  PAID: { label: "Pagado", bg: COLORS.successBg, color: COLORS.successText },
  REFUNDED: { label: "Reembolsado", bg: COLORS.bgSection, color: COLORS.textTertiary },
};

/**
 * Tarjeta "Pagos" del detalle de una reservación: un renglón por movimiento
 * con su método, fecha y estado. No pinta nada si no hay pagos registrados.
 *
 * Es solo lectura — cobrar pasa siempre por `usePaymentCheckout` en la
 * pantalla, nunca desde aquí.
 */
export function ReservationPaymentsCard({ payments }: { payments: Payment[] | undefined }) {
  if (!payments || payments.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.sectionCardHeader}>
        <Text style={styles.cardTitle}>Pagos</Text>
        <View style={styles.countChip}>
          <Text style={styles.countChipText}>{payments.length}</Text>
        </View>
      </View>
      {payments.map((p, idx) => {
        const pConfig = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.UNPAID;
        const methodIcon: keyof typeof Ionicons.glyphMap =
          p.method === "CASH"
            ? "cash-outline"
            : p.method === "TRANSFER"
              ? "swap-horizontal-outline"
              : "card-outline";
        const isLast = idx === payments.length - 1;
        return (
          <View key={p.id} style={[styles.paymentRowNew, isLast && styles.paymentRowLast]}>
            <View style={styles.paymentIconWrap}>
              <Ionicons name={methodIcon} size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentAmount}>{formatCurrency(p.amount)}</Text>
              <Text style={styles.paymentMeta}>
                {p.method}
                {p.paidAt ? ` · ${formatDayShort(p.paidAt)}` : ""}
              </Text>
            </View>
            <View style={[styles.paymentBadge, { backgroundColor: pConfig.bg }]}>
              <Text style={[styles.paymentBadgeText, { color: pConfig.color }]}>
                {pConfig.label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
