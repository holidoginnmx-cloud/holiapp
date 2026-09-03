import { COLORS } from "@/constants/colors";
import { TabFab } from "@/components/TabFab";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  getReservations,
  listAdminChangeRequests,
} from "@/lib/api";
import {
  CalendarView,
  type CalendarReservation,
} from "@/components/CalendarView";
import { ErrorState } from "@/components/ErrorState";
import { LIVE_OPS } from "@/lib/queryOptions";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function AdminReservations() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "reservations"],
    queryFn: () => getReservations({}),
    ...LIVE_OPS,
  });

  // El calendario es la pantalla donde el equipo se cruza: lo que Jessica crea
  // en su teléfono tiene que aparecer aquí sin cerrar la app.
  useRefetchOnFocus([["admin", "reservations"]]);

  const { data: pendingChanges } = useQuery({
    queryKey: ["admin", "change-requests", "PENDING"],
    queryFn: () => listAdminChangeRequests("PENDING"),
    refetchInterval: 60_000,
  });
  const pendingCount = pendingChanges?.length ?? 0;

  // Filtra reservaciones con relaciones rotas (datos legacy con FK huérfana)
  // para que un registro corrupto no tumbe el calendario al renderizar.
  const safe = (data ?? []).filter((r) => r.pet);
  const filtered = safe.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.pet?.name?.toLowerCase().includes(q) ||
      r.room?.name?.toLowerCase().includes(q) ||
      r.staff?.firstName?.toLowerCase().includes(q)
    );
  });

  // El list item admin no trae `addons`. Usamos el flag `hasBath` del backend
  // cuando exista; si no, aproximamos con hasDeslanado/hasCorte (no detecta
  // baños sin extras — para eso el backend debe enviar `hasBath`).
  const calendarReservations: CalendarReservation[] = filtered.map((r) => ({
    ...(r as unknown as CalendarReservation),
    hasBath: r.hasBath ?? (r.hasDeslanado || r.hasCorte),
  }));

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
    // El calendario (ScrollView por dentro) es la RAÍZ de la pantalla: iOS 26
    // solo engancha el minimize del tab bar al scroll que es primera subvista del
    // view controller. Banner y buscador viajan como `header` dentro de su
    // scroll; el FAB queda de hermano absoluto en el fragmento.
    <>
      <CalendarView
        header={
          <>
            {pendingCount > 0 && (
              <TouchableOpacity
                style={styles.changesBanner}
                onPress={() => router.push("/admin/change-requests" as any)}
                activeOpacity={0.85}
              >
                <Ionicons name="swap-horizontal" size={18} color={COLORS.white} />
                <Text style={styles.changesBannerText}>
                  {pendingCount} solicitud{pendingCount === 1 ? "" : "es"} de cambio pendiente{pendingCount === 1 ? "" : "s"}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.white} />
              </TouchableOpacity>
            )}

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
          </>
        }
        reservations={calendarReservations}
        onPressReservation={(id) =>
          router.push(`/admin/reservation/${id}` as any)
        }
        showOwnerName
        showStaffName
        adminView
        refreshing={isRefetching}
        onRefresh={refetch}
      />

      {/* El "+" abre las dos altas que arrancan aquí: reservar de una vez, o
          cotizarle primero a quien todavía está preguntando. */}
      <TabFab
        style={styles.fab}
        onPress={() =>
          Alert.alert("¿Qué quieres crear?", undefined, [
            {
              text: "Reservación",
              onPress: () => router.push("/admin/reservation/create" as any),
            },
            {
              text: "Cotización",
              onPress: () => router.push("/admin/quotes/create" as any),
            },
            { text: "Cancelar", style: "cancel" },
          ])
        }
        testID="admin-reservations-create-fab"
      >
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TabFab>
    </>
  );
}

const styles = StyleSheet.create({
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
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    padding: 0,
  },
  fab: {
    position: "absolute",
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
