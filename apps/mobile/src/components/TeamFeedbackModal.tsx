import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";

import { COLORS } from "@/constants/colors";
import { sendTeamFeedback } from "@/lib/api";


import { alertaDeError } from "@/lib/errorAlert";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Desde dónde se escribió, para que el admin sepa de qué se habla. */
  screen?: string;
};

/**
 * "¿Qué le falta a la app?" — el canal que hasta ahora era de palabra.
 *
 * Quien está en el mostrador ve los huecos mientras trabaja; si en ese momento
 * no hay dónde escribirlos, se pierden hasta la próxima vez que alguien
 * pregunte. Esto los deja caer en la bandeja de Avisos de los admins.
 */
export function TeamFeedbackModal({ open, onClose, screen }: Props) {
  const [text, setText] = useState("");

  const mutation = useMutation({
    mutationFn: () => sendTeamFeedback({ message: text.trim(), screen }),
    onSuccess: () => {
      setText("");
      onClose();
      Alert.alert(
        "Gracias",
        "Tu comentario le llegó al equipo. Si hace falta más detalle, te van a buscar.",
      );
    },
    onError: (e: Error) =>
      alertaDeError(e, { titulo: "No se pudo enviar", respaldo: "Inténtalo de nuevo." }),
  });

  const puedeEnviar = text.trim().length >= 3 && !mutation.isPending;

  const cerrar = () => {
    if (mutation.isPending) return;
    onClose();
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      transparent
      onRequestClose={cerrar}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="chatbubble-ellipses" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Enviar un comentario</Text>
              <Text style={styles.subtitle}>
                Qué te falta, qué te estorba o qué te confundió
              </Text>
            </View>
            <TouchableOpacity onPress={cerrar} hitSlop={10}>
              <Ionicons name="close" size={22} color={COLORS.textTertiary} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Ej. Al registrar un pago en efectivo no puedo…"
            placeholderTextColor={COLORS.textDisabled}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            autoFocus
            testID="team-feedback-input"
          />

          <TouchableOpacity
            style={[styles.sendBtn, !puedeEnviar && styles.sendBtnDisabled]}
            onPress={() => mutation.mutate()}
            disabled={!puedeEnviar}
            testID="team-feedback-send"
          >
            {mutation.isPending ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="send" size={16} color={COLORS.white} />
                <Text style={styles.sendBtnText}>Enviar</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    textAlignVertical: "top",
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
