import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createReview } from "@/lib/api";

const RATING_LABELS: Record<number, string> = {
  1: "Malo",
  2: "Regular",
  3: "Bueno",
  4: "Muy bueno",
  5: "Excelente",
};

interface ReviewPromptModalProps {
  visible: boolean;
  reservationId: string;
  onDismiss: () => void;
}

export function ReviewPromptModal({
  visible,
  reservationId,
  onDismiss,
}: ReviewPromptModalProps) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createReview({
        rating,
        comment: comment.trim() || null,
        reservationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", reservationId] });
      Alert.alert("Gracias", "Tu reseña fue enviada exitosamente");
      setRating(5);
      setComment("");
      onDismiss();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View style={styles.headerRow}>
              <Ionicons name="paw" size={28} color={COLORS.primary} />
              <TouchableOpacity onPress={onDismiss} hitSlop={10}>
                <Ionicons name="close" size={24} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.title}>¿Cómo fue la experiencia?</Text>
            <Text style={styles.subtitle}>
              Tu opinión nos ayuda a mejorar el servicio
            </Text>

            <View style={styles.pawRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => setRating(i)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={i <= rating ? "paw" : "paw-outline"}
                    size={40}
                    color={i <= rating ? COLORS.primary : COLORS.border}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text>

            <Text style={styles.commentLabel}>Comentarios (opcional)</Text>
            <TextInput
              style={styles.textArea}
              value={comment}
              onChangeText={setComment}
              placeholder="Cuéntanos más sobre la estancia de tu mascota..."
              placeholderTextColor={COLORS.textDisabled}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={[
                styles.submitButton,
                mutation.isPending && { opacity: 0.6 },
              ]}
              onPress={() => mutation.mutate()}
              disabled={mutation.isPending}
              activeOpacity={0.85}
            >
              {mutation.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="send" size={18} color={COLORS.white} />
                  <Text style={styles.submitText}>Enviar reseña</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.laterButton}
              onPress={onDismiss}
              disabled={mutation.isPending}
            >
              <Text style={styles.laterText}>Más tarde</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
    maxHeight: "90%",
  },
  content: {
    padding: 22,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 22,
  },
  pawRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 10,
  },
  ratingLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 20,
  },
  commentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  textArea: {
    backgroundColor: COLORS.bgPage,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 18,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  submitText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
  laterButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 6,
  },
  laterText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
});
