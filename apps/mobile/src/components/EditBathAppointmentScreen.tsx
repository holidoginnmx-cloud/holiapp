import { COLORS } from "@/constants/colors";
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getReservationById, getBathSlots, updateBathAppointment } from "@/lib/api";
import { formatName, formatTime, formatWeekdayDayShort } from "@/lib/format";
import { DateTimeField } from "@/components/DateTimeField";
import { SwitchRow } from "@/components/SwitchRow";
import { ErrorState } from "@/components/ErrorState";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import {
  useBathConflict,
  localDayKey,
  formatDurationMin,
} from "@/hooks/useBathConflict";


import { alertaDeError } from "@/lib/errorAlert";

// Reagendar una cita de baño suelta (appointmentAt). Compartida entre el
// detalle admin y el de staff: cada stack la registra con un wrapper de ruta
// de ~10 líneas; toda la lógica vive aquí.
//
// Solo mueve la hora — el servicio, el precio y el grupo no cambian, así que
// no hay preview de delta como en edit-dates: la validación en vivo la da la
// rejilla de slots (con `excludeReservationId` para no chocar consigo misma).
export function EditBathAppointmentScreen({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: reservation, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id),
    enabled: !!id,
  });

  const [appointmentAt, setAppointmentAt] = useState<Date | null>(null);
  const [forceSchedule, setForceSchedule] = useState(false);

  const currentAt = reservation?.appointmentAt
    ? new Date(reservation.appointmentAt)
    : null;

  useEffect(() => {
    if (currentAt && !appointmentAt) setAppointmentAt(currentAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation]);

  const bathAddon = reservation?.addons?.find(
    (a) => a.variant?.serviceType?.code === "BATH",
  );
  const deslanado = bathAddon?.variant?.deslanado ?? false;
  const corte = bathAddon?.variant?.corte ?? false;

  const bathDateYMD = useMemo(
    () => (appointmentAt ? localDayKey(appointmentAt) : null),
    [appointmentAt],
  );
  const { data: bathSlots } = useQuery({
    queryKey: ["bath-slots-edit", bathDateYMD, reservation?.petId, deslanado, corte, id],
    queryFn: () =>
      getBathSlots(bathDateYMD!, {
        petId: reservation!.petId,
        deslanado,
        corte,
        // La cita no debe estorbarse a sí misma al moverse dentro de su día.
        excludeReservationId: id,
      }),
    enabled: !!bathDateYMD && !!reservation?.petId,
  });

  const bathConflict = useBathConflict(bathSlots, appointmentAt);

  const isBath = reservation?.reservationType === "BATH";
  const isConfirmed = reservation?.status === "CONFIRMED";
  const unchanged =
    !!appointmentAt && !!currentAt && appointmentAt.getTime() === currentAt.getTime();
  const canSubmit =
    !!appointmentAt && isBath && isConfirmed && !unchanged && (!bathConflict || forceSchedule);

  const submitMutation = useMutation({
    mutationFn: () =>
      updateBathAppointment(id, {
        appointmentAt: appointmentAt!.toISOString(),
        force: forceSchedule || undefined,
      }),
    onSuccess: () => {
      invalidateReservationScope(qc, id);
      qc.invalidateQueries({ queryKey: ["staff-baths"] });
      Alert.alert(
        "Cita reagendada",
        "Se avisó al dueño con la hora nueva.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    },
    onError: (e: Error) => {
      // El 409 del server trae la hora concreta del choque; el switch
      // "Agendar de todos modos" lo destranca.
      alertaDeError(e, { titulo: "No se pudo reagendar" });
    },
  });

  const handleSubmit = () => {
    if (!canSubmit || !appointmentAt) return;
    Alert.alert(
      "Confirmar cambio",
      `La cita de ${formatName(reservation!.pet.name)} se moverá al ${formatWeekdayDayShort(appointmentAt)} a las ${formatTime(appointmentAt)}. Se avisará al dueño. ¿Aplicar?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Aplicar", onPress: () => submitMutation.mutate() },
      ],
    );
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !reservation || !appointmentAt) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!isBath) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Solo se pueden reagendar citas de baño.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Reagendar baño</Text>
      <Text style={styles.subtitle}>
        {formatName(reservation.pet.name)}
        {currentAt
          ? ` · hoy: ${formatWeekdayDayShort(currentAt)}, ${formatTime(currentAt)}`
          : ""}
      </Text>

      <View style={styles.card}>
        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <DateTimeField
              label="Fecha"
              title="Fecha de la cita"
              text={formatWeekdayDayShort(appointmentAt)}
              mode="date"
              pickerValue={appointmentAt}
              // Sin minimumDate a propósito: también sirve para backfill de
              // citas que ya ocurrieron ("Agendar de todos modos" hace el gate).
              onChange={(date) => {
                const next = new Date(date);
                next.setHours(appointmentAt.getHours(), appointmentAt.getMinutes(), 0, 0);
                setAppointmentAt(next);
              }}
              testID="edit-appointment-date"
            />
          </View>
          <View style={styles.dateCol}>
            <DateTimeField
              label="Hora"
              title="Hora de la cita"
              text={formatTime(appointmentAt)}
              mode="time"
              pickerValue={appointmentAt}
              onChange={(date) => {
                const next = new Date(appointmentAt);
                next.setHours(date.getHours(), date.getMinutes(), 0, 0);
                setAppointmentAt(next);
              }}
              testID="edit-appointment-time"
            />
          </View>
        </View>

        {bathSlots?.durationMinutes != null && (
          <Text style={styles.estimate}>
            Toma {formatDurationMin(bathSlots.durationMinutes)} · termina{" "}
            {formatTime(
              new Date(appointmentAt.getTime() + bathSlots.durationMinutes * 60000),
            )}
          </Text>
        )}

        {unchanged && (
          <Text style={styles.estimate}>La cita ya está en ese horario.</Text>
        )}

        {bathConflict && !unchanged && (
          <>
            <Text style={styles.estimateWarn}>{bathConflict}</Text>
            <SwitchRow
              label="Agendar de todos modos"
              value={forceSchedule}
              onValueChange={setForceSchedule}
            />
          </>
        )}
      </View>

      {reservation.groupId && (
        <View style={styles.hintBox}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={COLORS.infoText}
          />
          <Text style={styles.hintText}>
            Esta cita es parte de un grupo multi-perro. Solo se moverá la de{" "}
            {formatName(reservation.pet.name)}; las demás se quedan donde están.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.submitButton,
          (!canSubmit || submitMutation.isPending) && { opacity: 0.5 },
        ]}
        onPress={handleSubmit}
        disabled={!canSubmit || submitMutation.isPending}
        activeOpacity={0.85}
        testID="edit-appointment-submit"
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
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
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
  dateRow: { flexDirection: "row", gap: 10 },
  dateCol: { flex: 1 },
  estimate: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  estimateWarn: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.errorText,
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
  hintText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.infoText,
  },
  errorText: {
    color: COLORS.errorText,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
