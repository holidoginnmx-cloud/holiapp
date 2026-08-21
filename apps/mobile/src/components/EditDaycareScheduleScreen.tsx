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
import {
  getReservationById,
  getDaycareAvailability,
  updateDaycareSchedule,
} from "@/lib/api";
import {
  formatName,
  formatTimeHHmm,
  formatWeekdayDayShort,
  formatCurrency,
  localDateFromUTCDay,
  localDayKey,
  utcDayKey,
} from "@/lib/format";
import { DateTimeField } from "@/components/DateTimeField";
import { SwitchRow } from "@/components/SwitchRow";
import { ErrorState } from "@/components/ErrorState";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import {
  computeDaycareHours,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
} from "@holidoginn/shared/src/pricing";

// Date → "HH:mm" (hora local del dispositivo, que corre en hora del hotel).
function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "HH:mm" → Date sobre un día base, para alimentar al reloj nativo.
function fromHHmm(hhmm: string, base: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

// Mover el día y/o el horario de una guardería ya creada. Compartida entre el
// detalle admin y el de staff: cada stack la registra con un wrapper de ruta de
// ~10 líneas; toda la lógica vive aquí (mismo patrón que
// EditBathAppointmentScreen).
//
// A diferencia del baño, aquí el horario ES el precio: el total se ajusta por
// la diferencia de horas × tarifa, y el switch "Actualizar el total" permite
// dejarlo intacto cuando el precio fue pactado a mano.
export function EditDaycareScheduleScreen({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: reservation, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id),
    enabled: !!id,
  });

  const [day, setDay] = useState<Date | null>(null);
  const [inTime, setInTime] = useState("09:00");
  const [outTime, setOutTime] = useState("13:00");
  const [updateTotal, setUpdateTotal] = useState(true);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (!reservation || day) return;
    // El día vive en appointmentAt anclado a mediodía UTC: leerlo en local
    // correría la fecha un día. Sin día (dato viejo a medias) se arranca en
    // hoy, para que la pantalla sirva justo para completarlo.
    setDay(
      reservation.appointmentAt
        ? localDateFromUTCDay(reservation.appointmentAt)
        : new Date(),
    );
    if (reservation.checkInTime) setInTime(reservation.checkInTime);
    if (reservation.checkOutTime) setOutTime(reservation.checkOutTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation]);

  const dayKey = day ? localDayKey(day) : null;
  const originalDayKey = reservation?.appointmentAt
    ? utcDayKey(reservation.appointmentAt)
    : null;
  // Sin día original (dato viejo a medias) el día SIEMPRE viaja: es lo que lo
  // completa.
  const dayChanged = !!dayKey && (!originalDayKey || dayKey !== originalDayKey);

  // Cupo y tarifa del día elegido (el mismo snapshot que consume el flujo de
  // reserva del cliente).
  const { data: availability } = useQuery({
    queryKey: ["daycare-availability", dayKey],
    queryFn: () => getDaycareAvailability(dayKey!),
    enabled: !!dayKey,
  });

  const hourPrice = availability?.hourPrice ?? 0;
  const hours = computeDaycareHours(inTime, outTime);
  const previousHours = useMemo(() => {
    if (!reservation?.checkInTime || !reservation?.checkOutTime) return null;
    return computeDaycareHours(reservation.checkInTime, reservation.checkOutTime);
  }, [reservation]);

  const previousTotal = Number(reservation?.totalAmount ?? 0);
  // Mismo criterio que el servidor: se ajusta la DIFERENCIA de horas, no se
  // reconstruye el total (así se conservan domicilio, add-ons y descuentos).
  const delta =
    updateTotal && previousHours != null && previousHours > 0 && hours > 0
      ? (hours - previousHours) * hourPrice
      : 0;
  const newTotal = Math.max(0, previousTotal + delta);

  const backdated = !!dayKey && dayChanged && dayKey < localDayKey();
  const dayFull = dayChanged && !!availability && availability.remaining <= 0;
  const outOfWindow =
    hours > 0 &&
    (Number(inTime.split(":")[0]) < DAYCARE_OPEN_HOUR ||
      Number(outTime.split(":")[0]) >= DAYCARE_CLOSE_HOUR);

  const isDaycare = reservation?.reservationType === "DAYCARE";
  const isEditable =
    reservation?.status === "CONFIRMED" || reservation?.status === "CHECKED_IN";
  const unchanged =
    !dayChanged &&
    inTime === (reservation?.checkInTime ?? "") &&
    outTime === (reservation?.checkOutTime ?? "");
  const canSubmit =
    !!dayKey &&
    hours > 0 &&
    isDaycare &&
    isEditable &&
    !unchanged &&
    (!backdated || force) &&
    (!dayFull || force);

  const submitMutation = useMutation({
    mutationFn: () =>
      updateDaycareSchedule(id, {
        // Solo se manda el día si de verdad cambió: así el servidor no revalida
        // cupo por una edición de horas.
        ...(dayChanged ? { date: dayKey! } : {}),
        checkInTime: inTime,
        checkOutTime: outTime,
        updateTotal,
        force: force || undefined,
      }),
    onSuccess: (res) => {
      invalidateReservationScope(qc, id);
      const partes = [
        `Quedó de ${formatTimeHHmm(inTime)} a ${formatTimeHHmm(outTime)}.`,
      ];
      if (res.delta !== 0) {
        partes.push(`Nuevo total: ${formatCurrency(res.newTotal)}.`);
      }
      if (res.balance > 0) {
        partes.push(`Falta cobrar ${formatCurrency(res.balance)}.`);
      } else if (res.overpaid > 0) {
        partes.push(
          `Hay ${formatCurrency(res.overpaid)} pagados de más por devolver o dejar como saldo a favor.`,
        );
      }
      Alert.alert("Horario actualizado", partes.join(" "), [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => {
      // Día pasado o sin cupo llegan como error del server; el switch
      // "Guardar de todos modos" los destranca.
      Alert.alert("No se pudo cambiar el horario", e.message);
    },
  });

  const handleSubmit = () => {
    if (!canSubmit || !day) return;
    const resumen =
      `${formatName(reservation!.pet.name)}: ${formatWeekdayDayShort(day)}, de ` +
      `${formatTimeHHmm(inTime)} a ${formatTimeHHmm(outTime)}.` +
      (delta !== 0 ? ` El total pasa a ${formatCurrency(newTotal)}.` : "") +
      " Se avisará al dueño. ¿Aplicar?";
    Alert.alert("Confirmar cambio", resumen, [
      { text: "Cancelar", style: "cancel" },
      { text: "Aplicar", onPress: () => submitMutation.mutate() },
    ]);
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !reservation || !day) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!isDaycare) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          Esta pantalla es solo para guarderías.
        </Text>
      </View>
    );
  }

  if (!isEditable) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          Solo se puede cambiar el horario de una guardería activa.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Editar horario</Text>
      <Text style={styles.subtitle}>
        {formatName(reservation.pet.name)}
        {reservation.checkInTime && reservation.checkOutTime
          ? ` · hoy: ${formatTimeHHmm(reservation.checkInTime)} a ${formatTimeHHmm(reservation.checkOutTime)}`
          : ""}
      </Text>

      <View style={styles.card}>
        <DateTimeField
          label="Día"
          title="Día de guardería"
          text={formatWeekdayDayShort(day)}
          mode="date"
          pickerValue={day}
          // Sin minimumDate a propósito: también sirve para corregir una
          // guardería que ya pasó (el switch de abajo es el gate).
          onChange={setDay}
          testID="edit-daycare-day"
        />

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <DateTimeField
              label="Entrada"
              title="Hora de entrada"
              text={formatTimeHHmm(inTime)}
              mode="time"
              pickerValue={fromHHmm(inTime, day)}
              onChange={(d) => setInTime(toHHmm(d))}
              testID="edit-daycare-in"
            />
          </View>
          <View style={styles.dateCol}>
            <DateTimeField
              label="Salida"
              title="Hora de salida"
              text={formatTimeHHmm(outTime)}
              mode="time"
              pickerValue={fromHHmm(outTime, day)}
              onChange={(d) => setOutTime(toHHmm(d))}
              testID="edit-daycare-out"
            />
          </View>
        </View>

        {hours > 0 ? (
          <Text style={styles.estimate}>
            {hours} {hours === 1 ? "hora" : "horas"} × {formatCurrency(hourPrice)}
            {previousHours != null && previousHours !== hours
              ? ` · antes ${previousHours} ${previousHours === 1 ? "hora" : "horas"}`
              : ""}
          </Text>
        ) : (
          <Text style={styles.estimateWarn}>
            La hora de salida debe ser posterior a la de entrada.
          </Text>
        )}

        {outOfWindow && (
          <Text style={styles.estimate}>
            Fuera del horario de guardería ({DAYCARE_OPEN_HOUR}:00 a{" "}
            {DAYCARE_CLOSE_HOUR}:00). Se guarda igual.
          </Text>
        )}

        {unchanged && (
          <Text style={styles.estimate}>La guardería ya tiene ese horario.</Text>
        )}
      </View>

      {/* Dinero: en guardería el horario ES el precio. */}
      {previousHours != null && previousHours > 0 && hours > 0 && (
        <View style={styles.card}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(newTotal)}</Text>
          </View>
          {delta !== 0 && (
            <Text style={styles.estimate}>
              {delta > 0 ? "Sube " : "Baja "}
              {formatCurrency(Math.abs(delta))} respecto a{" "}
              {formatCurrency(previousTotal)}.
            </Text>
          )}
          <SwitchRow
            label="Actualizar el total"
            value={updateTotal}
            onValueChange={setUpdateTotal}
          />
          {!updateTotal && (
            <Text style={styles.estimate}>
              El total se queda en {formatCurrency(previousTotal)} (precio
              pactado).
            </Text>
          )}
        </View>
      )}

      {(backdated || dayFull) && (
        <View style={styles.card}>
          <Text style={styles.estimateWarn}>
            {backdated
              ? "Ese día ya pasó: se registra como guardería retroactiva."
              : `Ese día ya está lleno (${availability?.occupied}/${availability?.maxCapacity} ocupado).`}
          </Text>
          <SwitchRow
            label="Guardar de todos modos"
            value={force}
            onValueChange={setForce}
          />
        </View>
      )}

      {reservation.groupId && (
        <View style={styles.hintBox}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={COLORS.infoText}
          />
          <Text style={styles.hintText}>
            Esta guardería es parte de un grupo multi-perro: el horario nuevo
            aplica a todas las mascotas del grupo, que entran y salen juntas.
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
        testID="edit-daycare-submit"
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
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
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  totalValue: {
    fontSize: 22,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.primary,
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
    textAlign: "center",
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
