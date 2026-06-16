import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  getStaffStaysAll,
  getStaffBaths,
  type StaffBath,
} from "@/lib/api";
import {
  CalendarView,
  type CalendarReservation,
} from "@/components/CalendarView";
import { ErrorState } from "@/components/ErrorState";

// Los baños no se asignan a un staff específico — cualquiera puede verlos.
// Solo mapeamos los `BATH` puros: los baños dentro de hospedaje ya vienen
// con su Reservation desde getStaffStays.
function bathToCalendarReservation(b: StaffBath): CalendarReservation {
  const bathAddon = b.addons.find(
    (a) => a.variant?.serviceType?.code === "BATH",
  );
  return {
    id: b.id,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    status: b.status,
    totalAmount: Number(b.totalAmount),
    reservationType: "BATH",
    appointmentAt: b.appointmentAt,
    paymentType: b.paymentType,
    hasBalance: false,
    hasDeslanado: bathAddon?.variant?.deslanado ?? false,
    hasCorte: bathAddon?.variant?.corte ?? false,
    pet: {
      id: b.pet?.id ?? "",
      name: b.pet?.name ?? "—",
      breed: b.pet?.breed ?? null,
      photoUrl: b.pet?.photoUrl ?? null,
    },
    room: null,
    owner: {
      id: b.owner?.id ?? "",
      firstName: b.owner?.firstName ?? "",
      lastName: b.owner?.lastName ?? "",
    },
    staff: null,
    checklists: [],
  };
}

export default function StaffStays() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const {
    data: stays,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["staff", "stays", "all"],
    queryFn: () => getStaffStaysAll(),
  });

  const {
    data: bathsData,
    isError: isErrorBaths,
    error: errorBaths,
    refetch: refetchBaths,
    isRefetching: isRefetchingBaths,
  } = useQuery({
    queryKey: ["staff-baths", "upcoming"],
    queryFn: () => getStaffBaths(),
  });

  const combined: CalendarReservation[] = useMemo(() => {
    const stayList: CalendarReservation[] = (stays ?? []).map((s) => ({
      ...(s as unknown as CalendarReservation),
      // El baño de un hospedaje es un addon de tipo BATH (servicio en checkout).
      hasBath: (s.addons ?? []).some(
        (a) => a.variant?.serviceType?.code === "BATH",
      ),
    }));
    const bathList = (bathsData?.baths ?? [])
      .filter((b) => b.reservationType === "BATH")
      .map(bathToCalendarReservation);
    return [...stayList, ...bathList];
  }, [stays, bathsData]);

  const filtered = combined.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.pet?.name?.toLowerCase().includes(q) ||
      r.owner?.firstName?.toLowerCase().includes(q) ||
      r.owner?.lastName?.toLowerCase().includes(q) ||
      r.room?.name?.toLowerCase().includes(q)
    );
  });

  if (isError || isErrorBaths) {
    return (
      <ErrorState
        error={error ?? errorBaths}
        onRetry={() => {
          refetch();
          refetchBaths();
        }}
      />
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por mascota, dueño o cuarto..."
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <Ionicons
            name="close-circle"
            size={18}
            color={COLORS.textDisabled}
            onPress={() => setSearch("")}
          />
        )}
      </View>

      <CalendarView
        reservations={filtered}
        onPressReservation={(id) => {
          const target = filtered.find((r) => r.id === id);
          if (target?.reservationType === "BATH") {
            router.push(`/staff/bath/${id}` as any);
          } else {
            router.push(`/staff/stay/${id}` as any);
          }
        }}
        showOwnerName
        refreshing={isRefetching || isRefetchingBaths}
        onRefresh={() => {
          refetch();
          refetchBaths();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
});
