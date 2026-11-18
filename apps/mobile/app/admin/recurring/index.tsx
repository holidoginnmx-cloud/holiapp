import { COLORS } from "@/constants/colors";
import React from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getRecurringBookings, type RecurringBooking } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";
import { formatFullName, formatName, listaConY } from "@/lib/format";
import { RECURRING_QUERY_KEY, horarioDeSerie } from "@/lib/recurringUi";
import { shortDateLabelES } from "@holidoginn/shared/src/recurrence";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

function SeriesCard({ s, onPress }: { s: RecurringBooking; onPress: () => void }) {
  const next = s.upcoming[0];
  const pets = listaConY(s.pets.map((p) => formatName(p.name)));
  return (
    <TouchableOpacity style={[styles.card, !s.active && styles.cardPaused]} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <Ionicons
          name={s.reservationType === "BATH" ? "water-outline" : "sunny-outline"}
          size={18}
          color={s.active ? COLORS.primary : COLORS.textTertiary}
        />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {pets}
        </Text>
        {!s.active && (
          <View style={styles.pausedBadge}>
            <Text style={styles.pausedText}>En pausa</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardOwner}>{formatFullName(s.owner.firstName, s.owner.lastName)}</Text>
      <Text style={styles.cardRule}>
        🔁 {s.summary} · {horarioDeSerie(s)}
        {s.homeDelivery ? " · 🚗 domicilio" : ""}
      </Text>
      {s.active && next && (
        <Text style={styles.cardNext}>
          Próxima: {shortDateLabelES(next.date)}
          {next.reservationId ? " · ya en la agenda" : ""}
        </Text>
      )}
      {!s.active && s.pausedReason ? <Text style={styles.cardPausedReason}>{s.pausedReason}</Text> : null}
    </TouchableOpacity>
  );
}

export default function RecurringBookingsList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: RECURRING_QUERY_KEY,
    queryFn: () => getRecurringBookings(),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <View style={styles.screen}>
      <FlatList
        data={data ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Clientes con cita fija. La app agenda cada visita sola, una semana antes, y le avisa
            al cliente como cualquier cita.
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="repeat-outline" size={40} color={COLORS.textTertiary} />
            <Text style={styles.emptyTitle}>Todavía no hay citas recurrentes</Text>
            <Text style={styles.emptyText}>
              Por ejemplo: «baño de Polly, Luna y Bongo, un viernes sí y uno no, a las 10».
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <SeriesCard s={item} onPress={() => router.push(`/admin/recurring/${item.id}` as any)} />
        )}
      />
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push("/admin/recurring/form" as any)}
        activeOpacity={0.85}
        accessibilityLabel="Nueva cita recurrente"
      >
        <Ionicons name="add" size={22} color={COLORS.white} />
        <Text style={styles.fabText}>Nueva</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  content: { padding: 16, gap: 10 },
  intro: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 6,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 14,
  },
  cardPaused: { opacity: 0.7 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  cardOwner: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: COLORS.textSecondary, marginTop: 2 },
  cardRule: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textPrimary, marginTop: 8 },
  cardNext: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.primary, marginTop: 4 },
  cardPausedReason: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.warningText, marginTop: 4 },
  pausedBadge: { backgroundColor: COLORS.bgSection, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  pausedText: { fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textSecondary },
  empty: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  emptyText: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  fabText: { color: COLORS.white, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
});
