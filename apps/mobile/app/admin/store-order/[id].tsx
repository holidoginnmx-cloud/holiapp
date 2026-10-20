/**
 * Detalle de un pedido de la tienda en línea, para despacharlo desde la app.
 *
 * Envío nacional: se captura paquetería + guía. Al guardar, el servidor le manda
 * al cliente un CORREO con la guía (el de confirmación se lo prometió) y apaga
 * el recordatorio diario; aquí se ofrece además abrir WhatsApp con el mismo
 * mensaje ya escrito. WhatsApp no se manda solo: no hay API de WhatsApp
 * Business, así que el equipo solo toca «Enviar».
 *
 * Recoge en el hotel / domicilio: un botón para marcarlo «Entregado».
 *
 * El texto del mensaje lo arma el servidor (lib/storeShipment.ts) para que el
 * correo y el WhatsApp digan lo mismo y se pueda cambiar sin OTA.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
  TextInput,
  Linking,
  Share,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { COLORS } from "@/constants/colors";
import { buildWhatsappUrlTo } from "@/constants/business";
import {
  getAdminStoreOrder,
  markStoreOrderDelivered,
  saveStoreOrderShipment,
  type StoreOrder,
} from "@/lib/api";
import { formatCurrencyExact, formatDateTimeShort } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from "@/components/KeyboardDoneBar";
import { alertaDeError } from "@/lib/errorAlert";
import { FULFILLMENT_LABEL, estadoPedido } from "@/lib/storeOrderLabels";

const OTRA = "Otra";

export default function StoreOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "storeOrders", "detail", id],
    queryFn: () => getAdminStoreOrder(String(id)),
    enabled: !!id,
  });

  const order = data?.order;
  const carriers = data?.carriers ?? [];

  // ── Formulario de la guía ────────────────────────────────────────────────
  const [editando, setEditando] = useState(false);
  const [carrierChip, setCarrierChip] = useState<string | null>(null);
  const [carrierOtra, setCarrierOtra] = useState("");
  const [guia, setGuia] = useState("");
  const [telefono, setTelefono] = useState("");

  // Precarga con lo guardado (para corregir) y el teléfono sugerido.
  useEffect(() => {
    if (!order) return;
    const c = order.trackingCarrier ?? "";
    if (c && !carriers.includes(c)) {
      setCarrierChip(OTRA);
      setCarrierOtra(c);
    } else {
      setCarrierChip(c || null);
    }
    setGuia(order.trackingNumber ?? "");
    setTelefono((prev) => prev || order.customerPhone || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.trackingCarrier, order?.trackingNumber]);

  const carrier = carrierChip === OTRA ? carrierOtra.trim() : (carrierChip ?? "");

  const refrescar = async (o: StoreOrder) => {
    queryClient.setQueryData(["admin", "storeOrders", "detail", id], { carriers, order: o });
    await queryClient.invalidateQueries({ queryKey: ["admin", "storeOrders"] });
  };

  const abrirWhatsapp = async (message: string) => {
    const url = buildWhatsappUrlTo(telefono, message);
    if (!url) {
      // Sin número válido: la hoja de compartir deja copiarlo o mandarlo por
      // otro medio, en vez de abrir WhatsApp con un número roto.
      await Share.share({ message });
      return;
    }
    try {
      await Linking.openURL(url);
    } catch (err) {
      alertaDeError(err, { titulo: "No se pudo abrir WhatsApp" });
    }
  };

  const guardar = useMutation({
    mutationFn: () =>
      saveStoreOrderShipment(String(id), { carrier, trackingNumber: guia.trim() }),
    onSuccess: async (res) => {
      await refrescar(res.order);
      setEditando(false);
      const correo = res.emailSkipped
        ? "La guía no cambió, así que no se le volvió a mandar correo."
        : res.emailSentTo
          ? `Le mandamos un correo a ${res.emailSentTo} con la guía.`
          : "No se pudo mandar el correo al cliente; avísale por WhatsApp.";
      const msg = res.order.shipmentMessage;
      Alert.alert("Guía guardada ✅", `${correo}\n\n¿Le avisas también por WhatsApp?`, [
        { text: "Ahora no", style: "cancel" },
        ...(msg ? [{ text: "Abrir WhatsApp", onPress: () => void abrirWhatsapp(msg) }] : []),
      ]);
    },
    onError: (e) =>
      alertaDeError(e, { titulo: "No se pudo guardar la guía", respaldo: "Intenta de nuevo." }),
  });

  const entregar = useMutation({
    mutationFn: () => markStoreOrderDelivered(String(id)),
    onSuccess: async (res) => {
      await refrescar(res.order);
    },
    onError: (e) => alertaDeError(e, { titulo: "No se pudo marcar como entregado" }),
  });

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const estado = estadoPedido(order);
  const esEnvio = order.fulfillmentType === "NATIONAL_SHIPPING";
  const tieneGuia = !!(order.trackingCarrier && order.trackingNumber);
  const pagado = order.status === "PAID" || order.status === "FULFILLED";
  const mostrarForm = esEnvio && pagado && (!tieneGuia || editando);
  const puedeGuardar = !!carrier && !!guia.trim() && !guardar.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerLabel}>Pedido #{order.orderNumber}</Text>
          <Text style={styles.headerAmount}>{formatCurrencyExact(order.total)}</Text>
          <View style={[styles.pill, { backgroundColor: estado.bg }]}>
            <Text style={[styles.pillText, { color: estado.fg }]}>{estado.label}</Text>
          </View>
          {order.paidAt && (
            <Text style={styles.headerDate}>Pagado el {formatDateTimeShort(order.paidAt)}</Text>
          )}
        </View>

        {/* ── Guía del envío ── */}
        {esEnvio && pagado && (
          <View style={[styles.card, order.pending && styles.cardAviso]}>
            <Text style={styles.cardTitle}>Guía del envío</Text>

            {mostrarForm ? (
              <>
                <Text style={styles.hint}>
                  Al guardarla le mandamos un correo al cliente con la guía, y deja de
                  llegar el recordatorio.
                </Text>
                <Text style={styles.label}>Paquetería</Text>
                <View style={styles.chips}>
                  {[...carriers, OTRA].map((c) => {
                    const activo = carrierChip === c;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => setCarrierChip(c)}
                        style={[styles.chip, activo && styles.chipActivo]}
                      >
                        <Text style={[styles.chipText, activo && styles.chipTextActivo]}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {carrierChip === OTRA && (
                  <TextInput
                    style={styles.input}
                    value={carrierOtra}
                    onChangeText={setCarrierOtra}
                    placeholder="Nombre de la paquetería"
                    placeholderTextColor={COLORS.textDisabled}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                )}
                <Text style={styles.label}>Número de guía</Text>
                <TextInput
                  style={styles.input}
                  value={guia}
                  onChangeText={setGuia}
                  placeholder="Ej. 1234567890"
                  placeholderTextColor={COLORS.textDisabled}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                <Pressable
                  onPress={() => guardar.mutate()}
                  disabled={!puedeGuardar}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    !puedeGuardar && styles.btnDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {guardar.isPending ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Guardar y avisar al cliente</Text>
                  )}
                </Pressable>
                {tieneGuia && (
                  <Pressable onPress={() => setEditando(false)} style={styles.linkBtn}>
                    <Text style={styles.linkBtnText}>Cancelar</Text>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <Row label="Paquetería" value={order.trackingCarrier ?? "—"} />
                <Row label="Guía" value={order.trackingNumber ?? "—"} selectable />
                {order.trackingUrl && (
                  <Pressable onPress={() => Linking.openURL(order.trackingUrl!)} style={styles.linkBtn}>
                    <Text style={styles.linkBtnText}>Ver rastreo</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setEditando(true)} style={styles.linkBtn}>
                  <Text style={styles.linkBtnText}>Corregir guía</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* ── Avisar por WhatsApp (ya con guía) ── */}
        {esEnvio && pagado && tieneGuia && order.shipmentMessage && !mostrarForm && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Avisar por WhatsApp</Text>
            <Text style={styles.hint}>
              {order.customerPhone
                ? "Revisa el número y toca el botón: WhatsApp se abre con el mensaje ya escrito."
                : "No encontramos su teléfono. Escríbelo, o comparte el mensaje por otro medio."}
            </Text>
            <TextInput
              style={styles.input}
              value={telefono}
              onChangeText={setTelefono}
              placeholder="Teléfono a 10 dígitos"
              placeholderTextColor={COLORS.textDisabled}
              keyboardType="phone-pad"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
            />
            <View style={styles.mensaje}>
              <Text style={styles.mensajeText} selectable>
                {order.shipmentMessage}
              </Text>
            </View>
            <Pressable
              onPress={() => void abrirWhatsapp(order.shipmentMessage!)}
              style={({ pressed }) => [styles.whatsBtn, pressed && styles.pressed]}
            >
              <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
              <Text style={styles.primaryBtnText}>
                {buildWhatsappUrlTo(telefono, "x") ? "Abrir WhatsApp" : "Compartir mensaje"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* ── Entregar (recoge / domicilio) ── */}
        {!esEnvio && order.status === "PAID" && (
          <View style={[styles.card, styles.cardAviso]}>
            <Text style={styles.cardTitle}>{FULFILLMENT_LABEL[order.fulfillmentType]}</Text>
            <Text style={styles.hint}>
              Cuando el cliente ya lo tenga, márcalo como entregado para que deje de
              llegar el recordatorio.
            </Text>
            <Pressable
              onPress={() =>
                Alert.alert("¿Marcar como entregado?", `Pedido #${order.orderNumber}`, [
                  { text: "Cancelar", style: "cancel" },
                  { text: "Entregado", onPress: () => entregar.mutate() },
                ])
              }
              disabled={entregar.isPending}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            >
              {entregar.isPending ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryBtnText}>Marcar como entregado</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* ── Artículos ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Artículos</Text>
          {order.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>
                  {it.quantity > 1 ? `${it.quantity}× ` : ""}
                  {it.name}
                </Text>
                {it.variant && <Text style={styles.itemSub}>{it.variant}</Text>}
              </View>
              <Text style={styles.itemPrice}>{formatCurrencyExact(it.lineTotal)}</Text>
            </View>
          ))}
          {order.shippingTotal > 0 && <Row label="Envío" value={formatCurrencyExact(order.shippingTotal)} />}
          {order.discountTotal > 0 && (
            <Row label="Descuento" value={`−${formatCurrencyExact(order.discountTotal)}`} />
          )}
          <Row label="Total" value={formatCurrencyExact(order.total)} bold />
        </View>

        {/* ── Cliente y entrega ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cliente</Text>
          {order.customerName && <Row label="Nombre" value={order.customerName} />}
          {order.email && <Row label="Correo" value={order.email} selectable />}
          {order.customerPhone && <Row label="Teléfono" value={order.customerPhone} selectable />}
          <Row label="Entrega" value={FULFILLMENT_LABEL[order.fulfillmentType]} />
          {order.shippingAddress && (
            <View style={styles.addr}>
              <Text style={styles.rowLabel}>Dirección</Text>
              <Text style={styles.addrText} selectable>
                {order.shippingAddress}
              </Text>
            </View>
          )}
          {order.notes && (
            <View style={styles.addr}>
              <Text style={styles.rowLabel}>Notas</Text>
              <Text style={styles.addrText}>{order.notes}</Text>
            </View>
          )}
        </View>
      </ScrollView>
      <KeyboardDoneBar />
    </KeyboardAvoidingView>
  );
}

function Row({
  label,
  value,
  bold,
  selectable,
}: {
  label: string;
  value: string;
  bold?: boolean;
  selectable?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]} selectable={selectable}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  header: { alignItems: "center", paddingVertical: 16, gap: 4 },
  headerLabel: { fontSize: 14, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_600SemiBold" },
  headerAmount: {
    fontSize: 34,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  headerDate: { fontSize: 13, color: COLORS.textSecondary, fontFamily: "PlusJakartaSans_400Regular" },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  card: {
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
  cardAviso: { borderWidth: 1, borderColor: COLORS.warningBg },
  cardTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary, marginBottom: 6 },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_400Regular",
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    marginTop: 4,
    marginBottom: 6,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  chipActivo: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_600SemiBold" },
  chipTextActivo: { color: COLORS.white },
  input: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  whatsBtn: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: COLORS.whatsapp,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: COLORS.white, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  btnDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  linkBtn: { alignItems: "center", paddingVertical: 8 },
  linkBtnText: {
    fontSize: 13,
    color: COLORS.primary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    textDecorationLine: "underline",
  },
  mensaje: { backgroundColor: COLORS.bgSection, borderRadius: 10, padding: 12, marginBottom: 10 },
  mensajeText: { fontSize: 13, lineHeight: 19, color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_400Regular" },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  itemName: { fontSize: 14, color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_600SemiBold" },
  itemSub: { fontSize: 12, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_400Regular" },
  itemPrice: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontVariant: ["tabular-nums"],
    marginLeft: 8,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  rowLabel: { fontSize: 13, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_400Regular" },
  rowValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  rowBold: { fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary, fontSize: 15 },
  addr: { paddingVertical: 6 },
  addrText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 2,
  },
});
