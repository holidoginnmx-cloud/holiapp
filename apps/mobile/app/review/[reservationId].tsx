import { COLORS } from "@/constants/colors";
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createReview } from "@/lib/api";

export default function ReviewScreen() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createReview({
        rating,
        comment: comment.trim() || null,
        reservationId: reservationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["reservation", reservationId],
      });
      Alert.alert("Gracias", "Tu reseña fue enviada exitosamente", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.iconHeader}>
        <Ionicons name="star" size={40} color={COLORS.primary} />
      </View>

      <Text style={styles.title}>¿Cómo fue la experiencia?</Text>
      <Text style={styles.subtitle}>
        Tu opinión nos ayuda a mejorar el servicio
      </Text>

      {/* Paw rating */}
      <View style={styles.pawContainer}>
        {[1, 2, 3, 4, 5].map((i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setRating(i)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={i <= rating ? "paw" : "paw-outline"}
              size={44}
              color={i <= rating ? COLORS.primary : COLORS.border}
            />
          </TouchableOpacity>
        ))}
      </View>

      {rating > 0 && (
        <Text style={styles.ratingLabel}>
          {rating === 1
            ? "Malo"
            : rating === 2
              ? "Regular"
              : rating === 3
                ? "Bueno"
                : rating === 4
                  ? "Muy bueno"
                  : "Excelente"}
        </Text>
      )}

      {/* Comment */}
      <View style={styles.commentSection}>
        <Text style={styles.label}>Comentarios (opcional)</Text>
        <TextInput
          style={styles.textArea}
          value={comment}
          onChangeText={setComment}
          placeholder="Cuéntanos más sobre la estancia de tu mascota..."
          placeholderTextColor={COLORS.textDisabled}
          multiline
          numberOfLines={5}
        />
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[
          styles.submitButton,
          (rating === 0 || mutation.isPending) && { opacity: 0.5 },
        ]}
        onPress={() => mutation.mutate()}
        disabled={rating === 0 || mutation.isPending}
        activeOpacity={0.8}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="send" size={20} color={COLORS.white} />
            <Text style={styles.submitText}>Enviar reseña</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  contentContainer: {
    padding: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  iconHeader: {
    marginTop: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textTertiary,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 32,
  },
  pawContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  ratingLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 24,
  },
  commentSection: {
    width: "100%",
    gap: 8,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  textArea: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    minHeight: 120,
    textAlignVertical: "top",
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    width: "100%",
  },
  submitText: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.white,
  },
});
