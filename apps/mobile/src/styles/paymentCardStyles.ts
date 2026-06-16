import { StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

/**
 * Estilos compartidos por la tarjeta de pago de saldo pendiente PaymentCardFlow
 * (que fusiona la lógica de las antiguas BathExtrasPaymentCard y
 * ExtensionPaymentCard). Las claves `breakdown*`/`total*` solo las usa el
 * desglose del baño; `price` solo el encabezado de la extensión.
 */
export const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.warningText,
    shadowColor: COLORS.warningText,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 2,
    gap: 12,
  },
  cardPaid: {
    borderColor: COLORS.successBg,
    shadowOpacity: 0,
  },
  cardPickup: {
    borderColor: COLORS.warningBg,
    shadowOpacity: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  titlePaid: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.successText,
  },
  titlePickup: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.warningText,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "600",
    marginTop: 2,
  },
  subtle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  price: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.warningText,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  breakdown: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  breakdownLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  breakdownAmount: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
  },
  totalLabel: {
    color: COLORS.textPrimary,
    fontWeight: "800",
  },
  totalAmount: {
    color: COLORS.warningText,
    fontSize: 16,
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
  },
  btnPrimaryText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "700",
  },
  btnSecondary: {
    backgroundColor: COLORS.primaryLight,
  },
  btnSecondaryText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "700",
  },
});
