import { COLORS } from "@/constants/colors";
import React, { useState, useEffect } from "react";
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
  adminPreviewReservationDates,
  adminUpdateReservationDates,
  type AdminDatesPreview,
} from "@/lib/api";
import {
  formatName,
  localDateFromUTCDay,
  toUTCDayISO,
  formatCurrency,
  formatWeekdayDayShort,
} from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

// Pantalla admin: modifica las fechas de una estadía directamente (sin flujo
// de aprobación). El total se recalcula por delta de hospedaje en el server;
// los pagos NO se ajustan solos — el admin los gestiona desde el detalle.
export default function AdminEditDatesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: reservation, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const [newCheckIn, setNewCheckIn] = useState<Date | null>(null);
  const [newCheckOut, setNewCheckOut] = useState<Date | null>(null);
  const [showCheckInPicker, setShowCheckInPicker] = useState(false);
  const [showCheckOutPicker, setShowCheckOutPicker] = useState(false);
  const [preview, setPreview] = useState<AdminDatesPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (reservation?.checkIn && reservation?.checkOut) {
      setNewCheckIn(localDateFromUTCDay(reservation.checkIn));
      setNewCheckOut(localDateFromUTCDay(reservation.checkOut));
    }
  }, [reservation]);

  // Preview con debounce
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
        const result = await adminPreviewReservationDates(id, {
          newCheckIn: toUTCDayISO(newCheckIn),
          newCheckOut: toUTCDayISO(newCheckOut),
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
      return adminUpdateReservationDates(id, {
        newCheckIn: toUTCDayISO(newCheckIn),
        newCheckOut: toUTCDayISO(newCheckOut),
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["reservation", id] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      qc.invalidateQueries({ queryKey: ["admin", "reservations"] });
      qc.invalidateQueries({ queryKey: ["admin", "rooms"] });
      const deltaMsg =
        res.delta > 0
          ? `El total subió ${formatCurrency(res.delta)}; registra el cobro desde el detalle.`
          : res.delta < 0
          ? `El total bajó ${formatCurrency(-res.delta)}; gestiona el reembolso o saldo a favor si ya estaba pagado.`
          : "El total no cambió.";
      Alert.alert(
        "Fechas actualizadas",
        `Se notificó al dueño${reservation?.staff ? " y al staff asignado" : ""}. ${deltaMsg}`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const handleSubmit = () => {
    if (!preview || !newCheckIn || !newCheckOut) return;
    Alert.alert(
      "Confirmar cambio",
      `Nueva estadía: ${formatWeekdayDayShort(newCheckIn)} → ${formatWeekdayDayShort(newCheckOut)} (${preview.newTotalDays} ${preview.newTotalDays === 1 ? "noche" : "noches"}). Nuevo total: ${formatCurrency(preview.newTotal)}. ¿Aplicar?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Aplicar", onPress: () => submitMutation.mutate() },
      ]
    );
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !reservation) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Modificar fechas</Text>
      <Text style={styles.subtitle}>{formatName(reservation.pet.name)}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Entrada</Text>
        <TouchableOpacity
          style={styles.dateField}
          onPress={() => setShowCheckInPicker(true)}
          testID="admin-edit-dates-checkin"
        >
          <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.dateText}>
            {newCheckIn ? formatWeekdayDayShort(newCheckIn) : "—"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Salida</Text>
        <TouchableOpacity
          style={styles.dateField}
          onPress={() => setShowCheckOutPicker(true)}
          testID="admin-edit-dates-checkout"
        >
          <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.dateText}>
            {newCheckOut ? formatWeekdayDayShort(newCheckOut) : "—"}
          </Text>
        </TouchableOpacity>

        {showCheckInPicker && newCheckIn && (
          <DateTimePicker
            value={newCheckIn}
            mode="date"
            themeVariant="light"
            textColor={COLORS.textPrimary}
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
            themeVariant="light"
            textColor={COLORS.textPrimary}
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
            <Text style={styles.rowLabel}>Nuevas noches</Text>
            <Text style={styles.rowValue}>{preview.newTotalDays}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Total actual</Text>
            <Text style={styles.rowValue}>{formatCurrency(preview.currentTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Nuevo total</Text>
            <Text style={styles.rowValue}>{formatCurrency(preview.newTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Diferencia</Text>
            <Text
              style={[
                styles.rowValue,
                {
                  color:
                    preview.delta > 0
                      ? COLORS.errorText
                      : preview.delta < 0
                      ? COLORS.successText
                      : COLORS.textPrimary,
                },
              ]}
            >
              {preview.delta > 0 ? "+" : ""}
              {formatCurrency(preview.delta)}
            </Text>
          </View>
        </View>
      )}

      {preview && preview.delta !== 0 && (
        <View style={styles.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.infoText} />
          <Text style={styles.hintText}>
            Los pagos no se ajustan automáticamente.{" "}
            {preview.delta > 0
              ? "Registra el cobro de la diferencia desde el detalle de la reserva."
              : "Si el cliente ya pagó, gestiona el reembolso o saldo a favor."}
          </Text>
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
        testID="admin-edit-dates-submit"
      >
        {submitMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.submitText}>Aplicar cambio</Text>
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
  dateText: { fontSize: 15, color: COLORS.textPrimary, fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: { fontSize: 14, color: COLORS.textTertiary },
  rowValue: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
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
  errorBox: {
    backgroundColor: COLORS.errorBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: { color: COLORS.errorText, fontSize: 13 },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: { color: COLORS.white, fontSize: 16, fontWeight: "700" },
});
