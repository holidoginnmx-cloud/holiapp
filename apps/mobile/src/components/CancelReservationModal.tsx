import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelReservation } from "@/lib/api";

type RefundChoice = "STRIPE_REFUND" | "CREDIT";

interface CancelReservationModalProps {
  visible: boolean;
  reservationId: string;
  petName: string;
  refundAmount: number;
  allowStripeRefund: boolean;
  onClose: () => void;
}

function formatMoney(n: number): string {
  return `$${Number(n).toLocaleString("es-MX")}`;
}

export function CancelReservationModal({
  visible,
  reservationId,
  petName,
  refundAmount,
  allowStripeRefund,
  onClose,
}: CancelReservationModalProps) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<RefundChoice>(
    allowStripeRefund ? "STRIPE_REFUND" : "CREDIT"
  );

  const mutation = useMutation({
    mutationFn: () => cancelReservation(reservationId, choice),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["reservation", reservationId] });
      qc.invalidateQueries({ queryKey: ["credit-ledger"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      Alert.alert(
        "Reservación cancelada",
        res.refundAmount > 0
          ? `Se procesaron ${formatMoney(res.refundAmount)} como ${
              res.refundChoice === "STRIPE_REFUND"
                ? "reembolso a tarjeta"
                : "saldo a favor"
            }.`
          : "Tu reservación fue cancelada."
      );
      onClose();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const handleConfirm = () => {
    Alert.alert(
      "Cancelar reservación",
      "Esta acción no se puede deshacer. ¿Continuar?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Sí, cancelar",
          style: "destructive",
          onPress: () => mutation.mutate(),
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Cancelar reservación</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={COLORS.textTertiary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>
            Estás por cancelar la reservación de {petName}.
          </Text>

          {refundAmount > 0 ? (
            <>
              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>Monto a reembolsar</Text>
                <Text style={styles.amountValue}>{formatMoney(refundAmount)}</Text>
              </View>

              <Text style={styles.sectionTitle}>¿Cómo recibirlo?</Text>
              {allowStripeRefund && (
                <TouchableOpacity
                  style={[
                    styles.choiceRow,
                    choice === "STRIPE_REFUND" && styles.choiceRowActive,
                  ]}
                  onPress={() => setChoice("STRIPE_REFUND")}
                >
                  <Ionicons
                    name={
                      choice === "STRIPE_REFUND"
                        ? "radio-button-on"
                        : "radio-button-off"
                    }
                    size={20}
                    color={COLORS.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceLabel}>Reembolso a tarjeta</Text>
                    <Text style={styles.choiceSubtitle}>5 a 10 días hábiles</Text>
                  </View>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.choiceRow,
                  choice === "CREDIT" && styles.choiceRowActive,
                ]}
                onPress={() => setChoice("CREDIT")}
              >
                <Ionicons
                  name={choice === "CREDIT" ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={COLORS.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceLabel}>Saldo a favor</Text>
                  <Text style={styles.choiceSubtitle}>
                    Se aplica en tu próxima reservación
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.body}>
              No hay monto pagado que reembolsar.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.confirmButton, mutation.isPending && { opacity: 0.5 }]}
            onPress={handleConfirm}
            disabled={mutation.isPending}
            activeOpacity={0.85}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.confirmText}>Cancelar reservación</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backButton}
            onPress={onClose}
            disabled={mutation.isPending}
          >
            <Text style={styles.backText}>No, volver</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginBottom: 12,
    lineHeight: 20,
  },
  amountBox: {
    backgroundColor: COLORS.bgPage,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    alignItems: "center",
  },
  amountLabel: { fontSize: 12, color: COLORS.textTertiary, fontWeight: "600" },
  amountValue: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.primary,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 8,
  },
  choiceRowActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.reviewBg,
  },
  choiceLabel: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  choiceSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  confirmButton: {
    backgroundColor: COLORS.errorText,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  confirmText: { color: COLORS.white, fontSize: 16, fontWeight: "700" },
  backButton: { alignItems: "center", paddingVertical: 12 },
  backText: { fontSize: 14, fontWeight: "600", color: COLORS.textTertiary },
});
