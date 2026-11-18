import { COLORS } from "@/constants/colors";
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getRecurringBooking,
  updateRecurringBooking,
  skipRecurringDate,
  deleteRecurringBooking,
  type RecurringBooking,
} from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";
import { useAuthStore } from "@/store/authStore";
import {
  formatCurrency,
  formatDateTimeShort,
  formatFullName,
  formatName,
  hotelTodayYMD,
  hotelYMD,
  listaConY,
} from "@/lib/format";
import { VIAJE_ETIQUETA } from "@/constants/delivery";
import { RECURRING_QUERY_KEY, horarioDeSerie } from "@/lib/recurringUi";
import { alertaDeError } from "@/lib/errorAlert";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { shortDateLabelES } from "@holidoginn/shared/src/recurrence";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

function Row({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={COLORS.textTertiary} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

export default function RecurringBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const esAdmin = useAuthStore((s) => s.role) === "ADMIN";
  const [busy, setBusy] = useState<string | null>(null);

  const { data: s, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...RECURRING_QUERY_KEY, id],
    queryFn: () => getRecurringBooking(id!),
    enabled: Boolean(id),
  });

  const refrescar = async (fresh?: RecurringBooking) => {
    if (fresh) queryClient.setQueryData([...RECURRING_QUERY_KEY, id], fresh);
    await queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
  };

  const run = async (key: string, fn: () => Promise<RecurringBooking | void>) => {
    setBusy(key);
    try {
      const fresh = await fn();
      await refrescar(fresh ?? undefined);
    } catch (e) {
      alertaDeError(e, { titulo: "No se pudo guardar" });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (isError || !s) return <ErrorState error={error} onRetry={refetch} />;

  const today = hotelTodayYMD();
  const pets = listaConY(s.pets.map((p) => formatName(p.name)));
  const futureSkips = s.skipDates.filter((d) => d >= today);

  const togglePause = () =>
    run("pause", async () => {
      const fresh = await updateRecurringBooking(s.id, { active: !s.active });
      if (!s.active && fresh.generated.length > 0) {
        invalidateReservationScope(queryClient);
        Alert.alert(
          "Reanudada",
          `Ya quedó en la agenda: ${fresh.generated.map((g) => shortDateLabelES(g.date)).join(", ")}.`
        );
      }
      return fresh;
    });

  const skip = (date: string, doSkip: boolean) =>
    run(`skip-${date}`, () => skipRecurringDate(s.id, date, doSkip));

  const terminar = () =>
    Alert.alert(
      "¿Terminar esta cita recurrente?",
      "Ya no se agendarán más visitas. Las citas que ya están en la agenda se quedan como están.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Terminar",
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            try {
              await deleteRecurringBooking(s.id);
              await queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
              router.back();
            } catch (e) {
              alertaDeError(e, { titulo: "No se pudo terminar" });
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: pets || "Cita recurrente" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.card}>
          <Text style={styles.title}>{pets}</Text>
          <Text style={styles.owner}>{formatFullName(s.owner.firstName, s.owner.lastName)}</Text>
          {!s.active && (
            <View style={styles.pausedBox}>
              <Ionicons name="pause-circle" size={16} color={COLORS.warningText} />
              <Text style={styles.pausedText}>
                En pausa{s.pausedReason ? `: ${s.pausedReason}` : ". No se agendan nuevas visitas."}
              </Text>
            </View>
          )}
          <Row icon="repeat-outline" text={s.summary} />
          <Row icon="time-outline" text={horarioDeSerie(s)} />
          {s.reservationType === "BATH" && (s.deslanado || s.corte) && (
            <Row
              icon="cut-outline"
              text={[s.deslanado && "Deslanado", s.corte && "Corte"].filter(Boolean).join(" + ")}
            />
          )}
          {s.homeDelivery && (
            <Row
              icon="car-outline"
              text={`Domicilio ${VIAJE_ETIQUETA[s.homeDeliveryTrip]} · ${
                s.chargeDelivery ? "se cobra" : "sin costo"
              }${s.homeDeliveryAddress ? `\n${s.homeDeliveryAddress}` : ""}`}
            />
          )}
          {esAdmin && s.totalAmountOverride != null && (
            <Row icon="cash-outline" text={`Precio pactado: ${formatCurrency(s.totalAmountOverride)} por visita`} />
          )}
          <Row icon="calendar-outline" text={`Se agenda ${s.leadDays} días antes`} />
          {s.endDate && <Row icon="flag-outline" text={`Termina el ${shortDateLabelES(s.endDate)}`} />}
          {s.internalNotes ? <Row icon="document-text-outline" text={s.internalNotes} /> : null}
        </View>

        <Text style={styles.section}>Próximas visitas</Text>
        <View style={styles.listBox}>
          {s.upcoming.length === 0 && <Text style={styles.empty}>No hay más fechas en esta serie.</Text>}
          {s.upcoming.map((u, i) => {
            const isLast = i === s.upcoming.length - 1 && futureSkips.length === 0;
            const movida =
              u.appointmentAt && hotelYMD(u.appointmentAt) !== u.date
                ? `Movida al ${formatDateTimeShort(u.appointmentAt)}`
                : null;
            return (
              <View key={u.date} style={[styles.dateRow, isLast && styles.dateRowLast]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dateText}>{shortDateLabelES(u.date)}</Text>
                  <Text style={styles.dateSub}>
                    {u.reservationId
                      ? u.status === "CANCELLED"
                        ? "Cancelada"
                        : movida ?? "En la agenda ✓"
                      : s.active
                        ? "Se agenda sola"
                        : "En pausa"}
                  </Text>
                </View>
                {u.reservationId ? (
                  <TouchableOpacity
                    onPress={() => router.push(`/admin/reservation/${u.reservationId}` as any)}
                    style={styles.linkBtn}
                  >
                    <Text style={styles.linkText}>Ver</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => skip(u.date, true)}
                    style={styles.linkBtn}
                    disabled={busy !== null}
                  >
                    {busy === `skip-${u.date}` ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Text style={styles.linkText}>Saltar</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {futureSkips.map((d, i) => (
            <View key={`skip-${d}`} style={[styles.dateRow, i === futureSkips.length - 1 && styles.dateRowLast]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dateText, styles.skipped]}>{shortDateLabelES(d)}</Text>
                <Text style={styles.dateSub}>Saltada</Text>
              </View>
              <TouchableOpacity onPress={() => skip(d, false)} style={styles.linkBtn} disabled={busy !== null}>
                {busy === `skip-${d}` ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Text style={styles.linkText}>Incluir</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <Text style={styles.hint}>
          Para cambiar o cancelar una visita que ya está en la agenda, ábrela con «Ver»: la serie no la
          vuelve a crear.
        </Text>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push(`/admin/recurring/form?id=${s.id}` as any)}
          disabled={busy !== null}
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={18} color={COLORS.white} />
          <Text style={styles.primaryText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={togglePause} disabled={busy !== null}>
          {busy === "pause" ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <Text style={styles.secondaryText}>{s.active ? "Pausar" : "Reanudar"}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerBtn} onPress={terminar} disabled={busy !== null}>
          <Text style={styles.dangerText}>Terminar cita recurrente</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  content: { padding: 16 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 16,
    gap: 8,
  },
  title: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  owner: { fontSize: 14, fontFamily: "PlusJakartaSans_500Medium", color: COLORS.textSecondary, marginBottom: 4 },
  pausedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    padding: 8,
  },
  pausedText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: COLORS.warningText },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoText: { flex: 1, fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textPrimary },
  section: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginTop: 20,
    marginBottom: 8,
  },
  listBox: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: "hidden",
  },
  empty: { padding: 14, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  dateRowLast: { borderBottomWidth: 0 },
  dateText: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  skipped: { textDecorationLine: "line-through", color: COLORS.textTertiary },
  dateSub: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 6, minWidth: 60, alignItems: "flex-end" },
  linkText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.primary },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 8,
    marginBottom: 20,
  },
  primaryBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
  secondaryBtn: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  secondaryText: { color: COLORS.primary, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  dangerBtn: { marginTop: 10, paddingVertical: 12, alignItems: "center" },
  dangerText: { color: COLORS.errorText, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },
});
