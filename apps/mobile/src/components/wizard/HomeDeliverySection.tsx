import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { DeliveryAddressPicker } from "@/components/DeliveryAddressPicker";
import { formatCurrency } from "@/lib/format";
import type { HomeDeliveryState } from "@/hooks/useHomeDelivery";
import { wizardStyles as styles } from "@/styles/wizardStyles";

type HomeDeliverySectionProps = {
  /** Estado devuelto por `useHomeDelivery()`. */
  delivery: HomeDeliveryState;
  /** testID del toggle, p. ej. "daycare-delivery-toggle". */
  testID: string;
};

/**
 * Sección "Servicio a domicilio" de los wizards de creación: toggle +
 * selector de dirección + cotización de distancia/tarifa. No pinta nada si
 * el servicio está desactivado en el backend.
 */
export function HomeDeliverySection({ delivery, testID }: HomeDeliverySectionProps) {
  const {
    deliveryServiceActive,
    homeDeliveryEnabled,
    setHomeDeliveryEnabled,
    deliveryAddress,
    setDeliveryAddress,
    deliveryQuoteData,
    deliveryQuoteLoading,
    deliveryActive,
    deliveryFee,
  } = delivery;

  if (!deliveryServiceActive) return null;

  return (
    <>
      <Text style={styles.sectionTitle}>Servicio a domicilio</Text>
      <TouchableOpacity
        style={[styles.toggleRow, homeDeliveryEnabled && styles.toggleRowActive]}
        onPress={() => setHomeDeliveryEnabled((v) => !v)}
        testID={testID}
      >
        <Ionicons
          name={homeDeliveryEnabled ? "checkbox" : "square-outline"}
          size={22}
          color={homeDeliveryEnabled ? COLORS.primary : COLORS.textTertiary}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Recoger y entregar a domicilio</Text>
          <Text style={styles.toggleSub}>
            Vamos por tu mascota y la regresamos a tu casa
          </Text>
        </View>
        {deliveryActive && (
          <Text style={styles.deliveryFeeText}>{formatCurrency(deliveryFee)}</Text>
        )}
      </TouchableOpacity>
      {homeDeliveryEnabled && (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <DeliveryAddressPicker value={deliveryAddress} onChange={setDeliveryAddress} />
          {deliveryAddress && deliveryQuoteLoading && (
            <Text style={styles.toggleSub}>Calculando distancia…</Text>
          )}
          {deliveryActive && (
            <View style={styles.deliveryQuoteRow}>
              <Ionicons name="navigate" size={14} color={COLORS.primary} />
              <Text style={styles.deliveryQuoteText}>
                {deliveryQuoteData!.distanceKm} km · {formatCurrency(deliveryFee)}{" "}
                (ida y vuelta)
              </Text>
            </View>
          )}
        </View>
      )}
    </>
  );
}
