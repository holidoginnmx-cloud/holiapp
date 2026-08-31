/**
 * Depósitos al banco — de qué reservas viene cada transferencia de Stripe.
 *
 * Stripe junta los cobros de varios clientes en un solo SPEI y lo manda sin
 * referencia útil, así que al ver "$663.80 de Stripe Payments Mexico" en el
 * estado de cuenta no había forma de saber a qué correspondía. Aquí se busca
 * por ese mismo monto, que es lo único que el banco sí muestra.
 */
import { useDeferredValue, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import {
  getAdminPayouts,
  getCobrosSinRegistrar,
  syncAdminPayouts,
  type PayoutSummary,
} from "@/lib/api";
import { formatCurrencyExact, formatArrivalDate } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  paid: { label: "Depositado", bg: COLORS.successBg, fg: COLORS.successText },
  in_transit: { label: "En camino", bg: COLORS.warningBg, fg: COLORS.warningText },
  pending: { label: "Pendiente", bg: COLORS.warningBg, fg: COLORS.warningText },
  failed: { label: "Rechazado", bg: COLORS.errorBg, fg: COLORS.errorText },
  canceled: { label: "Cancelado", bg: COLORS.errorBg, fg: COLORS.errorText },
};

export default function PayoutsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  // El input se pinta con `search` (responde a cada tecla) pero la consulta usa
  // el valor diferido: sin esto, teclear "663.80" dispara una búsqueda por cada
  // tecla y se ven estados intermedios absurdos ("Ningún depósito por $6.00").
  const searchDiferido = useDeferredValue(search);

  // Solo se filtra por monto si lo tecleado es un número POSITIVO. Un negativo
  // —pegado del estado de cuenta, o tecleado con teclado físico en iPad, que el
  // `decimal-pad` no puede impedir— la API lo rechaza con 400.
  const amount = useMemo(() => {
    const limpio = searchDiferido.replace(/[$,\s]/g, "");
    const n = Number(limpio);
    return limpio && Number.isFinite(n) && n > 0 ? limpio : undefined;
  }, [searchDiferido]);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "payouts", amount ?? "todos"],
    queryFn: () => getAdminPayouts({ limit: 30, amount }),
  });

  const queryClient = useQueryClient();

  // Cobros que Stripe depositó y que nunca llegaron a `payments`: dinero que
  // entró al banco y que los ingresos no cuentan. Estaban repartidos dentro de
  // cada depósito, así que para saber si había alguno pendiente había que
  // abrirlos uno por uno. No depende del filtro por monto: es un pendiente del
  // negocio, no un resultado de búsqueda.
  const { data: pendientes } = useQuery({
    queryKey: ["admin", "payouts", "sin-registrar"],
    queryFn: () => getCobrosSinRegistrar(30),
    staleTime: 60_000,
  });

  // Traer de Stripe lo que todavía no está en la base. El refetch de arriba solo
  // relee lo ya guardado: si el webhook `payout.paid` no llegó (endpoint mal
  // configurado, API caída, Stripe agotó sus reintentos), jalar la lista mil
  // veces seguiría mostrando la misma última fecha. Hay un cron diario que hace
  // esto solo; el botón es para no esperarlo.
  const sync = useMutation({
    mutationFn: () => syncAdminPayouts(15),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "payouts"] });
      // Un depósito que no se pudo bajar NO aparece en la lista: sin avisarlo,
      // la pantalla se veía al día cuando en realidad faltaba dinero por
      // conciliar.
      if (res.fallidos?.length > 0) {
        Alert.alert(
          "Faltaron depósitos por traer",
          `${res.fallidos.length} depósito(s) no se pudieron consultar en Stripe, así que todavía no aparecen aquí. Intenta de nuevo en un momento.`,
        );
      } else if (res.descuadrados?.length > 0) {
        Alert.alert(
          "Revisa estos depósitos",
          `${res.descuadrados.length} depósito(s) no cuadran con su desglose. El total del banco es correcto, pero el detalle no suma — conviene revisarlo en Stripe.`,
        );
      }
    },
    onError: () =>
      Alert.alert(
        "No se pudo actualizar",
        "No pudimos consultar Stripe en este momento. Intenta de nuevo en un minuto.",
      ),
  });

  // OJO: el error NO se renderiza con un `return` temprano. Eso desmontaría el
  // buscador junto con la pantalla, y quien llegara aquí con una búsqueda que
  // falla no podría ni corregir ni borrar el texto: solo salirse. El error va
  // dentro de la lista, con el input siempre montado.
  const payouts = data?.payouts ?? [];

  const renderItem = ({ item }: { item: PayoutSummary }) => {
    const estado = STATUS_LABEL[item.status] ?? {
      label: item.status,
      bg: COLORS.bgSection,
      fg: COLORS.textTertiary,
    };
    // Nombres y conteo van por separado a propósito. Antes se añadía " y más"
    // comparando `lineCount` contra `preview.length`, que no son la misma
    // escala: el preview trae mascotas DEDUPLICADAS y recortadas, y las líneas
    // de comisión o ajuste no aportan ninguna. Un depósito de dos cobros del
    // mismo perro decía "Bailey y más", insinuando un cliente que no existe.
    const movimientos = `${item.lineCount} ${item.lineCount === 1 ? "movimiento" : "movimientos"}`;
    const quienes =
      item.preview.length > 0
        ? `${item.preview.join(", ")} · ${movimientos}`
        : movimientos;

    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => router.push(`/admin/payout/${item.id}` as any)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.amount}>{formatCurrencyExact(item.amount)}</Text>
          <View style={[styles.chip, { backgroundColor: estado.bg }]}>
            <Text style={[styles.chipText, { color: estado.fg }]}>{estado.label}</Text>
          </View>
        </View>
        <Text style={styles.date}>{formatArrivalDate(item.arrivalDate)}</Text>
        <View style={styles.cardBottom}>
          <Ionicons name="paw-outline" size={13} color={COLORS.textTertiary} />
          <Text style={styles.preview} numberOfLines={1}>
            {quienes}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
        </View>
      </Pressable>
    );
  };

  const listHeader = (
    <>
      <Text style={styles.intro}>
        Busca por el monto que te llegó al banco para ver de qué reservas viene.
      </Text>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Monto del depósito, ej. 663.80"
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          keyboardType="decimal-pad"
          autoCapitalize="none"
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
      {pendientes && pendientes.cobros.length > 0 && (
        <View style={styles.pendientesCard}>
          <View style={styles.pendientesHeader}>
            <Ionicons name="alert-circle" size={16} color={COLORS.warningText} />
            <Text style={styles.pendientesTitle}>
              {pendientes.cobros.length} cobro
              {pendientes.cobros.length !== 1 ? "s" : ""} sin registrar ·{" "}
              {formatCurrencyExact(pendientes.total)} cobrados
            </Text>
          </View>
          <Text style={styles.pendientesHint}>
            Es lo que pagaron los clientes (a tu cuenta llegó eso menos la
            comisión de Stripe). No está en tus ingresos y esas reservas siguen
            apareciendo como si debieran. Ábrelos en su depósito para
            registrarlos.
          </Text>
          {pendientes.cobros.slice(0, 5).map((c) => (
            <Pressable
              key={c.lineId}
              style={({ pressed }) => [styles.pendienteRow, pressed && styles.cardPressed]}
              onPress={() => router.push(`/admin/payout/${c.payoutId}` as any)}
            >
              <Text style={styles.pendienteQuien} numberOfLines={1}>
                {c.petNames.length > 0
                  ? c.petNames.join(", ")
                  : (c.ownerName ?? "Sin identificar")}
                <Text style={styles.pendienteServicio}> · {c.serviceLabel}</Text>
              </Text>
              <Text style={styles.pendienteMonto}>{formatCurrencyExact(c.gross)}</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textDisabled} />
            </Pressable>
          ))}
          {pendientes.cobros.length > 5 && (
            <Text style={styles.pendientesHint}>
              y {pendientes.cobros.length - 5} más en sus depósitos.
            </Text>
          )}
        </View>
      )}
      <Pressable
        style={({ pressed }) => [styles.syncBtn, pressed && styles.cardPressed]}
        onPress={() => !sync.isPending && sync.mutate()}
        disabled={sync.isPending}
      >
        {sync.isPending ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Ionicons name="cloud-download-outline" size={16} color={COLORS.primary} />
        )}
        <Text style={styles.syncBtnText}>
          {sync.isPending ? "Buscando en Stripe…" : "Actualizar desde Stripe"}
        </Text>
      </Pressable>
      {!isLoading && !isError && (
        <Text style={styles.countLabel}>
          {amount
            ? `${payouts.length} depósito${payouts.length !== 1 ? "s" : ""} de ${formatCurrencyExact(Number(amount))}`
            : `Últimos ${payouts.length} depósito${payouts.length !== 1 ? "s" : ""}`}
        </Text>
      )}
    </>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={payouts}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching || sync.isPending}
          onRefresh={() => !sync.isPending && sync.mutate()}
          tintColor={COLORS.primary}
        />
      }
      ListEmptyComponent={
        isError ? (
          <ErrorState error={error} onRetry={refetch} compact />
        ) : isLoading ? (
          <ActivityIndicator
            size="large"
            color={COLORS.primary}
            style={{ marginTop: 40 }}
          />
        ) : (
          <View style={styles.emptyWrap}>
            <Ionicons name="business-outline" size={40} color={COLORS.textDisabled} />
            <Text style={styles.emptyText}>
              {amount
                ? `Ningún depósito por ${formatCurrencyExact(Number(amount))}`
                : "Todavía no hay depósitos registrados"}
            </Text>
            <Text style={styles.emptyHint}>
              {amount
                ? "Revisa el monto o busca por fecha borrando el filtro."
                : "Toca «Actualizar desde Stripe» para traer los que ya te depositó."}
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 32 },
  intro: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontFamily: "PlusJakartaSans_400Regular",
    marginBottom: 12,
    lineHeight: 18,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_400Regular",
    padding: 0,
  },
  pendientesCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.warningText,
    backgroundColor: COLORS.warningBg,
  },
  pendientesHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  pendientesTitle: {
    flex: 1,
    fontSize: 13,
    color: COLORS.warningText,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  pendientesHint: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.warningText,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 4,
  },
  pendienteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  pendienteQuien: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  pendienteServicio: {
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_400Regular",
  },
  pendienteMonto: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_700Bold",
    fontVariant: ["tabular-nums"],
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    backgroundColor: COLORS.white,
  },
  syncBtnText: {
    fontSize: 14,
    color: COLORS.primary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  countLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: { opacity: 0.7 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  amount: {
    fontSize: 24,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipText: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold" },
  date: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    marginTop: 2,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  preview: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    fontFamily: "PlusJakartaSans_400Regular",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  emptyHint: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textDisabled,
    textAlign: "center",
  },
});
