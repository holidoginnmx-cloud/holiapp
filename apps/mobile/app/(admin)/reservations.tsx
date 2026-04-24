import { COLORS } from "@/constants/colors";
import { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  getReservations,
  listAdminChangeRequests,
  type ReservationListItem,
} from "@/lib/api";
import { CalendarView } from "@/components/CalendarView";
import { FilterTabs } from "@/components/FilterTabs";

const VIEW_TABS = [
  { key: "calendar", label: "Calendario" },
  { key: "list", label: "Lista" },
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  PENDING: { label: "Pendiente", bg: COLORS.warningBg, color: COLORS.warningText },
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, color: COLORS.infoText },
  CHECKED_IN: { label: "En estancia", bg: COLORS.successBg, color: COLORS.successText },
  CHECKED_OUT: { label: "Finalizada", bg: COLORS.bgSection, color: COLORS.textTertiary },
  CANCELLED: { label: "Cancelada", bg: COLORS.errorBg, color: COLORS.errorText },
  REJECTED: { label: "Rechazada", bg: COLORS.errorBg, color: COLORS.errorText },
};

function formatDateRange(checkIn: string | Date | null, checkOut: string | Date | null): string {
  if (!checkIn || !checkOut) return "—";
  const fmt = (d: string | Date) =>
    new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return `${fmt(checkIn)} → ${fmt(checkOut)}`;
}

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
        <ReservationListView
          reservations={filtered}
          onPressReservation={(id) =>
            router.push(`/(admin)/reservation/${id}` as any)
          }
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}

function ReservationListView({
  reservations,
  onPressReservation,
  refreshing,
  onRefresh,
}: {
  reservations: ReservationListItem[];
  onPressReservation: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const sorted = useMemo(
    () =>
      [...reservations].sort((a, b) => {
        const ai = a.checkIn ? new Date(a.checkIn).getTime() : 0;
        const bi = b.checkIn ? new Date(b.checkIn).getTime() : 0;
        return ai - bi;
      }),
    [reservations]
  );

  if (sorted.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Ionicons name="calendar-outline" size={40} color={COLORS.textDisabled} />
        <Text style={styles.emptyText}>Sin reservaciones</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
        />
      }
      renderItem={({ item }) => {
        const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.PENDING;
        const ownerName = `${item.owner.firstName} ${item.owner.lastName}`;
        return (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => onPressReservation(item.id)}
          >
            <View style={styles.rowHeader}>
              <View style={styles.petInfo}>
                <Ionicons name="paw" size={16} color={COLORS.primary} />
                <Text style={styles.petName} numberOfLines={1}>
                  {item.pet.name}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
                <Text style={[styles.statusText, { color: statusCfg.color }]}>
                  {statusCfg.label}
                </Text>
              </View>
            </View>
            <Text style={styles.ownerLine} numberOfLines={1}>
              {ownerName}
            </Text>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color={COLORS.textTertiary} />
              <Text style={styles.metaText}>
                {formatDateRange(item.checkIn, item.checkOut)}
              </Text>
              <View style={styles.metaDot} />
              <Ionicons name="bed-outline" size={13} color={COLORS.textTertiary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {item.room?.name ?? "Sin asignar"}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
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
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 40,
  },
  row: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    gap: 6,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  petInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  petName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  ownerLine: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    flexShrink: 1,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.textDisabled,
    marginHorizontal: 4,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textDisabled,
  },
});
