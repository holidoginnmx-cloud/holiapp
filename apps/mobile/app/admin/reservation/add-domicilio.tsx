import { COLORS } from "@/constants/colors";
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getReservationById,
  getDeliveryStatus,
  deliveryQuote,
  adminAddReservationDelivery,
} from "@/lib/api";
import { formatName, formatCurrency } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import { SwitchRow } from "@/components/SwitchRow";
import {
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import { invalidateReservationScope } from "@/lib/invalidateReservations";

/**
 * Agrega el servicio a domicilio a una reserva que YA existe: el caso que
 * faltaba, porque el domicilio solo se podía elegir al reservar y después ni el
 * cliente ni el equipo tenían dónde sumarlo.
 *
 * No reutiliza `useHomeDelivery` a propósito: ese hook precarga la dirección
 * guardada del ADMIN que está usando la app, y aquí el domicilio es del CLIENTE
 * de la reserva. La tarifa que se ve es informativa; el backend la recalcula
 * server-side desde lat/lng al guardar.
 */
export default function AdminAddDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const {
    data: reservation,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const { data: deliveryStatus, isLoading: loadingStatus } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: getDeliveryStatus,
    staleTime: 1000 * 60 * 10,
  });

  const [address, setAddress] = useState<SelectedAddress | null>(null);
  const [isCourtesy, setIsCourtesy] = useState(false);

  const { data: quote, isLoading: quoteLoading } = useQuery({
    queryKey: ["delivery-quote", address?.lat, address?.lng],
    queryFn: () => deliveryQuote(address!.lat, address!.lng),
    enabled: !!address,
  });
  const quoteActive = !!address && quote?.active === true;
  const quotedFee = quoteActive ? quote!.fee : 0;

  const mutation = useMutation({
    mutationFn: () =>
      adminAddReservationDelivery(id!, {
        address: address!.address,
        lat: address!.lat,
        lng: address!.lng,
        ...(address!.placeId ? { placeId: address!.placeId } : {}),
        isCourtesy,
      }),
    onSuccess: (res) => {
      invalidateReservationScope(qc, id);
      const impacto =
        res.addedToTotal > 0
          ? `Se sumaron ${formatCurrency(res.addedToTotal)} al total (${formatCurrency(res.totalAmount)}).`
          : "No se sumó nada al total.";
      Alert.alert("Domicilio agregado", impacto, [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert("No se pudo agregar", e.message),
  });

  if (isLoading || loadingStatus) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (isError || !reservation) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : "No se pudo cargar"}
        onRetry={refetch}
      />
    );
  }

  // Si el servicio está apagado en la config, no tiene caso capturar nada.
  if (deliveryStatus?.active === false) {
    return (
      <View style={styles.center}>
        <Ionicons name="car-outline" size={40} color={COLORS.textTertiary} />
        <Text style={styles.offText}>
          El servicio a domicilio está desactivado. Actívalo en la configuración
          para poder agregarlo a una reserva.
        </Text>
      </View>
    );
  }

  // Si ya tiene domicilio, se quita desde el detalle (no se agrega dos veces).
  if (reservation.homeDelivery) {
    return (
      <View style={styles.center}>
        <Ionicons name="checkmark-circle" size={40} color={COLORS.primary} />
        <Text style={styles.offText}>
          Esta reservación ya tiene servicio a domicilio. Si necesitas
          cambiarlo, quítalo desde el detalle y agrégalo de nuevo.
        </Text>
      </View>
    );
  }

  const canSubmit = quoteActive && !mutation.isPending;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.pet}>{formatName(reservation.pet?.name ?? "")}</Text>
      <Text style={styles.subtitle}>
        Total actual: {formatCurrency(Number(reservation.totalAmount))}
      </Text>

      <Text style={styles.label}>Dirección del cliente</Text>
      <DeliveryAddressPicker
        value={address}
        onChange={setAddress}
        placeholder="Escribe la dirección de recogida…"
      />
      {address && quoteLoading && (
        <Text style={styles.hint}>Calculando distancia…</Text>
      )}
      {quoteActive && (
        <View style={styles.quoteRow}>
          <Ionicons name="navigate" size={14} color={COLORS.primary} />
          <Text style={styles.quoteText}>
            {quote!.distanceKm} km · {formatCurrency(quote!.fee)} (ida y vuelta)
          </Text>
        </View>
      )}
      {address && !quoteLoading && quote?.active === false && (
        <Text style={styles.hint}>
          El servicio a domicilio no está disponible para esta dirección.
        </Text>
      )}

      <SwitchRow
        label="Cortesía"
        hint="Se registra el domicilio, pero no se cobra ni suma al total."
        value={isCourtesy}
        onValueChange={setIsCourtesy}
        testID="admin-add-delivery-courtesy"
      />

      {quoteActive && (
        <View style={styles.previewBox}>
          <Ionicons
            name={isCourtesy ? "gift-outline" : "cash-outline"}
            size={18}
            color={isCourtesy ? COLORS.warningText : COLORS.primary}
          />
          <Text style={styles.previewText}>
            {isCourtesy
              ? `No suma al total. Se registra que se regalaron ${formatCurrency(quotedFee)} de domicilio.`
              : `Se sumarán ${formatCurrency(quotedFee)} al total: ${formatCurrency(
                  Number(reservation.totalAmount) + quotedFee,
                )}.`}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && { opacity: 0.5 }]}
        onPress={() => mutation.mutate()}
        disabled={!canSubmit}
        testID="admin-add-delivery-submit"
      >
        <Text style={styles.submitText}>
          {mutation.isPending ? "Agregando..." : "Agregar domicilio"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
    backgroundColor: COLORS.bgPage,
  },
  offText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  pet: {
    fontSize: 20,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 6,
  },
  quoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  quoteText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
  },
  previewBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  submitBtn: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  submitText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
