import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

export type ManualPaymentMethod = "CASH" | "TRANSFER";

export interface ManualPaymentValues {
  amount: number;
  method: ManualPaymentMethod;
  notes?: string;
}

interface PaymentManualModalProps {
  visible: boolean;
  /** Cierra el modal (overlay, botón Cancelar, back de Android). */
  onClose: () => void;
  /**
   * El padre dispara su propia mutación con estos valores. El modal NO se cierra
   * solo: el cierre lo hace el padre en el onSuccess de su mutación (igual que
   * antes), para que ante un error el modal siga abierto y permita reintentar.
   */
  onSubmit: (values: ManualPaymentValues) => void;
  /** `isPending` de la mutación del padre: deshabilita botones y cambia el label. */
  submitting?: boolean;
  /**
   * Monto a prellenar al abrir (p.ej. el saldo pendiente). Si se omite, el
   * campo abre vacío. Se aplica cada vez que el modal pasa de oculto a visible.
   */
  initialAmount?: string;
  title?: string;
}

/**
 * Modal reutilizable de "Registrar pago manual" (monto + método efectivo/
 * transferencia + notas). Extraído de las pantallas admin/reservation/[id],
 * staff/stay/[id] y staff/bath/[id], donde era casi byte-idéntico. La mutación
 * que registra el pago (y su invalidación/Alert) se queda en cada padre vía
 * `onSubmit`; este componente solo captura los datos del formulario.
 */
export function PaymentManualModal({
  visible,
  onClose,
  onSubmit,
  submitting = false,
  initialAmount,
  title = "Registrar pago manual",
}: PaymentManualModalProps) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ManualPaymentMethod>("CASH");
  const [notes, setNotes] = useState("");

  // Resetea el formulario cada vez que se abre, reproduciendo lo que antes hacía
  // cada pantalla al abrir su modal (prellenar saldo o dejar vacío).
  useEffect(() => {
    if (visible) {
      setAmount(initialAmount ?? "");
      setMethod("CASH");
      setNotes("");
    }
    // initialAmount se lee al abrir; no resetear a mitad de edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const parsed = parseFloat(amount);
  const isAmountValid = Number.isFinite(parsed) && parsed > 0;

  function handleSubmit() {
    if (!isAmountValid || submitting) return;
    onSubmit({ amount: parsed, method, notes: notes.trim() || undefined });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          style={styles.modalKav}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.modalContent}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>{title}</Text>

            <Text style={styles.inputLabel}>Monto</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="0.00"
              placeholderTextColor={COLORS.textDisabled}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />

            <Text style={styles.inputLabel}>Método</Text>
            <View style={styles.methodRow}>
              {(["CASH", "TRANSFER"] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.methodChip,
                    method === m && styles.methodChipActive,
                  ]}
                  onPress={() => setMethod(m)}
                >
                  <Ionicons
                    name={
                      m === "CASH" ? "cash-outline" : "swap-horizontal-outline"
                    }
                    size={16}
                    color={method === m ? COLORS.white : COLORS.textTertiary}
                  />
                  <Text
                    style={[
                      styles.methodChipText,
                      method === m && { color: COLORS.white },
                    ]}
                  >
                    {m === "CASH" ? "Efectivo" : "Transferencia"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Notas (opcional)</Text>
            <TextInput
              style={[styles.modalInput, { minHeight: 60 }]}
              placeholder="Referencia, número de operación, etc."
              placeholderTextColor={COLORS.textDisabled}
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={onClose}
                disabled={submitting}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtnConfirm,
                  (!isAmountValid || submitting) && { opacity: 0.5 },
                ]}
                onPress={handleSubmit}
                disabled={!isAmountValid || submitting}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {submitting ? "Registrando..." : "Registrar"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// Valores idénticos a los de las 3 hojas de estilo originales (modal*/payModal*).
const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalKav: {
    width: "100%",
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 6,
    marginTop: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlignVertical: "top",
  },
  methodRow: {
    flexDirection: "row",
    gap: 10,
  },
  methodChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  methodChipActive: {
    backgroundColor: COLORS.primary,
  },
  methodChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalBtnCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  modalBtnCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  modalBtnConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  modalBtnConfirmText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.white,
  },
});
