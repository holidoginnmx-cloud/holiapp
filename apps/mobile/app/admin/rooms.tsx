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
                router.push(`/admin/room/${item.id}` as any)
              }
            />
          )}
          ListHeaderComponent={
            <>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => router.push("/admin/room/edit" as any)}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle" size={20} color={COLORS.white} />
                <Text style={styles.addButtonText}>Nuevo cuarto</Text>
              </TouchableOpacity>

              <View style={styles.occupancyCard}>
                <View style={styles.occupancyTopRow}>
                  <View style={styles.occupancyIconWrap}>
                    <Ionicons
                      name="bed"
                      size={20}
                      color={COLORS.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.occupancyTitle}>Ocupación</Text>
                    <Text style={styles.occupancyDetail}>
                      {occupied} de {totalActive} cuartos ocupados
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.occupancyPct,
                      {
                        color:
                          occupancyPct >= 80
                            ? COLORS.errorText
                            : occupancyPct >= 50
                            ? COLORS.warningText
                            : COLORS.successText,
                      },
                    ]}
                  >
                    {occupancyPct}%
                  </Text>
                </View>
                <View style={styles.occupancyBarBg}>
                  <View
                    style={[
                      styles.occupancyBarFill,
                      {
                        width: `${occupancyPct}%`,
                        backgroundColor:
                          occupancyPct >= 80
                            ? COLORS.errorText
                            : occupancyPct >= 50
                            ? COLORS.warningText
                            : COLORS.successText,
                      },
                    ]}
                  />
                </View>
              </View>
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
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  addButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
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
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  occupancyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  occupancyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  occupancyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  occupancyPct: {
    fontSize: 22,
    fontWeight: "800",
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
    marginTop: 1,
  },
});
