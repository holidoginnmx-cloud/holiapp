import { StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

/**
 * Base de estilos compartida por los wizards de creación (guardería, baño,
 * hospedaje…). Contiene únicamente las piezas que se repiten entre wizards:
 * layout de pantalla, tarjetas de mascota, filas de toggle, domicilio,
 * tarjeta de precios, código de descuento y botón de pagar.
 *
 * Lo específico de cada wizard (banners de cupo, horarios, etc.) vive como
 * override/local en la hoja o el archivo del wizard correspondiente.
 */
export const wizardStyles = StyleSheet.create({
  // ── Layout ──
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 60, gap: 8 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginTop: 18,
    marginBottom: 8,
  },

  // ── Selección de mascotas ──
  petList: { gap: 8 },
  petCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  petCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  petAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  petMeta: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.warningBg,
    padding: 14,
    borderRadius: 12,
  },
  emptyText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.warningText },

  // ── Fecha ──
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
  },
  dateText: { flex: 1, fontSize: 15, color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_600SemiBold" },

  // ── Toggles (add-ons, domicilio) ──
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  toggleRowActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  toggleTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  toggleSub: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },

  // ── Servicio a domicilio ──
  deliveryFeeText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  deliveryQuoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deliveryQuoteText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },

  // ── Tarjeta de precios ──
  priceCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginTop: 6,
    gap: 8,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: { fontSize: 14, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_600SemiBold", flexShrink: 1 },
  priceValue: { fontSize: 20, fontFamily: "Outfit_600SemiBold", color: COLORS.primary },
  priceLineValue: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  priceDivider: {
    height: 1,
    backgroundColor: COLORS.bgSection,
    marginVertical: 12,
  },

  // ── Código de descuento ──
  discountRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  discountInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    backgroundColor: "#fff",
  },
  discountApplyBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  discountApplyBtnDisabled: { opacity: 0.5 },
  discountApplyText: { color: COLORS.primary, fontFamily: "PlusJakartaSans_700Bold", fontSize: 14 },
  discountAppliedValue: { flexDirection: "row", alignItems: "center", gap: 8 },
  discountValueText: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.successText },

  // ── Botón pagar ──
  payButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
  },
  payButtonDisabled: {
    backgroundColor: COLORS.textDisabled,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
