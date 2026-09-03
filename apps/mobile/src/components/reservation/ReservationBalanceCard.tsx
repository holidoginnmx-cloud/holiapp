import type { ReactNode } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import type { ReservationDetail } from "@/lib/api";
import { formatCurrency, formatName } from "@/lib/format";
import { ReservationBreakdownCard } from "@/components/ReservationBreakdownCard";
import { styles } from "@/styles/ownerReservationDetailStyles";

type ReservationBalanceCardProps = {
  reservation: ReservationDetail;
  /** Lo que falta por cubrir. */
  remainingBalance: number;
  /** Lo ya cobrado (PAID + PARTIAL); si es 0 no se pinta el renglón. */
  totalPaid: number;
  /** La visita ya concluyó y quedó saldo. */
  balanceAfterCheckout: boolean;
  /** El saldo viene de una extensión aprobada, no de un anticipo. */
  balanceFromExtension: boolean;
  /** ¿El botón está cobrando ahora mismo? */
  paying: boolean;
  /** Deshabilita el botón (cobrando, o con una confirmación pendiente). */
  disabled: boolean;
  onPay: () => void;
  /** Avisos del cobro (hoja atorada / confirmación pendiente) de la pantalla. */
  children?: ReactNode;
};

/**
 * Banner de saldo pendiente del detalle: cuánto falta, por qué, qué se está
 * pagando y el botón para liquidarlo.
 *
 * El cobro NO vive aquí: `onPay` lo dispara la pantalla, que es quien tiene
 * `usePaymentCheckout` — la ÚNICA vía para presentar la hoja de Stripe. Los
 * avisos de ese hook entran por `children` para que salgan dentro del banner.
 */
export function ReservationBalanceCard({
  reservation,
  remainingBalance,
  totalPaid,
  balanceAfterCheckout,
  balanceFromExtension,
  paying,
  disabled,
  onPay,
  children,
}: ReservationBalanceCardProps) {
  return (
    <View style={styles.balanceBanner}>
      <View style={styles.balanceBannerHeader}>
        <Ionicons name="warning-outline" size={20} color={COLORS.warningText} />
        <Text style={styles.balanceBannerTitle}>
          {balanceFromExtension ? "Saldo por extensión" : "Saldo pendiente"}
        </Text>
      </View>
      <Text style={styles.balanceBannerAmount}>
        {formatCurrency(remainingBalance)} MXN
      </Text>
      {balanceAfterCheckout ? (
        <Text style={styles.balanceBannerWarning}>
          La visita de {formatName(reservation.pet?.name ?? "tu mascota")} ya
          terminó y quedó este saldo por cubrir. Puedes pagarlo aquí mismo.
        </Text>
      ) : balanceFromExtension ? (
        <Text style={styles.balanceBannerWarning}>
          Corresponde a los días agregados tras la extensión aprobada.
        </Text>
      ) : (
        <Text style={styles.balanceBannerWarning}>
          Puedes liquidarlo aquí en la app o al entregar a tu mascota en la sucursal de Holidog Inn.
        </Text>
      )}

      {/* Qué se está pagando: total, lo ya cubierto y el desglose de
          conceptos. Antes solo se veía la cifra del saldo, sin explicación. */}
      {totalPaid > 0 && (
        <View style={styles.balancePaidRow}>
          <Text style={styles.balancePaidLabel}>Ya pagaste</Text>
          <Text style={styles.balancePaidValue}>{formatCurrency(totalPaid)}</Text>
        </View>
      )}
      <ReservationBreakdownCard
        reservation={reservation}
        variant="payment"
        title="Qué estás pagando"
      />

      <TouchableOpacity
        style={[styles.balanceButton, disabled && { opacity: 0.5 }]}
        onPress={onPay}
        disabled={disabled}
        activeOpacity={0.8}
      >
        {paying ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="card-outline" size={20} color={COLORS.white} />
            <Text style={styles.balanceButtonText}>
              {balanceAfterCheckout ? "Pagar saldo" : "Liquidar saldo"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {children}
    </View>
  );
}
