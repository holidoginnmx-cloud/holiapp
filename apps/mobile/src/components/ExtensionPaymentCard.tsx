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
  changeRequestPayNowIntent,
  changeRequestPayNowConfirm,
  changeRequestPayOnPickup,
  type ChangeRequest,
} from "@/lib/api";

interface Props {
  reservationId: string;
  changeRequest: ChangeRequest;
}

export function ExtensionPaymentCard({ reservationId, changeRequest }: Props) {
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [paying, setPaying] = useState(false);

  const amount = Number(changeRequest.deltaAmount);

  const pickupMutation = useMutation({
    mutationFn: () =>
      changeRequestPayOnPickup(reservationId, changeRequest.id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["reservation", reservationId, "change-requests"],
      });
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  async function handlePayNow() {
    setPaying(true);
    try {
      const intent = await changeRequestPayNowIntent(reservationId, changeRequest.id);
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
      if (payError) {
        if (payError.code !== "Canceled") {
          Alert.alert("Error de pago", payError.message);
        }
        return;
      }
      await changeRequestPayNowConfirm(
        reservationId,
        changeRequest.id,
        intent.paymentIntentId,
      );
      queryClient.invalidateQueries({
        queryKey: ["reservation", reservationId, "change-requests"],
      });
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
      `Pagarás $${amount.toLocaleString("es-MX")} cuando recojas a tu mascota. ¿Confirmas?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: () => pickupMutation.mutate() },
      ],
    );
  }

  if (changeRequest.status !== "APPROVED" || amount <= 0) return null;

  if (changeRequest.paidAt) {
    return (
      <View style={[styles.card, styles.cardPaid]}>
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={22} color={COLORS.successText} />
          <Text style={styles.titlePaid}>Extensión pagada</Text>
        </View>
        <Text style={styles.subtle}>${amount.toLocaleString("es-MX")} · recibido</Text>
      </View>
    );
  }

  if (changeRequest.payOnPickup) {
    return (
      <View style={[styles.card, styles.cardPickup]}>
        <View style={styles.row}>
          <Ionicons name="cash-outline" size={22} color={COLORS.warningText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.titlePickup}>Pagarás al recoger</Text>
            <Text style={styles.subtle}>
              Saldo de extensión · ${amount.toLocaleString("es-MX")}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="calendar" size={22} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Saldo por extensión</Text>
          <Text style={styles.subtitle}>
            Días extra aprobados por el equipo
          </Text>
        </View>
        <Text style={styles.price}>${amount.toLocaleString("es-MX")}</Text>
      </View>
      <Text style={styles.hint}>
        Tu solicitud de extensión fue aprobada. Elige cómo pagar el saldo:
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
