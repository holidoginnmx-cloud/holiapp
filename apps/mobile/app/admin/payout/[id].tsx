/**
 * Desglose de un depósito de Stripe: qué cobros lo componen, línea por línea.
 *
 * Se muestran TODAS las líneas, también las que no cruzaron con ninguna reserva
 * (ajustes, cargos de Stripe, cobros huérfanos). Ocultar una porque no supimos
 * identificarla haría que la suma no cuadre con el monto del banco y el dueño
 * creería que le faltan pesos.
 */
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import {
  getAdminPayoutBreakdown,
  registrarCobroDeDeposito,
  type PayoutLine,
} from "@/lib/api";
import { formatCurrencyExact, formatArrivalDate } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

/** Etiqueta legible de cada tipo de movimiento de Stripe. */
function tipoLabel(type: string): string {
  if (type === "charge" || type === "payment") return "Cobro";
  if (type.startsWith("refund") || type === "payment_refund") return "Reembolso";
  if (type === "adjustment") return "Ajuste / contracargo";
  if (type === "stripe_fee") return "Cargo de Stripe";
  if (type === "payout_cancel") return "Depósito cancelado";
  if (type === "payout_failure") return "Depósito fallido";
  return `Otro (${type})`;
}

function lineaIcono(l: PayoutLine): keyof typeof Ionicons.glyphMap {
  if (l.match?.kind === "STORE_ORDER") return "bag-outline";
  if (l.match?.kind === "REFUND" || l.net < 0) return "arrow-undo-outline";
  if (l.match?.kind === "RESERVATION" || l.match?.kind === "SIN_REGISTRAR") {
    return "paw-outline";
  }
  return "ellipse-outline";
}

