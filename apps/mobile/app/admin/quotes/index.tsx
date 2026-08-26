import { COLORS } from "@/constants/colors";
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ErrorState";
import { getQuotes, type QuoteListItem } from "@/lib/api";
import { formatCurrency, formatWeekdayDayShort } from "@/lib/format";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

type Filtro = "vigentes" | "vencidas" | "convertidas" | "todas";

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "vigentes", label: "Vigentes" },
  { key: "vencidas", label: "Por recotizar" },
  { key: "convertidas", label: "Cerradas" },
  { key: "todas", label: "Todas" },
];

/** El estado que le importa al equipo, no el del enum: la vigencia se deriva. */
function etiquetaEstado(q: QuoteListItem): { texto: string; color: string; fondo: string } {
  if (q.status === "CONVERTED") {
    return { texto: "Reservada", color: COLORS.successText, fondo: "#E6F4EA" };
  }
  if (q.status === "CANCELLED") {
    return { texto: "Cancelada", color: COLORS.textTertiary, fondo: COLORS.bgSection };
  }
  if (q.isExpired) {
    return { texto: "Vencida", color: COLORS.errorText, fondo: "#FDECEA" };
  }
  if (q.status === "SENT") {
    return { texto: "Enviada", color: COLORS.warningText, fondo: "#FDF0DC" };
  }
  return { texto: "Borrador", color: COLORS.textSecondary, fondo: COLORS.bgSection };
}

const SERVICIO: Record<string, { label: string; icon: "bed" | "cut" | "sunny" }> = {
  STAY: { label: "Hospedaje", icon: "bed" },
  BATH: { label: "Estética", icon: "cut" },
  DAYCARE: { label: "Guardería", icon: "sunny" },
};

function folioLegible(folio: number): string {
  return `COT-${String(folio).padStart(6, "0")}`;
}

export default function AdminQuotesList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filtro, setFiltro] = useState<Filtro>("vigentes");
  const [busqueda, setBusqueda] = useState("");

  const params =
    filtro === "convertidas"
      ? { status: "CONVERTED" as const }
      : filtro === "todas"
        ? {}
        : { bucket: filtro };

  const query = useQuery({
    queryKey: ["quotes", filtro, busqueda],
    queryFn: () => getQuotes({ ...params, q: busqueda.trim() || undefined }),
  });

  // Lo que se cotiza en un teléfono tiene que verse en el otro: la lista se
  // revalida al recuperar el foco. Por prefijo, así que alcanza a todos los
  // filtros y búsquedas cacheados.
  useRefetchOnFocus([["quotes"]]);

  const renderItem = useCallback(
    ({ item }: { item: QuoteListItem }) => {
      const estado = etiquetaEstado(item);
      const servicio = SERVICIO[item.reservationType] ?? SERVICIO.STAY;
      const mascotas = item.pets.map((p) => p.name).join(", ");
      return (
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push(`/admin/quotes/${item.id}`)}
          activeOpacity={0.7}
        >
          <View style={styles.cardHead}>
            <View style={styles.cardHeadLeft}>
              <Ionicons name={servicio.icon} size={15} color={COLORS.primary} />
              <Text style={styles.folio}>{folioLegible(item.folio)}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: estado.fondo }]}>
              <Text style={[styles.badgeText, { color: estado.color }]}>{estado.texto}</Text>
            </View>
          </View>

          <Text style={styles.cliente} numberOfLines={1}>
            {item.clientName}
            {!item.ownerId && <Text style={styles.prospecto}> · prospecto</Text>}
          </Text>
          {mascotas.length > 0 && (
            <Text style={styles.mascotas} numberOfLines={1}>
              🐾 {mascotas}
            </Text>
          )}

          <View style={styles.cardFoot}>
            <Text style={styles.total}>{formatCurrency(item.total)}</Text>
            <Text style={styles.meta}>
              {item.status === "CONVERTED"
                ? "Convertida"
                : item.isExpired
                  ? `Venció el ${formatWeekdayDayShort(new Date(item.validUntil))}`
                  : `Vigente al ${formatWeekdayDayShort(new Date(item.validUntil))}`}
              {item.viewCount > 0 && ` · vista ${item.viewCount}×`}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [router],
  );

  if (query.isError) {
    return <ErrorState message="No se pudieron cargar las cotizaciones" onRetry={query.refetch} />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Folio, cliente o mascota..."
          placeholderTextColor={COLORS.textDisabled}
          value={busqueda}
          onChangeText={setBusqueda}
          autoCorrect={false}
        />
        {busqueda.length > 0 && (
          <Ionicons
            name="close-circle"
            size={16}
            color={COLORS.textDisabled}
            onPress={() => setBusqueda("")}
          />
        )}
      </View>

      <View style={styles.chips}>
        {FILTROS.map((f) => {
          const activo = f.key === filtro;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, activo && styles.chipActivo]}
              onPress={() => setFiltro(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, activo && styles.chipTextActivo]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={query.data?.quotes ?? []}
          keyExtractor={(q) => q.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📄</Text>
              <Text style={styles.emptyTitle}>
                {busqueda.trim() ? "Sin coincidencias" : "Todavía no hay cotizaciones"}
              </Text>
              <Text style={styles.emptyText}>
                {busqueda.trim()
                  ? "Prueba con otro folio o nombre."
                  : "Cotiza en un minuto y mándalo por WhatsApp."}
              </Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        onPress={() => router.push("/admin/quotes/create")}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={26} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
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
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  chipActivo: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  chipText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
  },
  chipTextActivo: { color: COLORS.primary },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  cardHeadLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  folio: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold" },
  cliente: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  prospecto: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  mascotas: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  cardFoot: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 10,
  },
  total: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  meta: {
    flex: 1,
    textAlign: "right",
    fontSize: 11,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginTop: 12,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
    marginTop: 4,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
});
