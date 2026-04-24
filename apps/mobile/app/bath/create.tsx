import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
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
import { useStripe } from "@stripe/stripe-react-native";
import { useAuthStore } from "@/store/authStore";
import {
  getPetsByOwner,
  getBathVariants,
  getBathSlots,
  createBathIntent,
  confirmBath,
} from "@/lib/api";

function sizeFromWeight(kg: number): "S" | "M" | "L" | "XL" {
  if (kg <= 5) return "S";
  if (kg <= 15) return "M";
  if (kg <= 24) return "L";
  return "XL";
}

function bathSizeKey(size: string): "S" | "M" | "L" | "XL" {
  if (size === "XS") return "S";
  return (size as "S" | "M" | "L" | "XL");
}

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
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: pets, isLoading: petsLoading } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
  });

  const { data: variants } = useQuery({
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

  const canSubmit =
    !!selectedPet &&
    !!variant &&
    !!selectedSlotIso &&
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
      });

      if (!intent.coveredByCredit && intent.clientSecret) {
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: intent.clientSecret,
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
      }

      await confirmBath(
        intent.coveredByCredit
          ? {
              petId: selectedPet.id,
              variantId: intent.variantId,
              appointmentAt: selectedSlotIso,
            }
          : { paymentIntentId: intent.paymentIntentId! },
      );

      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["bath-slots", dateYMD] });
      Alert.alert(
        "Cita confirmada",
        `Baño agendado para ${formatDateLong(date)} a las ${formatSlotLocal(selectedSlotIso)}.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo reservar el baño";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);

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
        {petsLoading ? (
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
                    <Text style={styles.petName}>{p.name}</Text>
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

            {variant && (
              <View style={styles.priceCard}>
                <Text style={styles.priceLabel}>Precio</Text>
                <Text style={styles.priceValue}>
                  ${Number(variant.price).toLocaleString("es-MX")}
                </Text>
              </View>
            )}
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
                value={date}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={minDate}
                maximumDate={maxDate}
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
            ) : (
              <>
                <Ionicons name="card" size={20} color={COLORS.white} />
                <Text style={styles.payButtonText}>
                  Pagar ${Number(variant.price).toLocaleString("es-MX")} y confirmar
                </Text>
              </>
            )}
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
  priceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginTop: 6,
  },
  priceLabel: { fontSize: 14, color: COLORS.textTertiary, fontWeight: "600" },
  priceValue: { fontSize: 22, fontWeight: "800", color: COLORS.primary },
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
