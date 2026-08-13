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
  getStaffDaycares,
  type StaffBath,
  type StaffDaycare,
} from "@/lib/api";
import {
  CalendarView,
  type CalendarReservation,
} from "@/components/CalendarView";
import { ErrorState } from "@/components/ErrorState";
import { useResponsive, WIDE_MAX_WIDTH } from "@/lib/responsive";
import { LIVE_OPS } from "@/lib/queryOptions";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";

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

// Guardería: mismo shape que el baño (día único por `appointmentAt`), pero las
// horas de entrada/salida sí importan — son las que definen el cobro.
// Se traen aquí porque /staff/stays devuelve SOLO `reservationType: STAY`: sin
// esto, una guardería del día no salía en el calendario por ningún lado.
function daycareToCalendarReservation(d: StaffDaycare): CalendarReservation {
  return {
    id: d.id,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    status: d.status,
    totalAmount: Number(d.totalAmount),
    reservationType: "DAYCARE",
    appointmentAt: d.appointmentAt,
    checkInTime: d.checkInTime ?? null,
    checkOutTime: d.checkOutTime ?? null,
    paymentType: d.paymentType,
    hasBalance: false,
    pet: {
      id: d.pet?.id ?? "",
      name: d.pet?.name ?? "—",
      breed: d.pet?.breed ?? null,
      photoUrl: d.pet?.photoUrl ?? null,
    },
    room: null,
    owner: {
      id: d.owner?.id ?? "",
      firstName: d.owner?.firstName ?? "",
      lastName: d.owner?.lastName ?? "",
    },
    staff: null,
    checklists: [],
  };
}

export default function StaffStays() {
  const router = useRouter();
  const { isTablet } = useResponsive();
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
    ...LIVE_OPS,
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
    ...LIVE_OPS,
  });

  const {
    data: daycaresData,
    isError: isErrorDaycares,
    error: errorDaycares,
    refetch: refetchDaycares,
    isRefetching: isRefetchingDaycares,
  } = useQuery({
    queryKey: ["staff", "daycares"],
    queryFn: () => getStaffDaycares(),
    ...LIVE_OPS,
  });

  useRefetchOnFocus([
    ["staff", "stays"],
    ["staff-baths"],
    ["staff", "daycares"],
  ]);

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
    const daycareList = (daycaresData?.daycares ?? []).map(
      daycareToCalendarReservation,
    );
    return [...stayList, ...bathList, ...daycareList];
  }, [stays, bathsData, daycaresData]);

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

  if (isError || isErrorBaths || isErrorDaycares) {
    return (
      <ErrorState
        error={error ?? errorBaths ?? errorDaycares}
        onRetry={() => {
          refetch();
          refetchBaths();
          refetchDaycares();
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
    // El calendario (que por dentro es un ScrollView) es la RAÍZ de la pantalla:
    // iOS 26 solo engancha el minimize del tab bar al scroll que es primera
    // subvista del view controller. Por eso el buscador viaja como `header`
    // dentro de su scroll y el tope de iPad va en su contentContainer.
    <CalendarView
      header={
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
      }
      maxWidth={isTablet ? WIDE_MAX_WIDTH : undefined}
      reservations={filtered}
      onPressReservation={(id) => {
        const target = filtered.find((r) => r.id === id);
        if (target?.reservationType === "BATH") {
          router.push(`/staff/bath/${id}` as any);
        } else if (target?.reservationType === "DAYCARE") {
          router.push(`/staff/daycare/${id}` as any);
        } else {
          router.push(`/staff/stay/${id}` as any);
        }
      }}
      showOwnerName
      refreshing={isRefetching || isRefetchingBaths || isRefetchingDaycares}
      onRefresh={() => {
        refetch();
        refetchBaths();
        refetchDaycares();
      }}
    />
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
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    padding: 0,
  },
});
