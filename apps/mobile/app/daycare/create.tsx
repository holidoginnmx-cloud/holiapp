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
import { StripeProvider, useStripe } from "@stripe/stripe-react-native";
import { useAuthStore } from "@/store/authStore";
import {
  getPetsByOwner,
  getDaycareAvailability,
  createDaycareIntent,
  confirmDaycare,
  validateReservationDiscount,
  getDeliveryStatus,
  getDeliveryAddress,
  saveDeliveryAddress,
  deliveryQuote,
} from "@/lib/api";
import {
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import { TimeSlotPicker } from "@/components/TimeSlotPicker";
import { ErrorState } from "@/components/ErrorState";

import {
  formatName,
  formatCurrency,
  formatDateLong,
  formatTimeHHmm,
} from "@/lib/format";
import { handlePaymentSheetError } from "@/lib/paymentError";
import {
  computeDaycareHours,
  isWithinDaycareHours,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
  DAYCARE_LATE_TOLERANCE_MIN,
} from "@holidoginn/shared/src/pricing";

const MAX_PETS = 6;

// 08:00, 08:30, ..., 18:00 — ventana de operación de la guardería.
const DAYCARE_TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = DAYCARE_OPEN_HOUR; h <= DAYCARE_CLOSE_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < DAYCARE_CLOSE_HOUR) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
})();

function toYMD(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function CreateDaycareScreen() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.holidoginnmx.app"
    >
      <CreateDaycareScreenContent />
    </StripeProvider>
  );
}

function CreateDaycareScreenContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ petId?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [selectedPetIds, setSelectedPetIds] = useState<string[]>(
    params.petId ? [params.petId] : [],
  );
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [checkOutTime, setCheckOutTime] = useState<string | null>(null);
  const [timePickerFor, setTimePickerFor] = useState<"in" | "out" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Servicio a domicilio ──
  const [homeDeliveryEnabled, setHomeDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; discountTotal: number } | null>(null);
  const [applyingDiscount, setApplyingDiscount] = useState(false);

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

  const dateYMD = useMemo(() => toYMD(date), [date]);

  // Cupo y tarifa del día seleccionado.
  const {
    data: availability,
    isLoading: availabilityLoading,
    isError: availabilityError,
    error: availabilityErrorObj,
    refetch: refetchAvailability,
  } = useQuery({
    queryKey: ["daycare-availability", dateYMD],
    queryFn: () => getDaycareAvailability(dateYMD),
  });

  // La guardería no exige cartilla aprobada (como el baño): se listan todas.
  const selectablePets = useMemo(() => pets ?? [], [pets]);
  const selectedPets = useMemo(
    () => selectablePets.filter((p) => selectedPetIds.includes(p.id)),
    [selectablePets, selectedPetIds],
  );

  const togglePet = (petId: string) => {
    setSelectedPetIds((prev) => {
      if (prev.includes(petId)) return prev.filter((id) => id !== petId);
      if (prev.length >= MAX_PETS) {
        Alert.alert(
          "Límite de mascotas",
          `Puedes reservar guardería para hasta ${MAX_PETS} mascotas por día.`,
        );
        return prev;
      }
      return [...prev, petId];
    });
  };

  // Estimado en vivo: MISMO helper que usa el backend al cotizar → el estimado
  // coincide exactamente con el monto del PaymentIntent.
  const hours =
    checkInTime && checkOutTime
      ? computeDaycareHours(checkInTime, checkOutTime)
      : 0;
  const invalidRange = !!checkInTime && !!checkOutTime && hours === 0;
  const outsideWindow =
    (!!checkInTime && !isWithinDaycareHours(checkInTime)) ||
    (!!checkOutTime && !isWithinDaycareHours(checkOutTime));

  const hourPrice = availability?.hourPrice ?? 0;
  const subtotal = hours * hourPrice * selectedPets.length;
  const discountTotal = appliedDiscount?.discountTotal ?? 0;
  const total = Math.max(0, subtotal - discountTotal) + deliveryFee;

  const noCapacity =
    !!availability &&
    selectedPets.length > 0 &&
    availability.remaining < selectedPets.length;

  // Si activó domicilio, exige una dirección con cotización válida antes de pagar.
  const deliveryIncomplete = homeDeliveryEnabled && !deliveryActive;
  const canSubmit =
    selectedPets.length > 0 &&
    !!checkInTime &&
    !!checkOutTime &&
    hours > 0 &&
    !outsideWindow &&
    !noCapacity &&
    !!availability &&
    !deliveryIncomplete &&
    !submitting;

  async function applyDiscount() {
    const code = discountCodeInput.trim();
    if (!code || subtotal <= 0) return;
    setApplyingDiscount(true);
    try {
      const res = await validateReservationDiscount({ code, subtotal });
      if (res.valid) {
        setAppliedDiscount({ code: code.toUpperCase(), discountTotal: res.discountTotal });
      } else {
        setAppliedDiscount(null);
        Alert.alert("Código de descuento", res.message);
      }
    } catch (err) {
      Alert.alert(
        "Código de descuento",
        err instanceof Error ? err.message : "No se pudo validar el código"
      );
    } finally {
      setApplyingDiscount(false);
    }
  }

  function removeDiscount() {
    setAppliedDiscount(null);
    setDiscountCodeInput("");
  }

  // Si cambia el subtotal (mascotas u horas), el descuento previo puede quedar
  // desactualizado; se limpia para que el usuario lo vuelva a aplicar.
  useEffect(() => {
    setAppliedDiscount(null);
  }, [subtotal]);

  async function handleSubmit() {
    if (!canSubmit || !checkInTime || !checkOutTime) return;
    setSubmitting(true);
    try {
      const payload = {
        petIds: selectedPetIds,
        date: dateYMD,
        checkInTime,
        checkOutTime,
        homeDelivery: homeDeliveryPayload,
        discountCode: appliedDiscount?.code,
      };
      const intent = await createDaycareIntent(payload);

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
        if (handlePaymentSheetError(payError, "daycare")) return;
      }

      await confirmDaycare(
        intent.coveredByCredit
          ? { paymentIntentId: null, ...payload }
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
      queryClient.invalidateQueries({ queryKey: ["daycare-availability", dateYMD] });
      router.replace({
        pathname: "/reservation/success" as any,
        params: { variant: "daycare" },
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No se pudo reservar la guardería";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  const { minDate, maxDate } = useMemo(() => {
    const min = new Date();
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
        testID="daycare-create-screen"
      >
        {/* Paso 1: mascotas (multi-select) */}
        <Text style={styles.sectionTitle}>1. ¿Para quién?</Text>
        {petsError ? (
          <ErrorState error={petsErrorObj} onRetry={refetchPets} compact />
        ) : petsLoading ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : selectablePets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="paw-outline" size={28} color={COLORS.primary} />
            <Text style={styles.emptyText}>
              Necesitas registrar una mascota para agendar guardería.
            </Text>
          </View>
        ) : (
          <View style={styles.petList}>
            {selectablePets.map((p) => {
              const selected = selectedPetIds.includes(p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.petCard, selected && styles.petCardSelected]}
                  onPress={() => togglePet(p.id)}
                  testID={`daycare-pet-${p.id}`}
                >
                  <Ionicons
                    name={selected ? "checkbox" : "square-outline"}
                    size={22}
                    color={selected ? COLORS.primary : COLORS.textTertiary}
                  />
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
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {selectedPets.length > 0 && (
          <>
            {/* Paso 2: fecha */}
            <Text style={styles.sectionTitle}>2. Día de guardería</Text>
            <TouchableOpacity
              style={styles.dateRow}
              onPress={() => setShowDatePicker(true)}
              testID="daycare-date-picker-button"
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
                  if (d) setDate(d);
                }}
              />
            )}

            {/* Cupo del día */}
            {availabilityError ? (
              <ErrorState
                error={availabilityErrorObj}
                onRetry={refetchAvailability}
                compact
              />
            ) : availabilityLoading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : availability ? (
              availability.remaining <= 0 ? (
                <View style={styles.capacityBannerFull}>
                  <Ionicons name="close-circle" size={16} color={COLORS.errorText} />
                  <Text style={styles.capacityBannerFullText}>
                    Sin cupo de guardería ese día. Prueba con otra fecha.
                  </Text>
                </View>
              ) : (
                <View style={styles.capacityBanner}>
                  <Ionicons name="sunny-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.capacityBannerText}>
                    {availability.remaining}{" "}
                    {availability.remaining === 1 ? "lugar disponible" : "lugares disponibles"}{" "}
                    · {formatCurrency(availability.hourPrice)}/hora
                  </Text>
                </View>
              )
            ) : null}
            {noCapacity && availability && availability.remaining > 0 && (
              <View style={styles.capacityBannerFull}>
                <Ionicons name="warning" size={16} color={COLORS.errorText} />
                <Text style={styles.capacityBannerFullText}>
                  Solo quedan {availability.remaining}{" "}
                  {availability.remaining === 1 ? "lugar" : "lugares"} ese día.
                  Quita mascotas o elige otra fecha.
                </Text>
              </View>
            )}

            {/* Paso 3: horario estimado */}
            <Text style={styles.sectionTitle}>3. Horario estimado</Text>
            <View style={styles.timesRow}>
              <TouchableOpacity
                style={styles.timeButton}
                onPress={() => setTimePickerFor("in")}
                testID="daycare-time-in-button"
              >
                <Text style={styles.timeButtonLabel}>ENTRADA</Text>
                <Text
                  style={[
                    styles.timeButtonValue,
                    !checkInTime && styles.timeButtonPlaceholder,
                  ]}
                >
                  {checkInTime ? formatTimeHHmm(checkInTime) : "Elegir"}
                </Text>
              </TouchableOpacity>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={COLORS.textDisabled}
              />
              <TouchableOpacity
                style={styles.timeButton}
                onPress={() => setTimePickerFor("out")}
                testID="daycare-time-out-button"
              >
                <Text style={styles.timeButtonLabel}>SALIDA</Text>
                <Text
                  style={[
                    styles.timeButtonValue,
                    !checkOutTime && styles.timeButtonPlaceholder,
                  ]}
                >
                  {checkOutTime ? formatTimeHHmm(checkOutTime) : "Elegir"}
                </Text>
              </TouchableOpacity>
            </View>
            {invalidRange && (
              <View style={styles.timeErrorRow}>
                <Ionicons name="alert-circle" size={14} color={COLORS.errorText} />
                <Text style={styles.timeErrorText}>
                  La hora de salida debe ser posterior a la de entrada.
                </Text>
              </View>
            )}
            {outsideWindow && (
              <View style={styles.timeErrorRow}>
                <Ionicons name="alert-circle" size={14} color={COLORS.errorText} />
                <Text style={styles.timeErrorText}>
                  El horario de guardería es de {DAYCARE_OPEN_HOUR}:00 a{" "}
                  {DAYCARE_CLOSE_HOUR}:00.
                </Text>
              </View>
            )}
            {hours > 0 && (
              <View style={styles.hoursNote}>
                <Ionicons name="time-outline" size={14} color={COLORS.infoText} />
                <Text style={styles.hoursNoteText}>
                  {hours} {hours === 1 ? "hora" : "horas"} estimadas (se cobra por
                  hora completa). Si recoges más tarde, las horas extra se cobran
                  al recoger (tolerancia de {DAYCARE_LATE_TOLERANCE_MIN} min).
                </Text>
              </View>
            )}

            {/* Servicio a domicilio */}
            {deliveryServiceActive && (
              <>
                <Text style={styles.sectionTitle}>Servicio a domicilio</Text>
                <TouchableOpacity
                  style={[
                    styles.toggleRow,
                    homeDeliveryEnabled && styles.toggleRowActive,
                  ]}
                  onPress={() => setHomeDeliveryEnabled((v) => !v)}
                  testID="daycare-delivery-toggle"
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
                    <Text style={styles.deliveryFeeText}>
                      {formatCurrency(deliveryFee)}
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
                          {deliveryQuoteData!.distanceKm} km ·{" "}
                          {formatCurrency(deliveryFee)} (ida y vuelta)
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}

            {/* Resumen */}
            {hours > 0 && hourPrice > 0 && (
              <View style={styles.priceCard}>
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>
                    {selectedPets.length}{" "}
                    {selectedPets.length === 1 ? "mascota" : "mascotas"} × {hours}{" "}
                    {hours === 1 ? "hora" : "horas"} ×{" "}
                    {formatCurrency(hourPrice)}
                  </Text>
                  <Text style={styles.priceLineValue}>
                    {formatCurrency(subtotal)}
                  </Text>
                </View>
                {deliveryActive && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Servicio a domicilio</Text>
                    <Text style={styles.priceLineValue}>
                      {formatCurrency(deliveryFee)}
                    </Text>
                  </View>
                )}

                {/* Código de descuento */}
                {appliedDiscount ? (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>
                      Descuento ({appliedDiscount.code})
                    </Text>
                    <View style={styles.discountAppliedValue}>
                      <Text style={styles.discountValueText}>
                        −{formatCurrency(discountTotal)}
                      </Text>
                      <TouchableOpacity onPress={removeDiscount} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={COLORS.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.discountRow}>
                    <TextInput
                      style={styles.discountInput}
                      placeholder="Código de descuento"
                      placeholderTextColor={COLORS.textTertiary}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      value={discountCodeInput}
                      onChangeText={setDiscountCodeInput}
                      editable={!applyingDiscount}
                    />
                    <TouchableOpacity
                      style={[
                        styles.discountApplyBtn,
                        (applyingDiscount || !discountCodeInput.trim()) &&
                          styles.discountApplyBtnDisabled,
                      ]}
                      onPress={applyDiscount}
                      disabled={applyingDiscount || !discountCodeInput.trim()}
                    >
                      <Text style={styles.discountApplyText}>
                        {applyingDiscount ? "…" : "Aplicar"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.priceDivider} />
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Pagas ahora</Text>
                  <Text style={styles.priceValue}>{formatCurrency(total)}</Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* Botón pagar */}
        {selectedPets.length > 0 && checkInTime && checkOutTime && hours > 0 && (
          <TouchableOpacity
            style={[styles.payButton, !canSubmit && styles.payButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            testID="daycare-pay-button"
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="card" size={20} color={COLORS.white} />
                <Text style={styles.payButtonText}>
                  Pagar {formatCurrency(total)} y confirmar
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <TimeSlotPicker
          visible={timePickerFor !== null}
          title={timePickerFor === "in" ? "Hora de entrada" : "Hora de salida"}
          subtitle={
            timePickerFor === "in"
              ? "¿A qué hora dejas a tu peludito? La guardería abre a las 8:00 am."
              : "¿A qué hora lo recoges? Si pasas más tarde, las horas extra se cobran al recoger."
          }
          value={timePickerFor === "in" ? checkInTime : checkOutTime}
          slots={DAYCARE_TIME_SLOTS}
          onSelect={(v) => {
            if (timePickerFor === "in") setCheckInTime(v);
            else setCheckOutTime(v);
            setTimePickerFor(null);
          }}
          onClose={() => setTimePickerFor(null)}
        />
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
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
  },
  dateText: { flex: 1, fontSize: 15, color: COLORS.textPrimary, fontWeight: "600" },
  capacityBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  capacityBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
  },
  capacityBannerFull: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.errorBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  capacityBannerFullText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.errorText,
  },
  timesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timeButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  timeButtonLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginBottom: 3,
  },
  timeButtonValue: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  timeButtonPlaceholder: {
    color: COLORS.textDisabled,
    fontWeight: "600",
  },
  timeErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  timeErrorText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.errorText,
    fontWeight: "600",
  },
  hoursNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: COLORS.infoBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  hoursNoteText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.infoText,
    fontWeight: "600",
    lineHeight: 17,
  },
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
  deliveryFeeText: { fontSize: 15, fontWeight: "700", color: COLORS.primary },
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
  priceLabel: { fontSize: 14, color: COLORS.textTertiary, fontWeight: "600", flexShrink: 1 },
  priceValue: { fontSize: 20, fontWeight: "800", color: COLORS.primary },
  priceLineValue: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  discountRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  discountInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    backgroundColor: "#fff",
  },
  discountApplyBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  discountApplyBtnDisabled: { opacity: 0.5 },
  discountApplyText: { color: COLORS.primary, fontWeight: "700", fontSize: 14 },
  discountAppliedValue: { flexDirection: "row", alignItems: "center", gap: 8 },
  discountValueText: { fontSize: 15, fontWeight: "700", color: COLORS.successText },
  priceDivider: {
    height: 1,
    backgroundColor: COLORS.bgSection,
    marginVertical: 12,
  },
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
