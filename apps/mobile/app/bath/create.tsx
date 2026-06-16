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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StripeProvider, useStripe } from "@stripe/stripe-react-native";
import { useAuthStore } from "@/store/authStore";
import {
  getPetsByOwner,
  getBathVariants,
  getBathSlots,
  createBathIntent,
  confirmBath,
  getDeliveryStatus,
  getDeliveryAddress,
  saveDeliveryAddress,
  deliveryQuote,
  BATH_DEPOSIT_AMOUNT,
  BATH_LATE_TOLERANCE_MIN,
} from "@/lib/api";
import {
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import { ErrorState } from "@/components/ErrorState";

import { formatName } from "@/lib/format";
import { handlePaymentSheetError } from "@/lib/paymentError";
import { sizeFromWeight, bathSizeKey } from "@holidoginn/shared/src/pricing";

function toYMD(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatSlotLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    timeZone: "America/Hermosillo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
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
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [selectedPetId, setSelectedPetId] = useState<string | null>(
    params.petId ?? null,
  );
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [paymentType, setPaymentType] = useState<"DEPOSIT" | "FULL">("DEPOSIT");
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Servicio a domicilio ──
  const [homeDeliveryEnabled, setHomeDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);

  const { data: deliveryStatus } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: getDeliveryStatus,
    staleTime: 1000 * 60 * 10,
  });
  const deliveryServiceActive = deliveryStatus?.active === true;

  const { data: savedAddress } = useQuery({
    queryKey: ["delivery-address"],
    queryFn: getDeliveryAddress,
    enabled: deliveryServiceActive,
  });
  useEffect(() => {
    if (
      !deliveryAddress &&
      savedAddress?.address &&
      savedAddress.addressLat != null &&
      savedAddress.addressLng != null
    ) {
      setDeliveryAddress({
        address: savedAddress.address,
        lat: savedAddress.addressLat,
        lng: savedAddress.addressLng,
        placeId: savedAddress.addressPlaceId ?? undefined,
      });
    }
  }, [savedAddress, deliveryAddress]);

  const { data: deliveryQuoteData, isLoading: deliveryQuoteLoading } = useQuery({
    queryKey: ["delivery-quote", deliveryAddress?.lat, deliveryAddress?.lng],
    queryFn: () => deliveryQuote(deliveryAddress!.lat, deliveryAddress!.lng),
    enabled: homeDeliveryEnabled && !!deliveryAddress,
  });
  const deliveryActive =
    homeDeliveryEnabled && !!deliveryAddress && deliveryQuoteData?.active === true;
  const deliveryFee = deliveryActive ? deliveryQuoteData!.fee : 0;
  const homeDeliveryPayload =
    deliveryActive && deliveryAddress
      ? {
          address: deliveryAddress.address,
          lat: deliveryAddress.lat,
          lng: deliveryAddress.lng,
          placeId: deliveryAddress.placeId,
        }
      : undefined;

  const {
    data: pets,
    isLoading: petsLoading,
    isError: petsError,
    error: petsErrorObj,
    refetch: refetchPets,
  } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
  });

  const {
    data: variants,
    isError: variantsError,
    error: variantsErrorObj,
    refetch: refetchVariants,
  } = useQuery({
    queryKey: ["bath-variants"],
    queryFn: getBathVariants,
  });

  const dateYMD = useMemo(() => toYMD(date), [date]);

  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ["bath-slots", dateYMD],
    queryFn: () => getBathSlots(dateYMD),
  });

  const selectedPet = useMemo(
    () => pets?.find((p) => p.id === selectedPetId) ?? null,
    [pets, selectedPetId],
  );

  const eligiblePets = useMemo(
    () => (pets ?? []).filter((p) => p.cartillaStatus === "APPROVED"),
    [pets],
  );

  const variant = useMemo(() => {
    if (!selectedPet || !variants) return null;
    const petSize = bathSizeKey(sizeFromWeight(selectedPet.weight ?? 0));
    return variants.find(
      (v) =>
        v.petSize === petSize && v.deslanado === deslanado && v.corte === corte,
    ) ?? null;
  }, [selectedPet, variants, deslanado, corte]);

  // Si activó domicilio, exige una dirección con cotización válida antes de pagar.
  const deliveryIncomplete = homeDeliveryEnabled && !deliveryActive;
  const canSubmit =
    !!selectedPet &&
    !!variant &&
    !!selectedSlotIso &&
    !deliveryIncomplete &&
    !submitting;

  async function handleSubmit() {
    if (!selectedPet || !variant || !selectedSlotIso) return;
    setSubmitting(true);
    try {
      const intent = await createBathIntent({
        petId: selectedPet.id,
        deslanado,
        corte,
        appointmentAt: selectedSlotIso,
        paymentType,
        homeDelivery: homeDeliveryPayload,
      });

      if (!intent.coveredByCredit && intent.clientSecret) {
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: intent.clientSecret,
          merchantDisplayName: "Holidog Inn",
          applePay: { merchantCountryCode: "MX" },
        });
        if (initError) {
          Alert.alert("Error", initError.message);
          return;
        }
        const { error: payError } = await presentPaymentSheet();
        if (handlePaymentSheetError(payError, "bath")) return;
      }

      await confirmBath(
        intent.coveredByCredit
          ? {
              petId: selectedPet.id,
              variantId: intent.variantId,
              appointmentAt: selectedSlotIso,
              homeDelivery: homeDeliveryPayload,
            }
          : { paymentIntentId: intent.paymentIntentId! },
      );

      // Guarda la dirección para precargarla en futuras reservas (best-effort).
      if (homeDeliveryPayload && deliveryAddress) {
        saveDeliveryAddress({
          address: deliveryAddress.address,
          lat: deliveryAddress.lat,
          lng: deliveryAddress.lng,
          placeId: deliveryAddress.placeId,
        }).catch(() => {});
      }

      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["bath-slots", dateYMD] });
      router.replace({
        pathname: "/reservation/success" as any,
        params: { variant: "bath" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo reservar el baño";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  const { minDate, maxDate } = useMemo(() => {
    const min = new Date();
    min.setDate(min.getDate() + 1);
    min.setHours(0, 0, 0, 0);
    const max = new Date();
    max.setDate(max.getDate() + 30);
    max.setHours(23, 59, 59, 999);
    return { minDate: min, maxDate: max };
  }, []);

  const pickerValue =
    date < minDate ? minDate : date > maxDate ? maxDate : date;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        testID="bath-create-screen"
      >
        {/* Paso 1: mascota */}
        <Text style={styles.sectionTitle}>1. ¿Para quién?</Text>
        {petsError || variantsError ? (
          <ErrorState
            error={petsErrorObj ?? variantsErrorObj}
            onRetry={() => {
              refetchPets();
              refetchVariants();
            }}
            compact
          />
        ) : petsLoading ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : eligiblePets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-outline" size={28} color={COLORS.warningText} />
            <Text style={styles.emptyText}>
              Necesitas una mascota con cartilla aprobada para agendar baño.
            </Text>
          </View>
        ) : (
          <View style={styles.petList}>
            {eligiblePets.map((p) => {
              const selected = p.id === selectedPetId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.petCard, selected && styles.petCardSelected]}
                  onPress={() => setSelectedPetId(p.id)}
                  testID={`bath-pet-${p.id}`}
                >
                  <View style={styles.petAvatar}>
                    <Ionicons name="paw" size={20} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.petName}>{formatName(p.name)}</Text>
                    <Text style={styles.petMeta}>
                      {p.weight ? `${p.weight} kg · ` : ""}
                      {p.breed || "Sin raza"}
                    </Text>
                  </View>
                  {selected && (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color={COLORS.primary}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Paso 2: opciones de servicio */}
        {selectedPet && (
          <>
            <Text style={styles.sectionTitle}>2. Servicios adicionales</Text>
            <TouchableOpacity
              style={[styles.toggleRow, deslanado && styles.toggleRowActive]}
              onPress={() => setDeslanado((v) => !v)}
              testID="bath-deslanado"
            >
              <Ionicons
                name={deslanado ? "checkbox" : "square-outline"}
                size={22}
                color={deslanado ? COLORS.primary : COLORS.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Deslanado</Text>
                <Text style={styles.toggleSub}>
                  Eliminación de pelo muerto con herramientas especiales
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleRow, corte && styles.toggleRowActive]}
              onPress={() => setCorte((v) => !v)}
              testID="bath-corte"
            >
              <Ionicons
                name={corte ? "checkbox" : "square-outline"}
                size={22}
                color={corte ? COLORS.primary : COLORS.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Corte</Text>
                <Text style={styles.toggleSub}>
                  Corte de pelo al estilo tradicional
                </Text>
              </View>
            </TouchableOpacity>

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

            {deliveryServiceActive && (
              <>
                <Text style={styles.sectionTitle}>Servicio a domicilio</Text>
                <TouchableOpacity
                  style={[
                    styles.toggleRow,
                    homeDeliveryEnabled && styles.toggleRowActive,
                  ]}
                  onPress={() => setHomeDeliveryEnabled((v) => !v)}
                  testID="bath-delivery-toggle"
                >
                  <Ionicons
                    name={homeDeliveryEnabled ? "checkbox" : "square-outline"}
                    size={22}
                    color={homeDeliveryEnabled ? COLORS.primary : COLORS.textTertiary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleTitle}>
                      Recoger y entregar a domicilio
                    </Text>
                    <Text style={styles.toggleSub}>
                      Vamos por tu mascota y la regresamos a tu casa
                    </Text>
                  </View>
                  {deliveryActive && (
                    <Text style={styles.bathDeliveryFee}>
                      ${deliveryFee.toLocaleString("es-MX")}
                    </Text>
                  )}
                </TouchableOpacity>
                {homeDeliveryEnabled && (
                  <View style={{ gap: 8, marginBottom: 8 }}>
                    <DeliveryAddressPicker
                      value={deliveryAddress}
                      onChange={setDeliveryAddress}
                    />
                    {deliveryAddress && deliveryQuoteLoading && (
                      <Text style={styles.toggleSub}>Calculando distancia…</Text>
                    )}
                    {deliveryActive && (
                      <View style={styles.deliveryQuoteRow}>
                        <Ionicons name="navigate" size={14} color={COLORS.primary} />
                        <Text style={styles.deliveryQuoteText}>
                          {deliveryQuoteData!.distanceKm} km · $
                          {deliveryFee.toLocaleString("es-MX")} (ida y vuelta)
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}

            {variant && (() => {
              const price = Number(variant.price);
              const total = price + deliveryFee;
              const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
              const hasBalance = total > baseDeposit;
              const payNow = paymentType === "FULL" ? total : baseDeposit;
              const payLater = total - payNow;
              return (
                <View style={styles.priceCard}>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Precio del baño</Text>
                    <Text style={styles.priceLineValue}>
                      ${price.toLocaleString("es-MX")}
                    </Text>
                  </View>
                  {deliveryActive && (
                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>Servicio a domicilio</Text>
                      <Text style={styles.priceLineValue}>
                        ${deliveryFee.toLocaleString("es-MX")}
                      </Text>
                    </View>
                  )}

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
                            ${baseDeposit.toLocaleString("es-MX")} ahora · $
                            {(total - baseDeposit).toLocaleString("es-MX")} al
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
                            ${total.toLocaleString("es-MX")} ahora · sin saldo
                            pendiente
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.priceDivider} />
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Pagas ahora</Text>
                    <Text style={styles.priceValue}>
                      ${payNow.toLocaleString("es-MX")}
                    </Text>
                  </View>
                  {payLater > 0 && (
                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>Saldo al entregar</Text>
                      <Text style={styles.priceLineValue}>
                        ${payLater.toLocaleString("es-MX")}
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
            <Text style={styles.sectionTitle}>3. Fecha</Text>
            <TouchableOpacity
              style={styles.dateRow}
              onPress={() => setShowDatePicker(true)}
              testID="bath-date-picker-button"
            >
              <Ionicons name="calendar-outline" size={22} color={COLORS.primary} />
              <Text style={styles.dateText}>{formatDateLong(date)}</Text>
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
            <Text style={styles.sectionTitle}>4. Horario</Text>
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
                        {formatSlotLocal(s.startUtc)}
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
            style={[styles.payButton, !canSubmit && styles.payButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            testID="bath-pay-button"
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (() => {
              const price = Number(variant.price);
              const total = price + deliveryFee;
              const baseDeposit = Math.min(BATH_DEPOSIT_AMOUNT, total);
              const payNow = paymentType === "FULL" ? total : baseDeposit;
              const isFull = paymentType === "FULL" || total <= baseDeposit;
              return (
                <>
                  <Ionicons name="card" size={20} color={COLORS.white} />
                  <Text style={styles.payButtonText}>
                    {isFull
                      ? `Pagar $${payNow.toLocaleString("es-MX")} y confirmar`
                      : `Pagar anticipo $${payNow.toLocaleString("es-MX")} y confirmar`}
                  </Text>
                </>
              );
            })()}
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 20, paddingBottom: 60, gap: 8 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 18,
    marginBottom: 8,
  },
  petList: { gap: 8 },
  petCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  petCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  petAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  petMeta: { fontSize: 13, color: COLORS.textTertiary, marginTop: 2 },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.warningBg,
    padding: 14,
    borderRadius: 12,
  },
  emptyText: { flex: 1, fontSize: 13, color: COLORS.warningText },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  toggleRowActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  toggleTitle: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  toggleSub: { fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
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
    fontWeight: "600",
  },
  priceCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginTop: 6,
    gap: 8,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: { fontSize: 14, color: COLORS.textTertiary, fontWeight: "600" },
  priceValue: { fontSize: 20, fontWeight: "800", color: COLORS.primary },
  priceLineValue: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  bathDeliveryFee: { fontSize: 15, fontWeight: "700", color: COLORS.primary },
  deliveryQuoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deliveryQuoteText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
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
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  payChoiceSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  priceDivider: {
    height: 1,
    backgroundColor: COLORS.bgSection,
    marginVertical: 12,
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
    fontWeight: "600",
  },
  noVariantText: {
    fontSize: 13,
    color: COLORS.dangerText,
    marginTop: 4,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
  },
  dateText: { flex: 1, fontSize: 15, color: COLORS.textPrimary, fontWeight: "600" },
  noSlotsText: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontStyle: "italic",
    padding: 10,
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
  slotText: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  slotTextDisabled: { color: COLORS.textDisabled, textDecorationLine: "line-through" },
  slotTextSelected: { color: COLORS.primary },
  payButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
  },
  payButtonDisabled: {
    backgroundColor: COLORS.textDisabled,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
