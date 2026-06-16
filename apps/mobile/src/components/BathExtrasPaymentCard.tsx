import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStripe } from "@stripe/stripe-react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { COLORS } from "@/constants/colors";
import {
  createExtrasPaymentIntent,
  confirmExtrasPayment,
  chooseExtrasPayOnPickup,
  type ReservationAddonWithVariant,
} from "@/lib/api";
import { handlePaymentSheetError } from "@/lib/paymentError";

interface Props {
  reservationId: string;
  addon: ReservationAddonWithVariant;
}

export function BathExtrasPaymentCard({ reservationId, addon }: Props) {
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [paying, setPaying] = useState(false);

  const status = addon.extraPaymentStatus;
  const price = addon.extraPrice ? Number(addon.extraPrice) : 0;
  const deslanadoPrice = addon.extraDeslanadoPrice
    ? Number(addon.extraDeslanadoPrice)
    : null;
  const cortePrice = addon.extraCortePrice
    ? Number(addon.extraCortePrice)
    : null;
  const hasBreakdown = deslanadoPrice !== null || cortePrice !== null;

  const pickupMutation = useMutation({
    mutationFn: () => chooseExtrasPayOnPickup(reservationId, addon.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  async function handlePayNow() {
    setPaying(true);
    try {
      const intent = await createExtrasPaymentIntent(reservationId, addon.id);
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: intent.clientSecret,
        merchantDisplayName: "Holidog Inn",
        applePay: { merchantCountryCode: "MX" },
      });
      if (initError) {
        Alert.alert("Error", initError.message);
        return;
      }
      const { error: payError } = await presentPaymentSheet();
      if (handlePaymentSheetError(payError, "bath-extras")) return;
      await confirmExtrasPayment(reservationId, addon.id, intent.paymentIntentId);
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo procesar el pago";
      Alert.alert("Error", msg);
    } finally {
      setPaying(false);
    }
  }

  function handlePayOnPickup() {
    Alert.alert(
      "Pagar al recoger",
      `Pagarás $${price.toLocaleString("es-MX")} cuando recojas a tu mascota. ¿Confirmas?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: () => pickupMutation.mutate() },
      ],
    );
  }

  if (!addon.extraPrice || !status) return null;
  if (status === "PAID") {
    return (
      <View style={[styles.card, styles.cardPaid]}>
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={22} color={COLORS.successText} />
          <Text style={styles.titlePaid}>
            {addon.extraDescription ?? "Extras"} pagado
          </Text>
        </View>
        <Text style={styles.subtle}>
          ${price.toLocaleString("es-MX")} · recibido
        </Text>
      </View>
    );
  }

  if (status === "PAY_ON_PICKUP") {
    return (
      <View style={[styles.card, styles.cardPickup]}>
        <View style={styles.row}>
          <Ionicons name="cash-outline" size={22} color={COLORS.warningText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.titlePickup}>Pagarás al recoger</Text>
            <Text style={styles.subtle}>
              {addon.extraDescription ?? "Extras"} · ${price.toLocaleString("es-MX")}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // PENDING_PAYMENT
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="water" size={22} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Saldo del baño</Text>
          <Text style={styles.subtitle}>
            Definido por staff según estado del pelaje
          </Text>
        </View>
      </View>
      {hasBreakdown && (
        <View style={styles.breakdown}>
          {deslanadoPrice !== null && (
            <View style={styles.breakdownRow}>
              <Ionicons name="cut-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.breakdownLabel}>Deslanado</Text>
              <Text style={styles.breakdownAmount}>
                ${deslanadoPrice.toLocaleString("es-MX")}
              </Text>
            </View>
          )}
          {cortePrice !== null && (
            <View style={styles.breakdownRow}>
              <Ionicons name="cut" size={14} color={COLORS.textSecondary} />
              <Text style={styles.breakdownLabel}>Corte</Text>
              <Text style={styles.breakdownAmount}>
                ${cortePrice.toLocaleString("es-MX")}
              </Text>
            </View>
          )}
          <View style={styles.breakdownDivider} />
          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, styles.totalLabel]}>Total</Text>
            <Text style={[styles.breakdownAmount, styles.totalAmount]}>
              ${price.toLocaleString("es-MX")}
            </Text>
          </View>
        </View>
      )}
      <Text style={styles.hint}>
        Elige cómo pagarlo:
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, paying && { opacity: 0.7 }]}
          onPress={handlePayNow}
          disabled={paying || pickupMutation.isPending}
        >
          {paying ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <>
              <Ionicons name="card" size={16} color={COLORS.white} />
              <Text style={styles.btnPrimaryText}>Pagar ahora</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={handlePayOnPickup}
          disabled={paying || pickupMutation.isPending}
        >
          <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
          <Text style={styles.btnSecondaryText}>Pagar al recoger</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
