import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getReservations } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";
import { formatName, utcDayKey, localDayKey } from "@/lib/format";

export default function AdminCheckoutsToday() {
  const router = useRouter();
  const today = localDayKey();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "reservations", "checkouts-today"],
    queryFn: async () => {
      const checkedIn = await getReservations({ status: "CHECKED_IN" });
      return checkedIn.filter(
        (r) => r.pet && r.checkOut && utcDayKey(r.checkOut) === today
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
      <Text style={styles.heading}>Check-outs de hoy</Text>
      <Text style={styles.sub}>{data?.length ?? 0} salidas programadas</Text>

      {(data?.length ?? 0) === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="log-out-outline" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>Sin check-outs para hoy</Text>
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