export default function PayoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "payouts", "detail", id],
    queryFn: () => getAdminPayoutBreakdown(String(id)),
    enabled: !!id,
  });

  const queryClient = useQueryClient();

  // Dar de alta un cobro que Stripe depositó pero que nunca llegó a `payments`.
  // El servidor es el que decide monto (bruto), comisión y tipo de pago: aquí
  // sólo se manda el id de la línea. Es idempotente allá, así que un doble toque
  // no duplica el ingreso.
  const registrar = useMutation({
    mutationFn: (linea: PayoutLine) =>
      registrarCobroDeDeposito(linea.id, linea.match?.reservationId ?? undefined),
    onSuccess: async (res) => {
      // Todo lo del admin depende de este pago: el desglose del depósito, la
      // reserva, los ingresos del mes.
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      Alert.alert(
        res.creado ? "Pago registrado" : "Ya estaba registrado",
        res.creado
          ? `Se registró el cobro de ${formatCurrencyExact(res.amount)} en su reserva. El saldo pendiente ya lo toma en cuenta.`
          : "Este cobro ya existía como pago; no se duplicó nada.",
      );
    },
    onError: (e) =>
      Alert.alert(
        "No se pudo registrar",
        e instanceof Error ? e.message : "Intenta de nuevo en un momento.",
      ),
  });

  const confirmarRegistro = (l: PayoutLine) => {
    const quien = l.match?.petNames.length ? l.match.petNames.join(", ") : (l.match?.ownerName ?? "esta reserva");
    Alert.alert(
      "¿Registrar este cobro?",
      `Se agregará un pago de ${formatCurrencyExact(l.gross)} a la reserva de ${quien}` +
        (l.fee > 0
          ? `. La comisión de Stripe (${formatCurrencyExact(l.fee)}) se guarda aparte, así que los ingresos cuentan el neto.`
          : "."),
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Registrar", onPress: () => registrar.mutate(l) },
      ],
    );
  };

  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Tres grupos, no dos: un cobro que sabemos de quién es pero que nunca se
  // registró como pago no es lo mismo que una comisión de Stripe, y mezclarlos
  // esconde justo lo que hay que revisar.
  const conPago = data.lines.filter((l) => l.match && l.match.kind !== "SIN_REGISTRAR");
  const sinRegistrar = data.lines.filter((l) => l.match?.kind === "SIN_REGISTRAR");
  const sinIdentificar = data.lines.filter((l) => !l.match);

  const renderLinea = (l: PayoutLine) => {
    const m = l.match;
    const negativo = l.net < 0;
    const quien = m
      ? m.kind === "STORE_ORDER"
        ? `Pedido #${m.orderNumber ?? "—"}`
        : m.petNames.length > 0
          ? m.petNames.join(", ")
          : (m.ownerName ?? "Sin mascota registrada")
      : tipoLabel(l.type);

    const irADetalle =
      m?.reservationId
        ? () => router.push(`/admin/reservation/${m.reservationId}` as any)
        : undefined;

    return (
      <Pressable
        key={l.id}
        disabled={!irADetalle}
        onPress={irADetalle}
        style={({ pressed }) => [
          styles.linea,
          !m && styles.lineaSinMatch,
          pressed && irADetalle && styles.lineaPressed,
        ]}
      >
        <View style={styles.lineaIconWrap}>
          <Ionicons
            name={lineaIcono(l)}
            size={15}
            color={m ? COLORS.primary : COLORS.textTertiary}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.lineaQuien} numberOfLines={1}>
            {quien}
          </Text>
          <Text style={styles.lineaSub} numberOfLines={1}>
            {m
              ? [m.serviceLabel, m.ownerName].filter(Boolean).join(" · ")
              : (l.description ?? "Movimiento de Stripe sin reserva asociada")}
          </Text>
          {l.fee > 0 && (
            <Text style={styles.lineaFee}>
              Bruto {formatCurrencyExact(l.gross)} · comisión −{formatCurrencyExact(l.fee)}
            </Text>
          )}
        </View>

        <View style={styles.lineaMontos}>
          <Text style={[styles.lineaNeto, negativo && styles.negativo]}>
            {negativo ? "−" : ""}
            {formatCurrencyExact(Math.abs(l.net))}
          </Text>
          {irADetalle && (
            <Ionicons name="chevron-forward" size={14} color={COLORS.textDisabled} />
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* Encabezado: el número que el dueño ve en su estado de cuenta */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Depositado a tu cuenta</Text>
        <Text style={styles.headerAmount}>{formatCurrencyExact(data.amount)}</Text>
        <Text style={styles.headerDate}>{formatArrivalDate(data.arrivalDate)}</Text>
      </View>

      {/* Cuadre. Si no cuadra se dice con todas sus letras: es preferible que el
          dueño desconfíe del desglose a que confíe en un número mal sumado. */}
      <View style={styles.sectionCard}>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Cobros (bruto)</Text>
          <Text style={styles.resumenValor}>{formatCurrencyExact(data.totals.gross)}</Text>
        </View>
        <View style={styles.resumenRow}>
          <Text style={styles.resumenLabel}>Comisiones de Stripe</Text>
          <Text style={[styles.resumenValor, styles.negativo]}>
            −{formatCurrencyExact(data.totals.fees)}
          </Text>
        </View>
        <View style={[styles.resumenRow, styles.resumenTotal]}>
          <Text style={styles.resumenLabelTotal}>Depósito</Text>
          <Text style={styles.resumenValorTotal}>{formatCurrencyExact(data.totals.net)}</Text>
        </View>

        {data.cuadra ? (
          <View style={styles.cuadraOk}>
            <Ionicons name="checkmark-circle" size={15} color={COLORS.successText} />
            <Text style={styles.cuadraOkText}>
              Cuadra exacto con lo que llegó al banco
            </Text>
          </View>
        ) : (
          <View style={styles.cuadraMal}>
            <Ionicons name="alert-circle" size={15} color={COLORS.warningText} />
            <Text style={styles.cuadraMalText}>
              El desglose difiere en {formatCurrencyExact(Math.abs(data.diferencia))} del
              depósito. Revísalo en el panel de Stripe.
            </Text>
          </View>
        )}
      </View>

      {/* Cobros identificados */}
      {conPago.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>De qué viene ({conPago.length})</Text>
          {conPago.map(renderLinea)}
        </View>
      )}

      {/* Cobrados y depositados, pero sin pago registrado. Se muestran con
          nombre y todo: el dinero ya entró, y la reserva sigue apareciendo
          como si debiera. */}
      {sinRegistrar.length > 0 && (
        <View style={[styles.sectionCard, styles.sectionAviso]}>
          <View style={styles.avisoHeader}>
            <Ionicons name="alert-circle" size={16} color={COLORS.warningText} />
            <Text style={styles.avisoTitle}>
              Cobros sin registrar ({sinRegistrar.length})
            </Text>
          </View>
          <Text style={styles.sectionHint}>
            Stripe cobró y depositó este dinero, pero no quedó registrado como pago
            en la app: esas reservas siguen apareciendo como si debieran
            {data.totals.sinRegistrarMonto > 0
              ? ` ${formatCurrencyExact(data.totals.sinRegistrarMonto)}`
              : ""}
            .
          </Text>
          {sinRegistrar.map((l) => {
            // Sin reserva identificada no hay dónde colgar el pago: se dice, en
            // vez de ofrecer un botón que sólo puede fallar.
            const puedeRegistrar = !!l.match?.reservationId && l.gross > 0;
            return (
              <View key={`sr-${l.id}`}>
                {renderLinea(l)}
                {puedeRegistrar ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.registrarBtn,
                      pressed && styles.lineaPressed,
                    ]}
                    onPress={() => confirmarRegistro(l)}
                    disabled={registrar.isPending}
                  >
                    {/* El spinner va sólo en la fila que se está registrando.
                        `isPending` a secas es de la mutación, no de la línea:
                        ponerlo en todas parecía que se estaban registrando
                        todos los cobros a la vez. */}
                    {registrar.isPending && registrar.variables?.id === l.id ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Ionicons
                        name="add-circle-outline"
                        size={15}
                        color={COLORS.primary}
                      />
                    )}
                    <Text style={styles.registrarBtnText}>
                      Registrar como pago de la reserva
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.registrarNota}>
                    No pudimos saber a qué reserva pertenece. Regístralo a mano
                    desde la reserva del cliente.
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Sin identificar — SIEMPRE visibles, nunca se suman en silencio */}
      {sinIdentificar.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            Ajustes de Stripe ({sinIdentificar.length})
          </Text>
          <Text style={styles.sectionHint}>
            No corresponden a ninguna reserva ni pedido, pero sí afectan el monto
            depositado.
          </Text>
          {sinIdentificar.map(renderLinea)}
        </View>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  header: { alignItems: "center", paddingVertical: 20 },
  headerLabel: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  headerAmount: {
    fontSize: 36,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
    marginTop: 4,
  },
  headerDate: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  registrarBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 6,
    marginBottom: 4,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  registrarBtnText: {
    fontSize: 13,
    color: COLORS.primary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  registrarNota: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_400Regular",
    marginBottom: 8,
    lineHeight: 16,
  },
  sectionAviso: {
    borderWidth: 1,
    borderColor: COLORS.warningBg,
  },
  avisoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  avisoTitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.warningText,
  },
  // Resumen de cuadre
  resumenRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  resumenLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontFamily: "PlusJakartaSans_400Regular",
  },
  resumenValor: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  resumenTotal: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    marginTop: 4,
    paddingTop: 10,
  },
  resumenLabelTotal: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  resumenValorTotal: {
    fontSize: 17,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_700Bold",
    fontVariant: ["tabular-nums"],
  },
  negativo: { color: COLORS.errorText },
  cuadraOk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.successBg,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  cuadraOkText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.successText,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  cuadraMal: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: COLORS.warningBg,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  cuadraMalText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.warningText,
    fontFamily: "PlusJakartaSans_600SemiBold",
    lineHeight: 16,
  },
  // Líneas
  linea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  lineaSinMatch: { opacity: 0.75 },
  lineaPressed: { opacity: 0.6 },
  lineaIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  lineaQuien: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  lineaSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 1,
  },
  lineaFee: {
    fontSize: 11,
    color: COLORS.textDisabled,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  lineaMontos: { flexDirection: "row", alignItems: "center", gap: 2 },
  lineaNeto: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
  },
});
