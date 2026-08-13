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
import { COLORS } from "@/constants/colors";

export interface AmountEditValues {
  amount: number;
  reason?: string;
}

interface AmountEditModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * El padre dispara su mutación. El modal NO se cierra solo: lo cierra el padre
   * en el onSuccess, para que ante un error siga abierto y permita reintentar
   * (mismo contrato que PaymentManualModal).
   */
  onSubmit: (values: AmountEditValues) => void;
  submitting?: boolean;
  /** Valor a prellenar. Se aplica cada vez que el modal pasa de oculto a visible. */
  initialAmount?: string;
  title?: string;
  label?: string;
  /** Texto de ayuda bajo el campo (p. ej. la advertencia de los extras de baño). */
  hint?: string;
}

/**
 * Corregir un monto ya guardado (el total de una reserva).
 *
 * Gemelo de PaymentManualModal pero con dos diferencias que importan:
 *  - acepta 0 (regalar un servicio es válido; registrar un pago de $0 no),
 *  - pide un motivo, que viaja al aviso del equipo y deja rastro de por qué
 *    cambió el precio.
 */
export function AmountEditModal({
  visible,
  onClose,
  onSubmit,
  submitting = false,
  initialAmount,
  title = "Editar total",
  label = "Total",
  hint,
}: AmountEditModalProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (visible) {
      setAmount(initialAmount ?? "");
      setReason("");
    }
    // initialAmount se lee al abrir; no resetear a mitad de edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const parsed = parseFloat(amount);
  // `>= 0`: un total de cero es legítimo (todo de cortesía).
  const isValid = Number.isFinite(parsed) && parsed >= 0;

  function handleSubmit() {
    if (!isValid || submitting) return;
    onSubmit({ amount: parsed, reason: reason.trim() || undefined });
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

            <Text style={styles.inputLabel}>{label}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="0.00"
              placeholderTextColor={COLORS.textDisabled}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              autoFocus
            />
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}

            <Text style={styles.inputLabel}>Motivo (opcional)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Descuento olvidado, cortesía, ajuste…"
              placeholderTextColor={COLORS.textDisabled}
              value={reason}
              onChangeText={setReason}
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
                  (!isValid || submitting) && { opacity: 0.5 },
                ]}
                onPress={handleSubmit}
                disabled={!isValid || submitting}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {submitting ? "Guardando..." : "Guardar"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    textAlignVertical: "top",
  },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 6,
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
