import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStripe } from "@stripe/stripe-react-native";
import { COLORS } from "@/constants/colors";
import {
  getBathVariants,
  createBathAddonPayment,
  confirmBathAddonPayment,
  type BathVariant,
  type ReservationDetail,
} from "@/lib/api";

function bathSizeFromWeight(kg: number | null | undefined): "S" | "M" | "L" | "XL" {
  const w = kg ?? 0;
  if (w <= 5) return "S";
  if (w <= 15) return "M";
  if (w <= 24) return "L";
  return "XL";
}

function findVariant(
  variants: BathVariant[] | undefined,
  petWeight: number | null | undefined,
  deslanado: boolean,
  corte: boolean
): BathVariant | undefined {
  if (!variants) return undefined;
  const size = bathSizeFromWeight(petWeight);
  return variants.find(
    (v) => v.petSize === size && v.deslanado === deslanado && v.corte === corte
  );
}

interface Props {
  reservation: ReservationDetail;
}

export function BathUpsellCard({ reservation }: Props) {
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [paying, setPaying] = useState(false);

  const { data: variants } = useQuery({
    queryKey: ["bath-variants"],
    queryFn: getBathVariants,
    staleTime: 1000 * 60 * 60,
  });

  const existingBath = reservation.addons?.find(
    (a) => a.variant.serviceType.code === "BATH"
  );

  const canShowUpsell =
    !existingBath &&
    (reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN");

  const variant = useMemo(
    () => findVariant(variants, reservation.pet?.weight, deslanado, corte),
    [variants, reservation.pet?.weight, deslanado, corte]
  );

  if (existingBath) {
    const v = existingBath.variant;
    const extras: string[] = [];
    if (v.deslanado) extras.push("Deslanado");
    if (v.corte) extras.push("Corte");
    const suffix = extras.length > 0 ? ` + ${extras.join(" + ")}` : "";
    return (
      <View style={styles.contractedCard}>
        <View style={styles.contractedHeader}>
          <Ionicons name="water" size={20} color={COLORS.primary} />
          <Text style={styles.contractedTitle}>Baño contratado</Text>
        </View>
        <Text style={styles.contractedBody}>
          Baño{suffix} — ${Number(existingBath.unitPrice).toLocaleString("es-MX")}
        </Text>
        <Text style={styles.contractedNote}>
          Se entregará bañado al momento del check-out.
        </Text>
      </View>
    );
  }

  if (!canShowUpsell) return null;

  const handleContract = async () => {
    if (!variant) {
      Alert.alert("Error", "No se encontró precio para la combinación seleccionada");
      return;
    }
    setPaying(true);
    try {
      const { clientSecret, paymentIntentId } = await createBathAddonPayment(
        reservation.id,
        { petId: reservation.petId, deslanado, corte }
      );

      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "HolidogInn",
      });
      if (initError) {
        Alert.alert("Error", initError.message);
        return;
      }

      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        if (payError.code !== "Canceled") {
          Alert.alert("Error de pago", payError.message);
        }
        return;
      }

      await confirmBathAddonPayment(reservation.id, paymentIntentId);
      queryClient.invalidateQueries({ queryKey: ["reservation", reservation.id] });
      Alert.alert(
        "Baño contratado",
        "Tu perro será entregado bañado el día del check-out."
      );
    } catch (err: any) {
      Alert.alert("Error", err.message || "No se pudo contratar el baño");
    } finally {
      setPaying(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="water-outline" size={20} color={COLORS.primary} />
        <Text style={styles.title}>Agregar baño de salida</Text>
      </View>
      <Text style={styles.subtitle}>
        Entregamos a {reservation.pet?.name} bañado el día del check-out.
      </Text>

      <View style={styles.optionsRow}>
        <TouchableOpacity
          style={[styles.chip, deslanado && styles.chipSelected]}
          onPress={() => setDeslanado((v) => !v)}
        >
          <Text style={[styles.chipText, deslanado && styles.chipTextSelected]}>
            Deslanado
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, corte && styles.chipSelected]}
          onPress={() => setCorte((v) => !v)}
        >
          <Text style={[styles.chipText, corte && styles.chipTextSelected]}>
            Corte
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.contractButton, (!variant || paying) && { opacity: 0.5 }]}
        onPress={handleContract}
        disabled={!variant || paying}
        activeOpacity={0.8}
      >
        {paying ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="card-outline" size={20} color={COLORS.white} />
            <Text style={styles.contractButtonText}>
              Contratar baño — ${variant ? variant.price.toLocaleString("es-MX") : "--"}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  chipTextSelected: {
    color: COLORS.white,
  },
  contractButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
  },
  contractButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
  // Contracted state
  contractedCard: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 6,
  },
  contractedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  contractedTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  contractedBody: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  contractedNote: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
});
