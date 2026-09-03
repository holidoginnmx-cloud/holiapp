import { COLORS } from "@/constants/colors";
import React, { useEffect, useState } from "react";
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
import { getReservationById, updateReservationTimes } from "@/lib/api";
import { formatName, formatTimeHHmm } from "@/lib/format";
import { DateTimeField } from "@/components/DateTimeField";
import { ErrorState } from "@/components/ErrorState";
import { invalidateReservationScope } from "@/lib/invalidateReservations";


import { alertaDeError } from "@/lib/errorAlert";

// Date → "HH:mm" (hora local del dispositivo, que corre en hora del hotel).
function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "HH:mm" → Date de hoy, solo para alimentar al reloj nativo.
function fromHHmm(hhmm: string, base: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Hora de referencia del hotel, para el aviso (no es un límite). */
const CHECKIN_DESDE = 9;
const CHECKIN_HASTA = 18;
const CHECKOUT_HASTA = 13;

function fueraDeHorario(inTime: string | null, outTime: string | null): boolean {
  const h = (t: string | null) => (t ? Number(t.split(":")[0]) : null);
  const entrada = h(inTime);
  const salida = h(outTime);
  return (
    (entrada !== null && (entrada < CHECKIN_DESDE || entrada >= CHECKIN_HASTA)) ||
    (salida !== null && (salida < CHECKIN_DESDE || salida >= CHECKOUT_HASTA))
  );
}

/**
 * Fijar o corregir la hora estimada de llegada y de recogida de un hospedaje.
 *
 * Existe porque el equipo no la podía tocar: el único lugar donde se editaba
 * era la app del CLIENTE, así que cuando alguien avisaba por WhatsApp "la llevo
 * a las 7", esa hora se quedaba fuera del sistema y viajaba por la agenda del
 * celular de quien contestó.
 *
 * Compartida por el detalle admin y el de staff con un wrapper de ruta de ~10
 * líneas cada uno, igual que EditDaycareScheduleScreen y
 * EditBathAppointmentScreen. Las horas de una guardería NO se editan aquí: ahí
 * el horario es el precio y tiene su propia pantalla.
 */
export function EditStayTimesScreen({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: reservation, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id),
    enabled: !!id,
  });

  // `null` = sin hora. Es un estado con significado propio ("todavía no la
  // sabemos"), distinto de una hora por defecto inventada.
  const [inTime, setInTime] = useState<string | null>(null);
  const [outTime, setOutTime] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    if (!reservation || cargado) return;
    setInTime(reservation.checkInTime ?? null);
    setOutTime(reservation.checkOutTime ?? null);
    setCargado(true);
  }, [reservation, cargado]);

  const hoy = new Date();
  const isStay = reservation?.reservationType === "STAY";
  const isEditable =
    reservation?.status === "CONFIRMED" || reservation?.status === "CHECKED_IN";
  const yaLlego = reservation?.status === "CHECKED_IN";
  const unchanged =
    inTime === (reservation?.checkInTime ?? null) &&
    outTime === (reservation?.checkOutTime ?? null);
  const canSubmit = isStay && isEditable && !unchanged && cargado;

  const submitMutation = useMutation({
    // Solo viaja lo que cambió: `undefined` deja el campo intacto en el
    // servidor y `null` lo borra.
    mutationFn: () =>
      updateReservationTimes(id, {
        ...(inTime !== (reservation?.checkInTime ?? null)
          ? { checkInTime: inTime }
          : {}),
        ...(outTime !== (reservation?.checkOutTime ?? null)
          ? { checkOutTime: outTime }
          : {}),
      }),
    onSuccess: () => {
      invalidateReservationScope(qc, id);
      const partes: string[] = [];
      partes.push(
        inTime ? `Llega a las ${formatTimeHHmm(inTime)}.` : "Sin hora de llegada.",
      );
      partes.push(
        outTime ? `Sale a las ${formatTimeHHmm(outTime)}.` : "Sin hora de salida.",
      );
      Alert.alert("Horario actualizado", partes.join(" "), [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => {
      alertaDeError(e, { titulo: "No se pudo cambiar el horario" });
    },
  });

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

  if (!isStay) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          Esta pantalla es solo para hospedajes. El horario de una guardería se
          cambia desde su propia pantalla.
        </Text>
      </View>
    );
  }

  if (!isEditable) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          Solo se puede cambiar el horario de una estancia activa.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Horario de llegada y salida</Text>
      <Text style={styles.subtitle}>
        {formatName(reservation.pet.name)} · la hora que el cliente confirmó
      </Text>

      <View style={styles.card}>
        <DateTimeField
          label="Llegada"
          title="Hora de llegada"
          text={inTime ? formatTimeHHmm(inTime) : "Sin definir"}
          empty={!inTime}
          mode="time"
          // El reloj nativo necesita arrancar en algún lado; 9:00 es la
          // apertura, no una hora que se vaya a guardar sola.
          pickerValue={fromHHmm(inTime ?? "09:00", hoy)}
          onChange={(d) => setInTime(toHHmm(d))}
          onClear={() => setInTime(null)}
          testID="edit-stay-in-time"
        />

        <DateTimeField
          label="Salida"
          title="Hora de salida"
          text={outTime ? formatTimeHHmm(outTime) : "Sin definir"}
          empty={!outTime}
          mode="time"
          pickerValue={fromHHmm(outTime ?? "13:00", hoy)}
          onChange={(d) => setOutTime(toHHmm(d))}
          onClear={() => setOutTime(null)}
          testID="edit-stay-out-time"
        />

        <Text style={styles.hint}>
          Referencia: check-in de {CHECKIN_DESDE}:00 a {CHECKIN_HASTA}:00 y
          check-out de {CHECKIN_DESDE}:00 a {CHECKOUT_HASTA}:00.
        </Text>

        {fueraDeHorario(inTime, outTime) && (
          // Aviso, nunca error: el equipo captura la vida real y "las 7 de la
          // tarde" tiene que poder guardarse.
          <Text style={styles.warn}>
            Queda fuera del horario habitual. Se guarda igual.
          </Text>
        )}

        {unchanged && <Text style={styles.hint}>No hay cambios que guardar.</Text>}
      </View>

      {yaLlego && (
        <View style={styles.hintBox}>
          <Ionicons name="time-outline" size={16} color={COLORS.infoText} />
          <Text style={styles.hintBoxText}>
            El perro ya hizo check-in. La hora de llegada se puede corregir para
            dejar el registro bien, y la de salida es la que importa ahora.
          </Text>
        </View>
      )}

      {reservation.groupId && (
        <View style={styles.hintBox}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={COLORS.infoText}
          />
          <Text style={styles.hintBoxText}>
            Es una reserva de varias mascotas: el horario aplica a todo el grupo,
            que llega y se va junto.
          </Text>
        </View>
      )}

      <View style={styles.hintBox}>
        <Ionicons name="notifications-outline" size={16} color={COLORS.infoText} />
        <Text style={styles.hintBoxText}>
          Al guardar se avisa al equipo, para que quien reciba al perro sepa a
          qué hora esperarlo.
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.submitButton,
          (!canSubmit || submitMutation.isPending) && { opacity: 0.5 },
        ]}
        onPress={() => submitMutation.mutate()}
        disabled={!canSubmit || submitMutation.isPending}
        activeOpacity={0.85}
        testID="edit-stay-times-submit"
      >
        {submitMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.submitText}>Guardar horario</Text>
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
  hint: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  warn: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.warningText,
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
  hintBoxText: {
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
