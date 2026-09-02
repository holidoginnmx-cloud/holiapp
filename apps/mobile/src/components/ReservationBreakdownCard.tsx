import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  buildReservationBreakdown,
  type BreakdownInput,
} from "@holidoginn/shared";
import { COLORS } from "@/constants/colors";
import { formatCurrency } from "@/lib/format";

/**
 * "Desglose del cobro": qué incluye lo que el cliente paga.
 *
 * El equipo ya lo veía en su propio detalle; el cliente solo veía una cifra
 * suelta. El cálculo vive en @holidoginn/shared (buildReservationBreakdown)
 * para que las dos pantallas digan exactamente lo mismo.
 *
 * `variant`:
 *   - "detail"  → dentro del card de info, arriba del Total.
 *   - "payment" → dentro del banner de saldo, para que se vea QUÉ se paga
 *                 antes de tocar el botón. Sin fondo propio (ya va sobre el
 *                 ámbar del banner) y con el total repetido al pie.
 */
export function ReservationBreakdownCard({
  reservation,
  variant = "detail",
  title = "Desglose del cobro",
}: {
  reservation: BreakdownInput;
  variant?: "detail" | "payment";
  title?: string;
}) {
  const { rows, total } = buildReservationBreakdown(reservation, {
    formatMoney: formatCurrency,
  });

  // Una sola línea que repite el total no explica nada; en ese caso el "Total"
  // que ya está debajo se basta solo.
  if (rows.length < 2 && variant === "detail") return null;
  if (rows.length === 0) return null;

  const onBanner = variant === "payment";

  return (
    <View style={[styles.box, onBanner && styles.boxOnBanner]}>
      <Text style={[styles.title, onBanner && styles.titleOnBanner]}>
        {title}
      </Text>
      {rows.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text
            style={[styles.label, onBanner && styles.labelOnBanner]}
            numberOfLines={2}
          >
            {r.label}
            {r.isCourtesy ? " · Cortesía" : ""}
          </Text>
          {r.isCourtesy ? (
            <View style={styles.courtesyValue}>
              {r.listPrice ? (
                <Text style={styles.listPrice}>{formatCurrency(r.listPrice)}</Text>
              ) : null}
              <Text style={styles.courtesyText}>Gratis</Text>
            </View>
          ) : (
            <Text
              style={[
                styles.value,
                onBanner && styles.valueOnBanner,
                r.negative && styles.negative,
              ]}
            >
              {r.negative ? "−" : ""}
              {formatCurrency(r.amount)}
            </Text>
          )}
        </View>
      ))}
      {onBanner && (
        <View style={styles.bannerTotalRow}>
          <Text style={styles.bannerTotalLabel}>Total de la reserva</Text>
          <Text style={styles.bannerTotalValue}>{formatCurrency(total)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 12,
    marginTop: 12,
    gap: 6,
  },
  boxOnBanner: {
    borderTopColor: COLORS.warningText,
    marginTop: 4,
    paddingTop: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  titleOnBanner: {
    color: COLORS.warningText,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  labelOnBanner: {
    color: COLORS.textPrimary,
  },
  value: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  valueOnBanner: {
    fontWeight: "700",
  },
  negative: {
    color: COLORS.successText,
  },
  courtesyValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  listPrice: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textDecorationLine: "line-through",
  },
  courtesyText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.successText,
  },
  bannerTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.warningText,
    paddingTop: 8,
    marginTop: 4,
  },
  bannerTotalLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.warningText,
  },
  bannerTotalValue: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
  },
});
