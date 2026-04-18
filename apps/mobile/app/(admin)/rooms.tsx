import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getAdminRoomStatus } from "@/lib/api";
import { RoomStatusCard } from "@/components/RoomStatusCard";

export default function AdminRooms() {
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "rooms"],
    queryFn: getAdminRoomStatus,
  });

  const rooms = data ?? [];
  const totalActive = rooms.filter((r) => r.isActive).length;
  const occupied = rooms.filter((r) => r.currentReservation).length;
  const occupancyPct = totalActive > 0 ? Math.round((occupied / totalActive) * 100) : 0;

  return (
    <View style={styles.screen}>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={rooms}
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
            <RoomStatusCard
              room={item}
              onPress={() =>
                router.push(`/(admin)/room/edit?id=${item.id}` as any)
              }
            />
          )}
          ListHeaderComponent={
            <>
              {/* Occupancy bar */}
              <View style={styles.occupancyCard}>
                <View style={styles.occupancyHeader}>
                  <Text style={styles.occupancyTitle}>Ocupación</Text>
                  <Text style={styles.occupancyPct}>{occupancyPct}%</Text>
                </View>
                <View style={styles.occupancyBarBg}>
                  <View
                    style={[
                      styles.occupancyBarFill,
                      {
                        width: `${occupancyPct}%`,
                        backgroundColor:
                          occupancyPct >= 80 ? COLORS.errorText :
                          occupancyPct >= 50 ? COLORS.warningText :
                          COLORS.successText,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.occupancyDetail}>
                  {occupied} de {totalActive} cuartos ocupados
                </Text>
              </View>

              <TouchableOpacity
                style={styles.addButton}
                onPress={() => router.push("/(admin)/room/edit" as any)}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle" size={20} color={COLORS.white} />
                <Text style={styles.addButtonText}>Nuevo cuarto</Text>
              </TouchableOpacity>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No hay cuartos registrados</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 16,
  },
  addButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
  occupancyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  occupancyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  occupancyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  occupancyPct: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.primary,
  },
  occupancyBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.bgSection,
    overflow: "hidden",
  },
  occupancyBarFill: {
    height: 8,
    borderRadius: 4,
  },
  occupancyDetail: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 6,
  },
});
