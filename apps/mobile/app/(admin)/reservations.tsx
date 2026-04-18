import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { getReservations, listAdminChangeRequests } from "@/lib/api";
import { CalendarView } from "@/components/CalendarView";
import { FilterTabs } from "@/components/FilterTabs";

const VIEW_TABS = [
  { key: "calendar", label: "Calendario" },
  { key: "list", label: "Lista" },
];

export default function AdminReservations() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState("calendar");
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "reservations"],
    queryFn: () => getReservations({}),
  });

  const { data: pendingChanges } = useQuery({
    queryKey: ["admin", "change-requests", "PENDING"],
    queryFn: () => listAdminChangeRequests("PENDING"),
    refetchInterval: 60_000,
  });
  const pendingCount = pendingChanges?.length ?? 0;

  const filtered = (data ?? []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.pet.name.toLowerCase().includes(q) ||
      r.room?.name?.toLowerCase().includes(q) ||
      r.staff?.firstName?.toLowerCase().includes(q)
    );
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
      {pendingCount > 0 && (
        <TouchableOpacity
          style={styles.changesBanner}
          onPress={() => router.push("/(admin)/change-requests" as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="swap-horizontal" size={18} color={COLORS.white} />
          <Text style={styles.changesBannerText}>
            {pendingCount} solicitud{pendingCount === 1 ? "" : "es"} de cambio pendiente{pendingCount === 1 ? "" : "s"}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.white} />
        </TouchableOpacity>
      )}

      {/* Search + view toggle */}
      <View style={styles.controlsRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={16} color={COLORS.textDisabled} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar mascota, cuarto, staff..."
            placeholderTextColor={COLORS.textDisabled}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Ionicons
              name="close-circle"
              size={16}
              color={COLORS.textDisabled}
              onPress={() => setSearch("")}
            />
          )}
        </View>
      </View>

      <View style={styles.tabContainer}>
        <FilterTabs tabs={VIEW_TABS} activeTab={viewMode} onSelect={setViewMode} />
      </View>

      {viewMode === "calendar" ? (
        <CalendarView
          reservations={filtered}
          onPressReservation={(id) =>
            router.push(`/(admin)/reservation/${id}` as any)
          }
          showOwnerName
          showStaffName
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      ) : (
        <CalendarView
          reservations={filtered}
          onPressReservation={(id) =>
            router.push(`/(admin)/reservation/${id}` as any)
          }
          showOwnerName
          showStaffName
          refreshing={isRefetching}
          onRefresh={refetch}
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
    backgroundColor: COLORS.bgPage,
  },
  changesBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  changesBannerText: {
    flex: 1,
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 14,
  },
  controlsRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },
  tabContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
