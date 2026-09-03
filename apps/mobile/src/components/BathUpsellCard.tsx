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
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePaymentCheckout } from "@/hooks/usePaymentCheckout";
import {
  usePendingConfirmation,
  PendingConfirmationError,
} from "@/hooks/usePendingConfirmation";
import { useAuthStore } from "@/store/authStore";
import { ENDPOINTS } from "@/constants/api";
import { COLORS } from "@/constants/colors";
import {
  getBathVariants,
  createBathAddonPayment,
  confirmBathAddonPayment,
  type BathVariant,
  type ReservationDetail,
} from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";

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
  const router = useRouter();
  const checkout = usePaymentCheckout("bath-upsell");
  const userId = useAuthStore((s) => s.userId);
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [paying, setPaying] = useState(false);

  const confirmPath = `${ENDPOINTS.reservations}/${reservation.id}/addons/bath/confirm`;

  // Lo que sigue a un baño contratado. Se comparte entre el camino normal y el
  // reintento de una confirmación que quedó pendiente.
  const finishAddon = () => {
    queryClient.invalidateQueries({ queryKey: ["reservation", reservation.id] });
    queryClient.invalidateQueries({ queryKey: ["reservations"] });
    router.replace({
      pathname: "/reservation/success" as any,
      params: { variant: "bath" },
    });
  };

  // Red de seguridad: si el confirm del add-on falla DESPUÉS de que Stripe
  // cobró, el PaymentIntent no se pierde — se reintenta tal cual.
  const pendingConfirm = usePendingConfirmation<
    Awaited<ReturnType<typeof confirmBathAddonPayment>>
  >({
    flow: "bathAddon",
    telemetryFlow: "bath-upsell",
    userId,
    matches: (record) => record.path === confirmPath,
    onConfirmed: () => finishAddon(),
    subject: "tu pago",
  });

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
    const variantLabel =
      extras.length > 0 ? `Baño · ${extras.join(" + ")}` : "Baño · Estándar";
    return (
      <View style={styles.contractedCard}>
        <View style={styles.contractedHeader}>
          <View style={styles.contractedIconWrap}>
            <Ionicons name="water" size={22} color={COLORS.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contractedTitle}>Baño contratado</Text>
            <Text style={styles.contractedSubtitle}>{variantLabel}</Text>
          </View>
          <View style={styles.contractedStatusPill}>
            <Ionicons
              name="checkmark-circle"
              size={12}
              color={COLORS.successText}
            />
            <Text style={styles.contractedStatusText}>Listo</Text>
          </View>
        </View>

        <View style={styles.contractedPriceRow}>
          <Text style={styles.contractedPriceLabel}>Total pagado</Text>
          <Text style={styles.contractedPrice}>
            {formatCurrency(existingBath.unitPrice)}
          </Text>
        </View>

        <View style={styles.contractedNoteBox}>
          <Ionicons
            name="information-circle"
            size={14}
            color={COLORS.infoText}
          />
          <Text style={styles.contractedNote}>
            Se entregará bañado el día del check-out.
          </Text>
        </View>
      </View>
    );
  }

  if (!canShowUpsell) return null;

  const handleContract = async () => {
    if (!variant) {
      Alert.alert("Error", "No se encontró precio para la combinación seleccionada");
      return;
    }
    if (pendingConfirm.hasPending) return;
    setPaying(true);
    try {
      const { clientSecret, paymentIntentId } = await createBathAddonPayment(
        reservation.id,
        { petId: reservation.petId, deslanado, corte }
      );

      const outcome = await checkout.run({ clientSecret, paymentIntentId });
      if (outcome !== "paid") return;

      // Mismo cuerpo que `confirmBathAddonPayment`, pero con red de seguridad.
      await pendingConfirm.confirm({
        paymentIntentId,
        request: { path: confirmPath, payload: { paymentIntentId } },
      });
      finishAddon();
    } catch (err: any) {
      // Ya se cobró y el aviso con "Reintentar" está en pantalla.
      if (err instanceof PendingConfirmationError) return;
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
        style={[
          styles.contractButton,
          (!variant || paying || pendingConfirm.hasPending) && { opacity: 0.5 },
        ]}
        onPress={handleContract}
        disabled={!variant || paying || pendingConfirm.hasPending}
        activeOpacity={0.8}
      >
        {paying ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="card-outline" size={20} color={COLORS.white} />
            <Text style={styles.contractButtonText}>
              Contratar baño — ${variant ? formatNumber(variant.price) : "--"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {checkout.stuckNotice}
      {pendingConfirm.notice}
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  // Contracted state
  contractedCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  contractedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  contractedIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  contractedTitle: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  contractedSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    marginTop: 2,
  },
  contractedStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  contractedStatusText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.successText,
    letterSpacing: 0.3,
  },
  contractedPriceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 14,
  },
  contractedPriceLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  contractedPrice: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  contractedNoteBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.infoBg,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  contractedNote: {
    flex: 1,
    fontSize: 12,
    color: COLORS.infoText,
    lineHeight: 17,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
});
