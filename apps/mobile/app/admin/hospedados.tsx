import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getReservations } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";
import { ErrorState } from "@/components/ErrorState";
import { formatName } from "@/lib/format";

export default function AdminHospedados() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "reservations", "CHECKED_IN"],
    queryFn: () => getReservations({ status: "CHECKED_IN" }),
    refetchInterval: 60_000,
  });

  // Solo hospedajes: los baños son citas, no estancias, aunque compartan
  // el status CHECKED_IN en el backend.
  const stays = useMemo(
    () => (data ?? []).filter((r) => r.reservationType !== "BATH"),
    [data]
  );

  const filtered = useMemo(() => {
    const safe = stays.filter((r) => r.pet);
    const q = search.trim().toLowerCase();
    if (!q) return safe;
    return safe.filter((r) => {
      const petName = r.pet?.name?.toLowerCase() ?? "";
      const roomName = (r.room?.name ?? "").toLowerCase();
      const ownerFirst = (r.owner?.firstName ?? "").toLowerCase();
      const ownerLast = (r.owner?.lastName ?? "").toLowerCase();
      return (
        petName.includes(q) ||
        roomName.includes(q) ||
        ownerFirst.includes(q) ||
        ownerLast.includes(q)
      );
    });
  }, [stays, search]);

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Hospedados</Text>
      <Text style={styles.sub}>
        {stays.length} mascota{stays.length === 1 ? "" : "s"} en estancia
      </Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={COLORS.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por mascota, cuarto o dueño"
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="paw-outline" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>
            {search.trim()
              ? "Sin resultados para tu búsqueda"
              : "No hay mascotas hospedadas"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
          renderItem={({ item }) => (
            <ReservationCard
              petName={item.pet?.name ?? "—"}
              roomName={item.room?.name ?? null}
              status={item.status}
              checkIn={item.checkIn}
              checkOut={item.checkOut}
              totalAmount={Number(item.totalAmount)}
              ownerName={
                item.owner
                  ? `${formatName(item.owner.firstName)} ${formatName(item.owner.lastName)}`
                  : undefined
              }
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  heading: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary },
  sub: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    marginBottom: 12,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },
  list: { gap: 10, paddingBottom: 32 },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
});
