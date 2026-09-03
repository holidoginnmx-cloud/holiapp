import { COLORS } from "@/constants/colors";
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { ErrorState } from "@/components/ErrorState";
import {
  getQuote,
  markQuoteSent,
  cancelQuote,
  type QuoteDetail,
  type QuoteItemRow,
} from "@/lib/api";
import { buildWhatsappUrlTo } from "@/constants/business";
import { formatCurrency, formatWeekdayDayShort } from "@/lib/format";


import { alertaDeError } from "@/lib/errorAlert";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

function folioLegible(folio: number): string {
  return `COT-${String(folio).padStart(6, "0")}`;
}

const SERVICIO: Record<string, string> = {
  STAY: "Hospedaje",
  BATH: "Estética",
  DAYCARE: "Guardería",
  DELIVERY: "Servicio a domicilio",
};

export default function AdminQuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [trabajando, setTrabajando] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<QuoteDetail>({
    queryKey: ["quotes", "detail", id],
    queryFn: () => getQuote(id),
    enabled: Boolean(id),
  });

  const refrescar = useCallback(
    (detalle: QuoteDetail) => {
      queryClient.setQueryData(["quotes", "detail", id], detalle);
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    },
    [queryClient, id],
  );

  // ── Compartir ──────────────────────────────────────────────────────────────
  // Se abre WhatsApp con el número del CLIENTE y el mensaje ya escrito (el
  // texto lo arma el servidor, para que móvil y web manden lo mismo). Marcar
  // "enviada" pasa aquí, no en un botón aparte: compartir ES enviar.
  const compartirWhatsapp = useCallback(async () => {
    if (!data) return;
    const url = buildWhatsappUrlTo(
      data.quote.clientPhone ?? data.quote.owner?.phone ?? null,
      data.whatsappMessage,
    );
    if (!url) {
      Alert.alert(
        "Sin teléfono",
        "Esta cotización no tiene un WhatsApp válido. Copia el link y mándalo por otro medio.",
      );
      return;
    }
    setTrabajando(true);
    try {
      const detalle = await markQuoteSent(data.quote.id);
      refrescar(detalle);
      await Linking.openURL(url);
    } catch (err) {
      alertaDeError(err, { titulo: "No se pudo abrir WhatsApp" });
    } finally {
      setTrabajando(false);
    }
  }, [data, refrescar]);

  // Hoja de compartir del sistema: sirve para copiar el link o mandarlo por
  // otro medio (correo, Telegram) cuando el cliente no tiene WhatsApp. Se usa
  // `Share` del core y no expo-clipboard porque ese es un módulo NATIVO y esta
  // pantalla tiene que poder entregarse por OTA sobre el binario actual.
  const compartirLink = useCallback(async () => {
    if (!data) return;
    try {
      const res = await Share.share({ message: data.whatsappMessage });
      // Solo se sella el envío si de verdad compartió: en iOS, cerrar la hoja
      // devuelve "dismissedAction".
      if (res.action === Share.sharedAction) {
        const detalle = await markQuoteSent(data.quote.id);
        refrescar(detalle);
      }
    } catch (err) {
      alertaDeError(err, { titulo: "No se pudo compartir" });
    }
  }, [data, refrescar]);

  const verComoCliente = useCallback(async () => {
    if (!data) return;
    await WebBrowser.openBrowserAsync(data.publicUrl);
  }, [data]);

  const cancelar = useCallback(() => {
    if (!data) return;
    Alert.alert("Cancelar cotización", "Deja de estar vigente. ¿Continuar?", [
      { text: "No", style: "cancel" },
      {
        text: "Cancelar cotización",
        style: "destructive",
        onPress: async () => {
          setTrabajando(true);
          try {
            const detalle = await cancelQuote(data.quote.id);
            refrescar(detalle);
          } catch (err) {
            alertaDeError(err, { titulo: "No se pudo cancelar" });
          } finally {
            setTrabajando(false);
          }
        },
      },
    ]);
  }, [data, refrescar]);

  // ── Convertir en reserva ───────────────────────────────────────────────────
  // No crea la reserva de golpe: precarga el formulario de siempre, donde el
  // operador elige cuarto u hora exacta (lo que una cotización no aparta) y
  // POST /reservations valida cupo y agenda de verdad.
  const convertir = useCallback(() => {
    if (!data) return;
    if (data.isExpired) {
      Alert.alert(
        "Cotización vencida",
        "Los precios pueden haber cambiado. Extiende la vigencia o haz una cotización nueva antes de reservar.",
      );
      return;
    }
    router.push(`/admin/reservation/create?quoteId=${data.quote.id}`);
  }, [data, router]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  if (isError || !data) {
    return <ErrorState message="No se pudo cargar la cotización" onRetry={refetch} />;
  }

  const { quote, isExpired } = data;
  const cerrada = quote.status === "CONVERTED" || quote.status === "CANCELLED";
  const lineasGrupo = quote.items.filter((i) => i.quotePetId === null);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Estado */}
        {quote.status === "CONVERTED" && (
          <View style={[styles.banner, styles.bannerOk]}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.successText} />
            <Text style={[styles.bannerText, { color: COLORS.successText }]}>
              Ya se convirtió en reservación.
            </Text>
          </View>
        )}
        {quote.status === "CANCELLED" && (
          <View style={[styles.banner, styles.bannerNeutral]}>
            <Text style={styles.bannerText}>Cotización cancelada.</Text>
          </View>
        )}
        {isExpired && !cerrada && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Ionicons name="time-outline" size={16} color={COLORS.errorText} />
            <Text style={[styles.bannerText, { color: COLORS.errorText }]}>
              Venció el {formatWeekdayDayShort(new Date(quote.validUntil))}. Recotiza
              antes de reservar.
            </Text>
          </View>
        )}

        {/* Encabezado */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.folio}>{folioLegible(quote.folio)}</Text>
            <Text style={styles.servicio}>{SERVICIO[quote.reservationType]}</Text>
          </View>
          <Text style={styles.cliente}>{quote.clientName}</Text>
          {!quote.ownerId && (
            <Text style={styles.prospecto}>
              Prospecto sin cuenta{quote.clientPhone ? ` · ${quote.clientPhone}` : ""}
            </Text>
          )}
          {quote.viewCount > 0 && (
            <Text style={styles.vistas}>
              El cliente la abrió {quote.viewCount} {quote.viewCount === 1 ? "vez" : "veces"}
            </Text>
          )}
        </View>

        {/* Desglose */}
        <Text style={styles.label}>Desglose</Text>
        <View style={styles.card}>
          {quote.pets.map((p) => (
            <View key={p.id} style={styles.petBlock}>
              <Text style={styles.petName}>
                {p.name}
                {p.weightKg != null && (
                  <Text style={styles.petInfo}> · {p.weightKg} kg</Text>
                )}
              </Text>
              {p.items.map((item) => (
                <LineaDesglose key={item.id} item={item} />
              ))}
            </View>
          ))}
          {lineasGrupo.map((item) => (
            <LineaDesglose key={item.id} item={item} />
          ))}

          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(quote.total)}</Text>
          </View>
          {quote.depositSuggested != null && Number(quote.depositSuggested) > 0 && (
            <View style={styles.linea}>
              <Text style={styles.lineaLabel}>Para apartar</Text>
              <Text style={styles.lineaAmount}>{formatCurrency(quote.depositSuggested)}</Text>
            </View>
          )}
        </View>

        {/* Notas */}
        {quote.notes && (
          <>
            <Text style={styles.label}>Nota para el cliente</Text>
            <View style={styles.card}>
              <Text style={styles.nota}>{quote.notes}</Text>
            </View>
          </>
        )}
        {quote.internalNotes && (
          <>
            <Text style={styles.label}>Nota interna</Text>
            <View style={[styles.card, styles.cardInterna]}>
              <Text style={styles.nota}>{quote.internalNotes}</Text>
              <Text style={styles.internaHint}>
                Nunca sale en la cotización que ve el cliente.
              </Text>
            </View>
          </>
        )}

        {/* Acciones secundarias */}
        <TouchableOpacity style={styles.accion} onPress={verComoCliente} activeOpacity={0.7}>
          <Ionicons name="eye-outline" size={18} color={COLORS.primary} />
          <Text style={styles.accionText}>Ver como la ve el cliente</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.accion} onPress={compartirLink} activeOpacity={0.7}>
          <Ionicons name="share-outline" size={18} color={COLORS.primary} />
          <Text style={styles.accionText}>Compartir de otra forma</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
        </TouchableOpacity>

        {/* Una cotización de solo traslado no se convierte: el domicilio viaja
            pegado a un servicio, así que no hay nada que agendar por sí solo.
            El motivo lo manda la API para no repetir la regla en cada cliente. */}
        {!cerrada && data.prefill.convertible !== false && (
          <TouchableOpacity style={styles.accion} onPress={convertir} activeOpacity={0.7}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
            <Text style={styles.accionText}>Convertir en reservación</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
          </TouchableOpacity>
        )}

        {!cerrada &&
          data.prefill.convertible === false &&
          !!data.prefill.noConvertibleMotivo && (
            <Text style={styles.noConvertible}>
              {data.prefill.noConvertibleMotivo}
            </Text>
          )}

        {!cerrada && (
          <TouchableOpacity
            style={[styles.accion, styles.accionPeligro]}
            onPress={cancelar}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle-outline" size={18} color={COLORS.errorText} />
            <Text style={[styles.accionText, { color: COLORS.errorText }]}>
              Cancelar cotización
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {!cerrada && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
          <TouchableOpacity
            style={[styles.submitBtn, trabajando && styles.submitBtnDisabled]}
            onPress={compartirWhatsapp}
            disabled={trabajando}
            activeOpacity={0.85}
          >
            {trabajando ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
                <Text style={styles.submitText}>
                  {quote.sentCount > 0 ? "Reenviar por WhatsApp" : "Enviar por WhatsApp"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/** Una línea del desglose. Las cortesías muestran su precio, no un $0 mudo. */
function LineaDesglose({ item }: { item: QuoteItemRow }) {
  return (
    <View style={styles.linea}>
      <View style={{ flex: 1 }}>
        <Text style={styles.lineaLabel}>{item.label}</Text>
        {item.detail && <Text style={styles.lineaDetalle}>{item.detail}</Text>}
      </View>
      {item.isCourtesy ? (
        <View style={styles.cortesiaBox}>
          <Text style={styles.tachado}>{formatCurrency(item.listPrice)}</Text>
          <Text style={styles.cortesia}>Cortesía</Text>
        </View>
      ) : (
        <Text
          style={[styles.lineaAmount, item.kind === "DISCOUNT" && styles.lineaNegativa]}
        >
          {formatCurrency(item.amount)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  noConvertible: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "PlusJakartaSans_500Medium",
    color: COLORS.textSecondary,
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 12,
  },
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 32 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  bannerOk: { backgroundColor: "#E6F4EA" },
  bannerWarn: { backgroundColor: "#FDECEA" },
  bannerNeutral: { backgroundColor: COLORS.bgSection },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 14,
    marginBottom: 12,
  },
  cardInterna: { backgroundColor: COLORS.bgSection },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  folio: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  servicio: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  cliente: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  prospecto: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  vistas: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.successText,
    marginTop: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  petBlock: { marginBottom: 10 },
  petName: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  petInfo: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  linea: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 5,
    gap: 12,
  },
  lineaLabel: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  lineaDetalle: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  lineaAmount: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  lineaNegativa: { color: COLORS.successText },
  cortesiaBox: { alignItems: "flex-end" },
  tachado: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textDecorationLine: "line-through",
  },
  cortesia: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.successText,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderLight,
    marginVertical: 8,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  totalLabel: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  totalValue: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  nota: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  internaHint: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 6,
  },
  accion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  accionPeligro: { borderColor: "#FADCD9" },
  accionText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.whatsapp,
    borderRadius: 14,
    paddingVertical: 14,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
