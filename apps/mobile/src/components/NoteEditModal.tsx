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

interface NoteEditModalProps {
  visible: boolean;
  onClose: () => void;
  /** `null` = borrar la nota. El padre cierra el modal en su onSuccess. */
  onSubmit: (value: string | null) => void;
  submitting?: boolean;
  initialValue?: string | null;
  title?: string;
  placeholder?: string;
  /** Aclaración de quién la ve, para no confundir la interna con la del cliente. */
  hint?: string;
  maxLength?: number;
}

/**
 * Editor de texto libre para las tres notas del detalle de una reserva: la
 * interna del equipo, la del cliente y la de un servicio concreto. Un solo
 * componente porque las tres son el mismo formulario con distinta etiqueta.
 */
export function NoteEditModal({
  visible,
  onClose,
  onSubmit,
  submitting = false,
  initialValue,
  title = "Nota",
  placeholder = "Escribe una nota…",
  hint,
  maxLength = 2000,
}: NoteEditModalProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (visible) setValue(initialValue ?? "");
    // initialValue se lee al abrir; no resetear a mitad de edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function handleSubmit() {
    if (submitting) return;
    const trimmed = value.trim();
    // Vaciar el campo borra la nota; guardar "" dejaría una cadena vacía que la
    // UI tendría que tratar como ausente en cada sitio donde la pinta.
    onSubmit(trimmed.length > 0 ? trimmed : null);
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
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}

            <TextInput
              style={styles.modalInput}
              placeholder={placeholder}
              placeholderTextColor={COLORS.textDisabled}
              value={value}
              onChangeText={setValue}
              multiline
              maxLength={maxLength}
              autoFocus
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
                style={[styles.modalBtnConfirm, submitting && { opacity: 0.5 }]}
                onPress={handleSubmit}
                disabled={submitting}
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
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    minHeight: 110,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    textAlignVertical: "top",
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
