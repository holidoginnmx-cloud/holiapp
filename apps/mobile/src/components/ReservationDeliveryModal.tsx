import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import {
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import {
  deliveryQuote,
  getDeliveryAddress,
  saveDeliveryAddress,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";

export type CurrentDelivery = {
  enabled: boolean;
  address: string | null;
  fee: number;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  current: CurrentDelivery;
  /** El padre dispara la mutación y cierra en onSuccess (contrato de AmountEditModal). */
  onSubmit: (
    payload:
      | {
          enable: true;
          address: string;
          lat: number;
          lng: number;
          placeId?: string;
          isCourtesy?: boolean;
        }
      | { enable: false },
  ) => void;
  submitting?: boolean;
  /**
   * App del cliente: precarga la dirección guardada de SU perfil y la vuelve a
   * guardar al confirmar. En la app del equipo va en false — la dirección
   * guardada sería la del empleado, no la del dueño de la mascota.
   */
  preloadSavedAddress?: boolean;
}

/**
 * Agregar, cambiar o quitar el servicio a domicilio de una reserva ya creada.
 *
 * Compartido entre el detalle del equipo y el del cliente: cambia el copy del
 * aviso y la precarga de dirección, no el flujo.
 *
 * La tarifa que se muestra es una vista previa; el monto que se cobra lo
 * recalcula el servidor al guardar.
 */
export function ReservationDeliveryModal({
  visible,
  onClose,
  current,
  onSubmit,
  submitting = false,
  preloadSavedAddress = false,
}: Props) {
  const [address, setAddress] = useState<SelectedAddress | null>(null);
  const [quote, setQuote] = useState<{ fee: number; distanceKm: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isCourtesy, setIsCourtesy] = useState(false);
  // Regalar el viaje es decisión del equipo; el dueño no ve la opción (y la API
  // ignora la bandera si viniera de él).
  const canGiveCourtesy = !preloadSavedAddress;

  // Al abrir: el cliente arranca con su dirección guardada; el equipo, con la
  // que ya tenga la reserva (no hay una "dirección del admin" que sirva).
  useEffect(() => {
    if (!visible) return;
    setAddress(null);
    setQuote(null);
    setQuoteError(null);
    setIsCourtesy(false);
    if (!preloadSavedAddress) return;
    let cancelled = false;
    getDeliveryAddress()
      .then((saved) => {
        if (cancelled) return;
        if (saved.address && saved.addressLat != null && saved.addressLng != null) {
          setAddress({
            address: saved.address,
            lat: saved.addressLat,
            lng: saved.addressLng,
            placeId: saved.addressPlaceId ?? undefined,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, preloadSavedAddress]);

  // Vista previa de la tarifa en cuanto hay coordenadas.
  useEffect(() => {
    if (!address) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setQuoteError(null);
    deliveryQuote(address.lat, address.lng)
      .then((res) => {
        if (cancelled) return;
        if (!res.active) {
          setQuote(null);
          setQuoteError("El servicio a domicilio no está disponible por ahora.");
          return;
        }
        setQuote({ fee: res.fee, distanceKm: res.distanceKm });
      })
      .catch(() => {
        if (!cancelled) setQuoteError("No se pudo calcular la tarifa. Intenta de nuevo.");
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleSave = () => {
    if (!address || submitting) return;
    if (preloadSavedAddress) {
      // Best-effort: que la próxima reserva ya venga con su dirección.
      saveDeliveryAddress({
        address: address.address,
        lat: address.lat,
        lng: address.lng,
        placeId: address.placeId,
      }).catch(() => {});
    }
    onSubmit({
      enable: true,
      address: address.address,
      lat: address.lat,
      lng: address.lng,
      placeId: address.placeId,
      isCourtesy: canGiveCourtesy && isCourtesy ? true : undefined,
    });
  };

  const handleRemove = () => {
    Alert.alert(
      "Quitar servicio a domicilio",
      `Se descontarán ${formatCurrency(current.fee)} del total. ¿Continuar?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Quitar",
          style: "destructive",
          onPress: () => onSubmit({ enable: false }),
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.content} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>
            {current.enabled ? "Servicio a domicilio" : "Agregar servicio a domicilio"}
          </Text>

          {current.enabled && current.address ? (
            <View style={styles.currentBox}>
              <Ionicons name="car-outline" size={16} color={COLORS.textTertiary} />
              <Text style={styles.currentText} numberOfLines={2}>
                Actual: {current.address} · {formatCurrency(current.fee)}
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>
            {current.enabled ? "Nueva dirección" : "Dirección"}
          </Text>
          <DeliveryAddressPicker
            value={address}
            onChange={setAddress}
            placeholder="Busca la calle y número…"
          />

          {quoting ? (
            <View style={styles.quoteRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.quoteText}>Calculando tarifa…</Text>
            </View>
          ) : quote ? (
            <Text style={styles.quoteText}>
              {isCourtesy ? (
                <>
                  Tarifa: <Text style={styles.struck}>{formatCurrency(quote.fee)}</Text> ·
                  cortesía · {quote.distanceKm} km
                </>
              ) : (
                `Tarifa: ${formatCurrency(quote.fee)} · ${quote.distanceKm} km`
              )}
            </Text>
          ) : quoteError ? (
            <Text style={styles.errorText}>{quoteError}</Text>
          ) : null}

          {canGiveCourtesy && (
            <View style={styles.courtesyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.courtesyLabel}>Cortesía</Text>
                <Text style={styles.courtesyHint}>
                  El viaje se hace igual, pero no se cobra ni suma al total.
                </Text>
              </View>
              <Switch
                value={isCourtesy}
                onValueChange={setIsCourtesy}
                trackColor={{ false: COLORS.borderLight, true: COLORS.primaryLight }}
                thumbColor={isCourtesy ? COLORS.primary : COLORS.white}
              />
            </View>
          )}

          <View style={styles.hintBox}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={COLORS.infoText}
            />
            <Text style={styles.hintText}>
              {preloadSavedAddress
                ? "La tarifa se suma a tu total y se paga al recoger a tu mascota."
                : "Los pagos no se ajustan automáticamente: la tarifa se suma al saldo y se cobra al recoger."}
            </Text>
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose} disabled={submitting}>
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnConfirm, (!address || !quote || submitting) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={!address || !quote || submitting}
              testID="delivery-modal-save"
            >
              <Text style={styles.btnConfirmText}>
                {submitting ? "Guardando..." : "Guardar"}
              </Text>
            </TouchableOpacity>
          </View>

          {current.enabled && (
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={handleRemove}
              disabled={submitting}
              testID="delivery-modal-remove"
            >
              <Ionicons name="trash-outline" size={16} color={COLORS.errorText} />
              <Text style={styles.removeText}>Quitar servicio a domicilio</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  content: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  currentBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  currentText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  quoteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  quoteText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
    marginTop: 10,
  },
  struck: { textDecorationLine: "line-through", color: COLORS.textDisabled },
  errorText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.errorText,
    marginTop: 10,
  },
  courtesyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  courtesyLabel: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  courtesyHint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  hintBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.infoBg,
    marginTop: 14,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.infoText,
  },
  buttons: { flexDirection: "row", gap: 12, marginTop: 18 },
  btnCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  btnCancelText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  btnConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  btnConfirmText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  removeBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    padding: 12,
  },
  removeText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.errorText,
  },
});
