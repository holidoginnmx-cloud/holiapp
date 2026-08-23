import { Text, StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { COLORS } from "@/constants/colors";
import { formatCurrencyExact } from "@/lib/format";
import {
  paymentFeeBreakdown,
  type PaymentWithFees,
} from "@holidoginn/shared/src/paymentFees";
import { useAuthStore } from "@/store/authStore";

/**
 * Línea al pie de un renglón de pago: cuánto se quedó la pasarela y cuánto
 * llegó de verdad al negocio. El monto grande del renglón sigue siendo el
 * bruto (lo que pagó el cliente y contra lo que se mide el saldo), así que
 * aquí solo va la diferencia.
 *
 * Solo ADMIN: el costo de pasarela es información del negocio, no del turno.
 * El equipo sigue viendo el bruto, que es lo que necesita para cobrar.
 *
 * No renderiza nada cuando no hay comisión (efectivo, transferencia, o un
 * cobro con tarjeta que Stripe todavía no concilia).
 */
export function PaymentFeeNote({
  payment,
  style,
  testID = "payment-fee-note",
}: {
  payment: PaymentWithFees | null | undefined;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const role = useAuthStore((s) => s.role);
  const fees = paymentFeeBreakdown(payment);
  if (role !== "ADMIN" || !fees) return null;
  return (
    <Text style={[styles.note, style]} testID={testID}>
      Comisión −{formatCurrencyExact(fees.fee)} · neto{" "}
      {formatCurrencyExact(fees.net)}
    </Text>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 11,
    color: COLORS.textDisabled,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
});
