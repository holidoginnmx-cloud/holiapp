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
import { REVIEW_COPY, reviewWho } from "@holidoginn/shared";
import { createReview, snoozeReview } from "@/lib/api";
import { PawRating, RATING_LABELS } from "./PawRating";
import { maybePromptStoreReview } from "@/lib/storeReview";

export type ReviewTarget = {
  /** Reservaciones de la visita (una por mascota). Se califica UNA vez. */
  reservationIds: string[];
  reservationType: "STAY" | "BATH" | "DAYCARE";
  petNames: string[];
};

interface ReviewPromptModalProps {
  visible: boolean;
  target: ReviewTarget;
  /** Para el gate de la invitación a la tienda (clave por usuario). */
  userId?: string | null;
  /** `snoozed` = el cliente tocó "Más tarde" (no volver a abrirlo en la sesión). */
  onDismiss: (result: "snoozed" | "submitted" | "closed") => void;
}

export function ReviewPromptModal({
  visible,
  target,
  userId,
  onDismiss,
}: ReviewPromptModalProps) {
  const queryClient = useQueryClient();
  // Arranca en 0, no en 5: precargarlo en "Excelente" sesga el resultado y un
  // toque accidental en Enviar registraba 5 patitas que nadie eligió.
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const reservationId = target.reservationIds[0];
  const copy = REVIEW_COPY[target.reservationType] ?? REVIEW_COPY.STAY;
  const who = reviewWho(target.petNames);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["reviews", "pending"] });
    queryClient.invalidateQueries({ queryKey: ["reservations"] });
    for (const id of target.reservationIds) {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      createReview({
        rating,
        comment: comment.trim() || null,
        reservationId,
      }),
    onSuccess: () => {
      invalidate();
      const enviado = rating;
      setRating(0);
      setComment("");
      onDismiss("submitted");
      // La alerta va DESPUÉS de cerrar el modal, y la invitación a la tienda
      // desde el onPress: dos Alert en el mismo tick se pisan en iOS.
      Alert.alert("¡Gracias! 🐾", "Tu reseña nos ayuda muchísimo.", [
        {
          text: "Listo",
          onPress: () => void maybePromptStoreReview(userId, enviado),
        },
      ]);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const snooze = useMutation({
    mutationFn: () => snoozeReview(reservationId),
    // Se cierra igual si falla: el "Más tarde" no puede dejar al cliente
    // atrapado en el modal por un error de red.
    onSettled: () => {
      invalidate();
      onDismiss("snoozed");
    },
  });

  const busy = mutation.isPending || snooze.isPending;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => onDismiss("closed")}
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
              <TouchableOpacity
                onPress={() => onDismiss("closed")}
                hitSlop={10}
                disabled={busy}
              >
                <Ionicons name="close" size={24} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.title}>{copy.modalTitle}</Text>
            <Text style={styles.subtitle}>
              {target.petNames.length > 1
                ? `Tu reseña aplica a la visita de ${who}`
                : copy.modalSubtitle}
            </Text>

            <View style={styles.pawRow}>
              <PawRating value={rating} onChange={setRating} size={40} />
            </View>

            <Text
              style={[
                styles.ratingLabel,
                rating === 0 && styles.ratingLabelEmpty,
              ]}
            >
              {RATING_LABELS[rating]}
            </Text>

            <Text style={styles.commentLabel}>Comentarios (opcional)</Text>
            <TextInput
              style={styles.textArea}
              value={comment}
              onChangeText={setComment}
              placeholder={copy.placeholder(who)}
              placeholderTextColor={COLORS.textDisabled}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={[
                styles.submitButton,
                (busy || rating === 0) && { opacity: 0.5 },
              ]}
              onPress={() => mutation.mutate()}
              disabled={busy || rating === 0}
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
              onPress={() => snooze.mutate()}
              disabled={busy}
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
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 22,
  },
  pawRow: {
    marginBottom: 10,
  },
  ratingLabel: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
    textAlign: "center",
    marginBottom: 20,
  },
  ratingLabelEmpty: {
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  commentLabel: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  laterButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 6,
  },
  laterText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
});
