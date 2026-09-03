import { COLORS } from "@/constants/colors";
import { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StripeProvider } from "@stripe/stripe-react-native";
import { usePaymentCheckout } from "@/hooks/usePaymentCheckout";
import {
  usePendingConfirmation,
  PendingConfirmationError,
} from "@/hooks/usePendingConfirmation";
import { ENDPOINTS } from "@/constants/api";
import { useAuthStore } from "@/store/authStore";
import {
  getBathVariants,
  getBathSlots,
  createBathIntent,
  confirmBath,
  BATH_DEPOSIT_AMOUNT,
  BATH_LATE_TOLERANCE_MIN,
} from "@/lib/api";
import { PetPickerStep } from "@/components/wizard/PetPickerStep";
import { HomeDeliverySection } from "@/components/wizard/HomeDeliverySection";
import { DiscountCodeRow } from "@/components/wizard/DiscountCodeRow";
import { usePetSelection } from "@/hooks/usePetSelection";
import { useDaySelection } from "@/hooks/useDaySelection";
import { useHomeDelivery } from "@/hooks/useHomeDelivery";
import { useDiscountCode } from "@/hooks/useDiscountCode";
import { wizardStyles } from "@/styles/wizardStyles";

import { formatCurrency, formatTime, formatDateLong } from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";
import { sizeFromWeight, bathSizeKey } from "@holidoginn/shared/src/pricing";

function formatDurationMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hora" : `${h} horas`;
  return `${h} h ${m} min`;
}

export default function CreateBathScreen() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.holidoginnmx.app"
    >
      <CreateBathScreenContent />
    </StripeProvider>
  );
}

function CreateBathScreenContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ petId?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const checkout = usePaymentCheckout("bath");

  // El baño no exige cartilla aprobada (a diferencia del hospedaje): se listan
  // todas las mascotas del dueño. La selección es de UNA sola mascota, así que
  // el arreglo del hook nunca pasa de un elemento.
  const {
    pets: selectablePets,
    petsLoading,
    petsError,
    petsErrorObj,
    refetchPets,
    selectedPetIds,
    setSelectedPetIds,
    selectedPets,
  } = usePetSelection({
    userId,
    initialPetIds: params.petId ? [params.petId] : [],
  });
  const selectedPetId = selectedPetIds[0] ?? null;
  const selectedPet = selectedPets[0] ?? null;
  // Single-select: volver a tocar la mascota elegida NO la deselecciona.
  const selectPet = (petId: string) => setSelectedPetIds([petId]);

  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [corteNotas, setCorteNotas] = useState("");
  const [paymentType, setPaymentType] = useState<"DEPOSIT" | "FULL">("DEPOSIT");
  const {
    date,
    setDate,
    showDatePicker,
    setShowDatePicker,
    dateYMD,
    minDate,
    maxDate,
    pickerValue,
  } = useDaySelection({ minOffsetDays: 1, maxOffsetDays: 30 });
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Servicio a domicilio ──
  const delivery = useHomeDelivery();
  const { deliveryActive, deliveryFee, homeDeliveryPayload, deliveryIncomplete } =
    delivery;

  const {
    data: variants,
    isError: variantsError,
    error: variantsErrorObj,
    refetch: refetchVariants,
  } = useQuery({
    queryKey: ["bath-variants"],
    queryFn: getBathVariants,
  });

  // Los horarios dependen del servicio elegido: un baño con corte tarda más y
  // por eso cabe en menos huecos (y el último del día es más temprano).
  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ["bath-slots", dateYMD, selectedPetId, deslanado, corte],
    queryFn: () =>
      getBathSlots(dateYMD, {
        petId: selectedPetId ?? undefined,
        deslanado,
        corte,
      }),
  });

  const variant = useMemo(() => {
    if (!selectedPet || !variants) return null;
    const petSize = bathSizeKey(sizeFromWeight(selectedPet.weight ?? 0));
    return variants.find(
      (v) =>
        v.petSize === petSize && v.deslanado === deslanado && v.corte === corte,
    ) ?? null;
  }, [selectedPet, variants, deslanado, corte]);

  // El descuento aplica sobre el precio del baño; el domicilio va aparte.
  const discount = useDiscountCode(variant ? Number(variant.price) : 0);
  const { appliedDiscount, discountTotal } = discount;

  const canSubmit =
    !!selectedPet &&
    !!variant &&
    !!selectedSlotIso &&
    !deliveryIncomplete &&
    !submitting;

  // El horario elegido puede haber dejado de caber al cambiar el servicio.
  useEffect(() => {
    setSelectedSlotIso(null);
  }, [selectedPetId, deslanado, corte]);

  // Lo que sigue a un baño confirmado. Se comparte entre el camino normal y el
  // reintento de una confirmación que quedó pendiente.
  const finishBath = () => {
    // Guarda la dirección para precargarla en futuras reservas (best-effort).
    delivery.persistAddress();

    queryClient.invalidateQueries({ queryKey: ["reservations"] });
    queryClient.invalidateQueries({ queryKey: ["bath-slots", dateYMD] });
    router.replace({
      pathname: "/reservation/success" as any,
      params: { variant: "bath" },
    });
  };

  // Red de seguridad de la confirmación: si `/baths/confirm` falla DESPUÉS de
  // que Stripe cobró, el PaymentIntent no se pierde — se reintenta tal cual
  // (aquí o al abrir la app). Mientras haya uno pendiente no se puede pagar.
  const pendingConfirm = usePendingConfirmation<
    Awaited<ReturnType<typeof confirmBath>>
  >({
    flow: "bath",
    telemetryFlow: "bath",
    userId,
    onConfirmed: () => finishBath(),
  });

  async function handleSubmit() {
    if (!selectedPet || !variant || !selectedSlotIso) return;
    if (pendingConfirm.hasPending) return;
    setSubmitting(true);
    try {
      const corteNotasTrim = corte && corteNotas.trim() ? corteNotas.trim() : undefined;
      const intent = await createBathIntent({
        petId: selectedPet.id,
        deslanado,
        corte,
        appointmentAt: selectedSlotIso,
        paymentType,
        homeDelivery: homeDeliveryPayload,
        discountCode: appliedDiscount?.code,
        notes: corteNotasTrim,
      });

      if (!intent.coveredByCredit && intent.clientSecret) {
        const outcome = await checkout.run({
          clientSecret: intent.clientSecret,
          paymentIntentId: intent.paymentIntentId,
        });
        if (outcome !== "paid") return;
      }

      if (intent.coveredByCredit) {
        // Sin cobro de Stripe no hay PaymentIntent que proteger.
        await confirmBath({
          petId: selectedPet.id,
          variantId: intent.variantId,
          appointmentAt: selectedSlotIso,
          homeDelivery: homeDeliveryPayload,
          discountCode: appliedDiscount?.code,
          notes: corteNotasTrim,
          // Sin PaymentIntent el servidor no sabe si se eligió pagar todo o
          // solo el anticipo; sin esto asumía anticipo y dejaba saldo.
          paymentType,
        });
      } else {
        const paymentIntentId = intent.paymentIntentId!;
        await pendingConfirm.confirm({
          paymentIntentId,
          request: {
            path: `${ENDPOINTS.baths}/confirm`,
            payload: { paymentIntentId },
          },
        });
      }

      finishBath();
    } catch (err) {
      // Ya se cobró y el aviso con "Reintentar" está en pantalla.
      if (err instanceof PendingConfirmationError) return;
      alertaDeError(err, { respaldo: "No se pudo reservar el baño" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={wizardStyles.container}
        contentContainerStyle={wizardStyles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        testID="bath-create-screen"
      >
        {/* Paso 1: mascota */}
        <Text style={wizardStyles.sectionTitle}>1. ¿Para quién?</Text>
        <PetPickerStep
          mode="single"
          pets={selectablePets}
          isLoading={petsLoading}
          // El catálogo de precios es igual de indispensable que las mascotas:
          // si cualquiera de los dos falla, se ofrece reintentar los dos.
          isError={petsError || variantsError}
          error={petsErrorObj ?? variantsErrorObj}
          onRetry={() => {
            refetchPets();
            refetchVariants();
          }}
          selectedPetIds={selectedPetIds}
          onToggle={selectPet}
          emptyText="Necesitas registrar una mascota para agendar baño."
          testIDPrefix="bath-pet"
        />

        {/* Paso 2: opciones de servicio */}
        {selectedPet && (
          <>
            <Text style={wizardStyles.sectionTitle}>2. Servicios adicionales</Text>
            <TouchableOpacity
              style={[wizardStyles.toggleRow, deslanado && wizardStyles.toggleRowActive]}
              onPress={() => setDeslanado((v) => !v)}
              testID="bath-deslanado"
            >
              <Ionicons
                name={deslanado ? "checkbox" : "square-outline"}
                size={22}
                color={deslanado ? COLORS.primary : COLORS.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={wizardStyles.toggleTitle}>Deslanado</Text>
                <Text style={wizardStyles.toggleSub}>
                  Eliminación de pelo muerto con herramientas especiales
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[wizardStyles.toggleRow, corte && wizardStyles.toggleRowActive]}
              onPress={() =>
                setCorte((v) => {
                  if (v) setCorteNotas("");
                  return !v;
                })
              }
              testID="bath-corte"
            >
              <Ionicons
                name={corte ? "checkbox" : "square-outline"}
                size={22}
                color={corte ? COLORS.primary : COLORS.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={wizardStyles.toggleTitle}>Corte</Text>
                <Text style={wizardStyles.toggleSub}>
                  Corte de pelo al estilo tradicional
                </Text>
              </View>
            </TouchableOpacity>

            {corte && (
              <View style={styles.corteNotasWrap}>
                <Text style={styles.corteNotasLabel}>
                  ¿Cómo te gustaría que sea el corte? (opcional)
                </Text>
                <TextInput
                  style={styles.corteNotasInput}
                  value={corteNotas}
                  onChangeText={setCorteNotas}
                  placeholder="Ej. patas y cara redondeadas, largo medio en el lomo..."
                  placeholderTextColor={COLORS.textDisabled}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  testID="bath-corte-notas"
                />
              </View>
            )}

            {(deslanado || corte) && (
              <View style={styles.extrasNote}>
                <Ionicons
                  name="information-circle"
                  size={16}
                  color={COLORS.warningText}
                />
                <Text style={styles.extrasNoteText}>
                  El costo de{" "}
                  {deslanado && corte
                    ? "deslanado y corte"
                    : deslanado
                      ? "deslanado"
                      : "corte"}{" "}
                  depende del estado del pelaje y se cobra cuando traes a tu
                  mascota.
                </Text>
              </View>
            )}

            {/* Servicio a domicilio */}
            <HomeDeliverySection delivery={delivery} testID="bath-delivery-toggle" />

            {variant && (() => {
              const price = Number(variant.price);
              const discountedPrice = Math.max(0, price - discountTotal);
              const total = discountedPrice + deliveryFee;
              const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
              const hasBalance = total > baseDeposit;
              const payNow = paymentType === "FULL" ? total : baseDeposit;
              const payLater = total - payNow;
              return (
                <View style={wizardStyles.priceCard}>
                  <View style={wizardStyles.priceRow}>
                    <Text style={wizardStyles.priceLabel}>Precio del baño</Text>
                    <Text style={wizardStyles.priceLineValue}>
                      {formatCurrency(price)}
                    </Text>
                  </View>
                  {deliveryActive && (
                    <View style={wizardStyles.priceRow}>
                      <Text style={wizardStyles.priceLabel}>Servicio a domicilio</Text>
                      <Text style={wizardStyles.priceLineValue}>
                        {formatCurrency(deliveryFee)}
                      </Text>
                    </View>
                  )}

                  {/* Código de descuento */}
                  <DiscountCodeRow discount={discount} />

                  {hasBalance && (
                    <View style={styles.payChoiceRow}>
                      <TouchableOpacity
                        style={[
                          styles.payChoice,
                          paymentType === "DEPOSIT" && styles.payChoiceActive,
                        ]}
                        onPress={() => setPaymentType("DEPOSIT")}
                        testID="bath-pay-deposit"
                      >
                        <Ionicons
                          name={
                            paymentType === "DEPOSIT"
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={18}
                          color={
                            paymentType === "DEPOSIT"
                              ? COLORS.primary
                              : COLORS.textTertiary
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.payChoiceTitle}>Pagar anticipo</Text>
                          <Text style={styles.payChoiceSub}>
                            {formatCurrency(baseDeposit)} ahora ·{" "}
                            {formatCurrency(total - baseDeposit)} al
                            entregar
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.payChoice,
                          paymentType === "FULL" && styles.payChoiceActive,
                        ]}
                        onPress={() => setPaymentType("FULL")}
                        testID="bath-pay-full"
                      >
                        <Ionicons
                          name={
                            paymentType === "FULL"
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={18}
                          color={
                            paymentType === "FULL"
                              ? COLORS.primary
                              : COLORS.textTertiary
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.payChoiceTitle}>Pagar total</Text>
                          <Text style={styles.payChoiceSub}>
                            {formatCurrency(total)} ahora · sin saldo
                            pendiente
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={wizardStyles.priceDivider} />
                  <View style={wizardStyles.priceRow}>
                    <Text style={wizardStyles.priceLabel}>Pagas ahora</Text>
                    <Text style={wizardStyles.priceValue}>
                      {formatCurrency(payNow)}
                    </Text>
                  </View>
                  {payLater > 0 && (
                    <View style={wizardStyles.priceRow}>
                      <Text style={wizardStyles.priceLabel}>Saldo al entregar</Text>
                      <Text style={wizardStyles.priceLineValue}>
                        {formatCurrency(payLater)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.toleranceNote}>
                    <Ionicons name="time-outline" size={14} color={COLORS.infoText} />
                    <Text style={styles.toleranceText}>
                      Tolerancia de {BATH_LATE_TOLERANCE_MIN} minutos para llegar a tu cita.
                    </Text>
                  </View>
                </View>
              );
            })()}
            {!variant && selectedPet && (
              <Text style={styles.noVariantText}>
                No hay precio configurado para esta combinación.
              </Text>
            )}
          </>
        )}

        {/* Paso 3: fecha */}
        {selectedPet && variant && (
          <>
            <Text style={wizardStyles.sectionTitle}>3. Fecha</Text>
            <TouchableOpacity
              style={wizardStyles.dateRow}
              onPress={() => setShowDatePicker(true)}
              testID="bath-date-picker-button"
            >
              <Ionicons name="calendar-outline" size={22} color={COLORS.primary} />
              <Text style={wizardStyles.dateText}>{formatDateLong(date)}</Text>
              <Ionicons name="chevron-down" size={20} color={COLORS.textTertiary} />
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={pickerValue}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={minDate}
                maximumDate={maxDate}
                themeVariant="light"
                textColor={COLORS.textPrimary}
                onChange={(_, d) => {
                  setShowDatePicker(Platform.OS === "ios");
                  if (d) {
                    setDate(d);
                    setSelectedSlotIso(null);
                  }
                }}
              />
            )}
          </>
        )}

        {/* Paso 4: slot */}
        {selectedPet && variant && (
          <>
            <Text style={wizardStyles.sectionTitle}>4. Horario</Text>
            {slotsData?.durationMinutes != null && (
              <Text style={styles.slotDurationText}>
                Este servicio toma unas {formatDurationMin(slotsData.durationMinutes)}.
              </Text>
            )}
            {slotsLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : !slotsData || slotsData.slots.length === 0 ? (
              <Text style={styles.noSlotsText}>
                No hay horarios disponibles ese día.
              </Text>
            ) : (
              <View style={styles.slotsGrid}>
                {slotsData.slots.map((s) => {
                  const selected = s.startUtc === selectedSlotIso;
                  const disabled = !s.available;
                  return (
                    <TouchableOpacity
                      key={s.startUtc}
                      disabled={disabled}
                      style={[
                        styles.slot,
                        disabled && styles.slotDisabled,
                        selected && styles.slotSelected,
                      ]}
                      onPress={() => setSelectedSlotIso(s.startUtc)}
                      testID={`bath-slot-${s.startUtc}`}
                    >
                      <Text
                        style={[
                          styles.slotText,
                          disabled && styles.slotTextDisabled,
                          selected && styles.slotTextSelected,
                        ]}
                      >
                        {formatTime(s.startUtc)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* Botón pagar */}
        {selectedPet && variant && selectedSlotIso && (
          <TouchableOpacity
            style={[
              wizardStyles.payButton,
              (!canSubmit || pendingConfirm.hasPending) &&
                wizardStyles.payButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit || pendingConfirm.hasPending}
            testID="bath-pay-button"
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (() => {
              const price = Number(variant.price);
              const discountedPrice = Math.max(0, price - discountTotal);
              const total = discountedPrice + deliveryFee;
              const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
              const payNow = paymentType === "FULL" ? total : baseDeposit;
              const isFull = paymentType === "FULL" || total <= baseDeposit;
              return (
                <>
                  <Ionicons name="card" size={20} color={COLORS.white} />
                  <Text style={wizardStyles.payButtonText}>
                    {isFull
                      ? `Pagar ${formatCurrency(payNow)} y confirmar`
                      : `Pagar anticipo ${formatCurrency(payNow)} y confirmar`}
                  </Text>
                </>
              );
            })()}
          </TouchableOpacity>
        )}

        {checkout.stuckNotice}
        {pendingConfirm.notice}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Estilos propios del baño (notas de corte, elección anticipo/total, slots y
// tolerancia). Lo compartido con los otros wizards vive en wizardStyles.
const styles = StyleSheet.create({
  corteNotasWrap: { marginTop: 2, marginBottom: 8 },
  corteNotasLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  corteNotasInput: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    minHeight: 72,
    textAlignVertical: "top",
    color: COLORS.textPrimary,
  },
  extrasNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.warningBg,
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  extrasNoteText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.warningText,
    lineHeight: 18,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  payChoiceRow: {
    gap: 8,
    marginTop: 12,
  },
  payChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.white,
  },
  payChoiceActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  payChoiceTitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  payChoiceSub: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  toleranceNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  toleranceText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.infoText,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  noVariantText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.dangerText,
    marginTop: 4,
  },
  noSlotsText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    fontStyle: "italic",
    padding: 10,
  },
  slotDurationText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 8,
  },
  slotsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  slot: {
    backgroundColor: COLORS.white,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
    minWidth: 84,
    alignItems: "center",
  },
  slotDisabled: {
    backgroundColor: COLORS.bgSection,
    opacity: 0.6,
  },
  slotSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  slotText: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  slotTextDisabled: { color: COLORS.textDisabled, textDecorationLine: "line-through" },
  slotTextSelected: { color: COLORS.primary },
});
