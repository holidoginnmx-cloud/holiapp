import { COLORS } from "@/constants/colors";
import { useState } from "react";
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
import { getDaycareAvailability, createDaycareIntent, confirmDaycare } from "@/lib/api";
import { TimeSlotPicker } from "@/components/TimeSlotPicker";
import { ErrorState } from "@/components/ErrorState";
import { PetPickerStep } from "@/components/wizard/PetPickerStep";
import { HomeDeliverySection } from "@/components/wizard/HomeDeliverySection";
import { DiscountCodeRow } from "@/components/wizard/DiscountCodeRow";
import { usePetSelection } from "@/hooks/usePetSelection";
import { useDaySelection } from "@/hooks/useDaySelection";
import { useHomeDelivery } from "@/hooks/useHomeDelivery";
import { useDiscountCode } from "@/hooks/useDiscountCode";
import { wizardStyles } from "@/styles/wizardStyles";

import { formatCurrency, formatDateLong, formatTimeHHmm } from "@/lib/format";
import { handlePaymentSheetError } from "@/lib/paymentError";
import {
  computeDaycareHours,
  isWithinDaycareHours,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
  DAYCARE_LATE_TOLERANCE_MIN,
} from "@holidoginn/shared/src/pricing";

const MAX_PETS = 6;

// 09:00, 09:30, ..., 18:00 — ventana de operación de la guardería.
const DAYCARE_TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = DAYCARE_OPEN_HOUR; h <= DAYCARE_CLOSE_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < DAYCARE_CLOSE_HOUR) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
})();

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

  // La guardería no exige cartilla aprobada (como el baño): se listan todas.
  const {
    pets: selectablePets,
    petsLoading,
    petsError,
    petsErrorObj,
    refetchPets,
    selectedPetIds,
    selectedPets,
    togglePet,
  } = usePetSelection({
    userId,
    initialPetIds: params.petId ? [params.petId] : [],
    maxPets: MAX_PETS,
    limitAlert: {
      title: "Límite de mascotas",
      message: `Puedes reservar guardería para hasta ${MAX_PETS} mascotas por día.`,
    },
  });

  const {
    date,
    setDate,
    showDatePicker,
    setShowDatePicker,
    dateYMD,
    minDate,
    maxDate,
    pickerValue,
  } = useDaySelection();

  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [checkOutTime, setCheckOutTime] = useState<string | null>(null);
  const [timePickerFor, setTimePickerFor] = useState<"in" | "out" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Servicio a domicilio ──
  const delivery = useHomeDelivery();
  const { deliveryActive, deliveryFee, homeDeliveryPayload, deliveryIncomplete } =
    delivery;

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
  const discount = useDiscountCode(subtotal);
  const { appliedDiscount, discountTotal } = discount;
  const total = Math.max(0, subtotal - discountTotal) + deliveryFee;

  const noCapacity =
    !!availability &&
    selectedPets.length > 0 &&
    availability.remaining < selectedPets.length;

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
      delivery.persistAddress();

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
        testID="daycare-create-screen"
      >
        {/* Paso 1: mascotas (multi-select) */}
        <Text style={wizardStyles.sectionTitle}>1. ¿Para quién?</Text>
        <PetPickerStep
          pets={selectablePets}
          isLoading={petsLoading}
          isError={petsError}
          error={petsErrorObj}
          onRetry={refetchPets}
          selectedPetIds={selectedPetIds}
          onToggle={togglePet}
          emptyText="Necesitas registrar una mascota para agendar guardería."
          testIDPrefix="daycare-pet"
        />

        {selectedPets.length > 0 && (
          <>
            {/* Paso 2: fecha */}
            <Text style={wizardStyles.sectionTitle}>2. Día de guardería</Text>
            <TouchableOpacity
              style={wizardStyles.dateRow}
              onPress={() => setShowDatePicker(true)}
              testID="daycare-date-picker-button"
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
            <Text style={wizardStyles.sectionTitle}>3. Horario estimado</Text>
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
            <HomeDeliverySection delivery={delivery} testID="daycare-delivery-toggle" />

            {/* Resumen */}
            {hours > 0 && hourPrice > 0 && (
              <View style={wizardStyles.priceCard}>
                <View style={wizardStyles.priceRow}>
                  <Text style={wizardStyles.priceLabel}>
                    {selectedPets.length}{" "}
                    {selectedPets.length === 1 ? "mascota" : "mascotas"} × {hours}{" "}
                    {hours === 1 ? "hora" : "horas"} ×{" "}
                    {formatCurrency(hourPrice)}
                  </Text>
                  <Text style={wizardStyles.priceLineValue}>
                    {formatCurrency(subtotal)}
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

                <View style={wizardStyles.priceDivider} />
                <View style={wizardStyles.priceRow}>
                  <Text style={wizardStyles.priceLabel}>Pagas ahora</Text>
                  <Text style={wizardStyles.priceValue}>{formatCurrency(total)}</Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* Botón pagar */}
        {selectedPets.length > 0 && checkInTime && checkOutTime && hours > 0 && (
          <TouchableOpacity
            style={[
              wizardStyles.payButton,
              !canSubmit && wizardStyles.payButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            testID="daycare-pay-button"
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="card" size={20} color={COLORS.white} />
                <Text style={wizardStyles.payButtonText}>
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
              ? "¿A qué hora dejas a tu peludito? La guardería abre a las 9:00 am."
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

// Estilos propios de guardería (cupo del día, horario entrada/salida y nota
// de horas). Lo compartido con los otros wizards vive en wizardStyles.
const styles = StyleSheet.create({
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginBottom: 3,
  },
  timeButtonValue: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  timeButtonPlaceholder: {
    color: COLORS.textDisabled,
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_600SemiBold",
    lineHeight: 17,
  },
});
