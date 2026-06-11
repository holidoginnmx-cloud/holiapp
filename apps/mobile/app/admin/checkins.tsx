import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getReservations } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";
import { formatName, utcDayKey, localDayKey } from "@/lib/format";

export default function AdminCheckinsToday() {
  const router = useRouter();
  const today = localDayKey();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "reservations", "checkins-today"],
    queryFn: async () => {
      const confirmed = await getReservations({ status: "CONFIRMED" });
      return confirmed.filter(
        (r) => r.pet && r.checkIn && utcDayKey(r.checkIn) === today
      );
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Check-ins de hoy</Text>
      <Text style={styles.sub}>{data?.length ?? 0} llegadas programadas</Text>

      {(data?.length ?? 0) === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="log-in-outline" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>Sin check-ins para hoy</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
          }
          renderItem={({ item }) => (
            <ReservationCard
              petName={item.pet?.name ?? "—"}
              roomName={item.room?.name ?? null}
              status={item.status}
              checkIn={item.checkIn}
              checkOut={item.checkOut}
              totalAmount={Number(item.totalAmount)}
              ownerName={`${formatName(item.owner?.firstName ?? "")} ${formatName(item.owner?.lastName ?? "")}`.trim() || "Sin dueño"}
              onPress={() => router.push(`/admin/reservation/${item.id}` as any)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage, padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  heading: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary },
  sub: { fontSize: 13, color: COLORS.textTertiary, marginTop: 2, marginBottom: 16 },
  list: { gap: 10, paddingBottom: 32 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
});
