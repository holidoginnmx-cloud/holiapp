import { COLORS } from "@/constants/colors";
import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getReservationById,
  previewChangeRequest,
  createChangeRequest,
  type ChangePreview,
} from "@/lib/api";

type RefundChoice = "STRIPE_REFUND" | "CREDIT";

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function formatShort(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatMoney(n: number): string {
  return `$${Number(n).toLocaleString("es-MX")}`;
}

export default function ModifyReservationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: reservation, isLoading } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const [newCheckIn, setNewCheckIn] = useState<Date | null>(null);
  const [newCheckOut, setNewCheckOut] = useState<Date | null>(null);
  const [showCheckInPicker, setShowCheckInPicker] = useState(false);
  const [showCheckOutPicker, setShowCheckOutPicker] = useState(false);
  const [refundChoice, setRefundChoice] = useState<RefundChoice>("CREDIT");
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const isCheckedIn = reservation?.status === "CHECKED_IN";
  const today = useMemo(() => startOfDay(new Date()), []);

  useEffect(() => {
    if (reservation?.checkIn && reservation?.checkOut) {
      setNewCheckIn(new Date(reservation.checkIn));
      setNewCheckOut(new Date(reservation.checkOut));
    }
  }, [reservation]);

  // Debounced preview
  useEffect(() => {
    if (!newCheckIn || !newCheckOut || !id) return;
    if (newCheckOut <= newCheckIn) {
      setPreview(null);
      setPreviewError("La salida debe ser posterior a la entrada");
      return;
    }
    const handle = setTimeout(async () => {
      try {
        setPreviewError(null);
        const result = await previewChangeRequest(id, {
          newCheckIn: newCheckIn.toISOString(),
          newCheckOut: newCheckOut.toISOString(),
        });
        setPreview(result);
      } catch (e: any) {
        setPreview(null);
        setPreviewError(e.message);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [newCheckIn, newCheckOut, id]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!id || !newCheckIn || !newCheckOut) throw new Error("Fechas incompletas");
      return createChangeRequest(id, {
        newCheckIn: newCheckIn.toISOString(),
        newCheckOut: newCheckOut.toISOString(),
        refundChoice: preview && preview.delta < 0 ? refundChoice : null,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["reservation", id] });
      qc.invalidateQueries({ queryKey: ["reservation", id, "change-requests"] });
      qc.invalidateQueries({ queryKey: ["credit-ledger"] });
      qc.invalidateQueries({ queryKey: ["me"] });

      let title = "Cambio aplicado";
      let body = "Tu cambio quedó aplicado.";
      if (res.requiresApproval) {
        title = "Solicitud enviada";
        body = "El admin revisará tu solicitud y te avisará.";
      } else if (preview && preview.delta < 0) {
        const refundAmount = formatMoney(-preview.delta);
        if (refundChoice === "CREDIT") {
          body = `Tu reembolso de ${refundAmount} ahora está disponible como saldo a favor en Mi cuenta.`;
        } else {
          body = `Tu reembolso de ${refundAmount} llegará a tu tarjeta en 5–10 días hábiles.`;
        }
      }
      Alert.alert(title, body, [{ text: "OK", onPress: () => router.back() }]);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const handleSubmit = () => {
    if (!preview) return;
    if (preview.delta < 0) {
      Alert.alert(
        "Confirmar recorte",
        `Se recortará la estadía y recibirás ${formatMoney(-preview.delta)} como ${
          refundChoice === "STRIPE_REFUND" ? "reembolso a tarjeta" : "saldo a favor"
        }. ¿Continuar?`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Confirmar", onPress: () => submitMutation.mutate() },
        ]
      );
    } else {
      submitMutation.mutate();
    }
  };

  if (isLoading || !reservation) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const stripeDisabled =
    preview?.lastPaymentMethod !== "STRIPE" && preview?.lastPaymentMethod !== "CARD";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Modificar fechas</Text>
      <Text style={styles.subtitle}>{reservation.pet.name}</Text>

      {isCheckedIn && (
        <View style={styles.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.infoText} />
          <Text style={styles.hintText}>
            No puedes cambiar la fecha de entrada durante la estancia.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>Entrada</Text>
        <TouchableOpacity
          style={[styles.dateField, isCheckedIn && styles.dateFieldDisabled]}
          onPress={() => !isCheckedIn && setShowCheckInPicker(true)}
          disabled={isCheckedIn}
        >
          <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.dateText}>
            {newCheckIn ? formatShort(newCheckIn) : "—"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Salida</Text>
        <TouchableOpacity
          style={styles.dateField}
          onPress={() => setShowCheckOutPicker(true)}
        >
          <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.dateText}>
            {newCheckOut ? formatShort(newCheckOut) : "—"}
          </Text>
        </TouchableOpacity>

        {showCheckInPicker && newCheckIn && (
          <DateTimePicker
            value={newCheckIn}
            mode="date"
            minimumDate={today}
            onChange={(_, date) => {
              setShowCheckInPicker(Platform.OS === "ios");
              if (date) setNewCheckIn(date);
            }}
          />
        )}
        {showCheckOutPicker && newCheckOut && (
          <DateTimePicker
            value={newCheckOut}
            mode="date"
            minimumDate={isCheckedIn ? today : newCheckIn ?? today}
            onChange={(_, date) => {
              setShowCheckOutPicker(Platform.OS === "ios");
              if (date) setNewCheckOut(date);
            }}
          />
        )}
      </View>

      {previewError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{previewError}</Text>
        </View>
      )}

      {preview && (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Nuevos días</Text>
            <Text style={styles.rowValue}>{preview.newTotalDays}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Nuevo total</Text>
            <Text style={styles.rowValue}>{formatMoney(preview.newTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Diferencia</Text>
            <Text
              style={[
                styles.rowValue,
                { color: preview.delta > 0 ? COLORS.errorText : COLORS.successText },
              ]}
            >
              {preview.delta > 0 ? "+" : ""}
              {formatMoney(preview.delta)}
            </Text>
          </View>

          <View style={styles.modeBox}>
            <Ionicons
              name={preview.requiresApproval ? "time-outline" : "flash-outline"}
              size={16}
              color={preview.requiresApproval ? COLORS.warningText : COLORS.successText}
            />
            <Text style={styles.modeText}>
              {preview.requiresApproval
                ? "Se enviará a aprobación del admin"
                : "Se aplicará de inmediato"}
            </Text>
          </View>
        </View>
      )}

      {preview && preview.delta < 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>¿Cómo quieres recibir la diferencia?</Text>
          {!stripeDisabled && (
            <TouchableOpacity
              style={[
                styles.choiceRow,
                refundChoice === "STRIPE_REFUND" && styles.choiceRowActive,
              ]}
              onPress={() => setRefundChoice("STRIPE_REFUND")}
            >
              <Ionicons
                name={
                  refundChoice === "STRIPE_REFUND"
                    ? "radio-button-on"
                    : "radio-button-off"
                }
                size={20}
                color={COLORS.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.choiceLabel}>Reembolso a tarjeta</Text>
                <Text style={styles.choiceSubtitle}>
                  Regresa a la misma tarjeta en 5–10 días hábiles.
                </Text>
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.choiceRow,
              refundChoice === "CREDIT" && styles.choiceRowActive,
            ]}
            onPress={() => setRefundChoice("CREDIT")}
          >
            <Ionicons
              name={
                refundChoice === "CREDIT" ? "radio-button-on" : "radio-button-off"
              }
              size={20}
              color={COLORS.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.choiceLabel}>Saldo a favor</Text>
              <Text style={styles.choiceSubtitle}>
                Se aplica automáticamente en tu próxima reservación.
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.submitButton,
          (!preview || submitMutation.isPending) && { opacity: 0.5 },
        ]}
        onPress={handleSubmit}
        disabled={!preview || submitMutation.isPending}
        activeOpacity={0.85}
      >
        {submitMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.submitText}>
            {preview?.requiresApproval ? "Enviar solicitud" : "Aplicar cambio"}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  hintBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.infoBg,
    marginBottom: 12,
  },
  hintText: { flex: 1, fontSize: 13, color: COLORS.infoText },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
    marginTop: 4,
  },
  dateField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  dateFieldDisabled: { opacity: 0.5 },
  dateText: { fontSize: 15, color: COLORS.textPrimary, fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: { fontSize: 14, color: COLORS.textTertiary },
  rowValue: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  modeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  modeText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  errorBox: {
    backgroundColor: COLORS.errorBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: { color: COLORS.errorText, fontSize: 13 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
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
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: { color: COLORS.white, fontSize: 16, fontWeight: "700" },
});
