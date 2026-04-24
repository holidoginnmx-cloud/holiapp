import { COLORS } from "@/constants/colors";
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Image,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  getPetsByOwner,
  createMultiReservation,
  createPaymentIntent,
  getBathVariants,
  getAvailableRooms,
  getMe,
  type BathVariant,
  type BathSelectionsByPet,
  type MedicationByPet,
} from "@/lib/api";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useStripe } from "@stripe/stripe-react-native";
import { AnimatedPayButton } from "@/components/AnimatedPayButton";

function priceForPet(weight: number | null): number {
  return weight && weight >= 20 ? 450 : 350;
}

function bathSizeFromWeight(kg: number | null | undefined): "S" | "M" | "L" | "XL" {
  const w = kg ?? 0;
  if (w <= 5) return "S";
  if (w <= 15) return "M";
  if (w <= 24) return "L";
  return "XL";
}

function findBathVariant(
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

type BathState = { enabled: boolean; deslanado: boolean; corte: boolean };
type MedicationState = { enabled: boolean; notes: string };

export default function CreateReservationScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const role = useAuthStore((s) => s.role);
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // Form state
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);
  const [showCheckInPicker, setShowCheckInPicker] = useState(false);
  const [showCheckOutPicker, setShowCheckOutPicker] = useState(false);
  const [selectedPetIds, setSelectedPetIds] = useState<string[]>([]);
  const [roomPreference, setRoomPreference] = useState<"shared" | "separate">("shared");
  const [paymentType, setPaymentType] = useState<"FULL" | "DEPOSIT">("FULL");
  const [notes, setNotes] = useState("");
  const [legalTerms, setLegalTerms] = useState(false);
  const [legalVaccines, setLegalVaccines] = useState(false);
  const [legalIncidents, setLegalIncidents] = useState(false);
  const [bathByPet, setBathByPet] = useState<Record<string, BathState>>({});
  const [medicationByPet, setMedicationByPet] = useState<Record<string, MedicationState>>({});

  // Fetch owner's pets
  const { data: pets, isLoading: loadingPets } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
  });

  // Fetch bath price catalog (rarely changes)
  const { data: bathVariants } = useQuery({
    queryKey: ["bath-variants"],
    queryFn: getBathVariants,
    staleTime: 1000 * 60 * 60, // 1h
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });
  const creditBalance = Number(me?.creditBalance ?? 0);

  type PendingBalance = {
    reservationId: string;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
  };

  // Validate pet booking eligibility given selected dates
  function validatePet(pet: any, rangeStart: Date | null, rangeEnd: Date | null): {
    blockReason: string | null;
    warnings: string[];
    conflictDates: string | null;
    pendingBalance: PendingBalance | null;
  } {
    const status = pet?.cartillaStatus as
      | "PENDING" | "APPROVED" | "REJECTED" | null | undefined;

    // Detectar reserva con saldo pendiente (status=PENDING implica anticipo sin pago del balance)
    const pendingReservation = Array.isArray(pet?.reservations)
      ? pet.reservations.find((r: any) => r.status === "PENDING")
      : null;
    const pendingBalance: PendingBalance | null = pendingReservation
      ? {
          reservationId: pendingReservation.id,
          checkIn: pendingReservation.checkIn,
          checkOut: pendingReservation.checkOut,
          totalAmount: Number(pendingReservation.totalAmount ?? 0),
        }
      : null;

    if (status !== "APPROVED") {
      const msg =
        !status
          ? `${pet.name} aún no tiene cartilla subida. Sube la cartilla desde su perfil y espera la aprobación del equipo HDI.`
          : status === "PENDING"
          ? `${pet.name} tiene su cartilla en revisión. Te avisaremos cuando el equipo HDI la apruebe.`
          : `${pet.name} tiene la cartilla rechazada. Sube una nueva desde su perfil.`;
      return { blockReason: msg, warnings: [], conflictDates: null, pendingBalance };
    }

    if (!pet.weight || !pet.size) {
      return {
        blockReason: `Faltan datos en el perfil de ${pet.name}: ${
          !pet.weight && !pet.size ? "peso y tamaño" : !pet.weight ? "peso" : "tamaño"
        }. Complétalos para calcular el precio y asignar cuarto.`,
        warnings: [],
        conflictDates: null,
        pendingBalance,
      };
    }

    // Double-booking check
    let conflictDates: string | null = null;
    if (rangeStart && rangeEnd && Array.isArray(pet.reservations)) {
      const conflict = pet.reservations.find((r: any) => {
        const ci = new Date(r.checkIn);
        const co = new Date(r.checkOut);
        return ci < rangeEnd && co > rangeStart;
      });
      if (conflict) {
        const ci = new Date(conflict.checkIn).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
        });
        const co = new Date(conflict.checkOut).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
        });
        conflictDates = `${ci} — ${co}`;
        return {
          blockReason: `${pet.name} ya tiene una reservación del ${ci} al ${co}. Elige fechas que no se traslapen.`,
          warnings: [],
          conflictDates,
          pendingBalance,
        };
      }
    }

    // Vaccine warnings (vencidas o por vencer antes del checkOut)
    const warnings: string[] = [];
    if (Array.isArray(pet.vaccines) && rangeEnd) {
      for (const v of pet.vaccines) {
        if (!v.expiresAt) continue;
        const exp = new Date(v.expiresAt);
        if (exp < rangeEnd) {
          const label = exp.toLocaleDateString("es-MX", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          warnings.push(
            exp < new Date()
              ? `${v.name} está vencida desde ${label}`
              : `${v.name} vence el ${label} (antes del check-out)`
          );
        }
      }
    }

    return { blockReason: null, warnings, conflictDates, pendingBalance };
  }

  // Toggle pet selection
  const togglePet = (petId: string) => {
    const pet = pets?.find((p) => p.id === petId);
    const alreadySelected = selectedPetIds.includes(petId);
    if (!alreadySelected && pet) {
      const { blockReason, warnings } = validatePet(pet, checkIn, checkOut);
      if (blockReason) {
        Alert.alert("No se puede seleccionar", blockReason);
        return;
      }
      if (warnings.length > 0) {
        Alert.alert(
          "Revisa las vacunas",
          warnings.join("\n\n") +
            "\n\nTe recomendamos actualizar las vacunas antes del check-in."
        );
      }
    }
    setSelectedPetIds((prev) =>
      prev.includes(petId) ? prev.filter((id) => id !== petId) : [...prev, petId]
    );
  };

  // Selected pets info
  const selectedPets = useMemo(
    () => pets?.filter((p) => selectedPetIds.includes(p.id)) ?? [],
    [pets, selectedPetIds]
  );

  // Price calculation
  const totalDays =
    checkIn && checkOut
      ? Math.ceil((checkOut.getTime() - checkIn.getTime()) / 86_400_000)
      : 0;

  const priceBreakdown = useMemo(
    () =>
      selectedPets.map((pet) => {
        const perNight = priceForPet(pet.weight ?? null);
        return { pet, perNight, subtotal: perNight * totalDays };
      }),
    [selectedPets, totalDays]
  );

  // Live room availability check (once dates + pets are set)
  const uniqueSizes = useMemo(
    () => Array.from(new Set(selectedPets.map((p) => p.size).filter(Boolean))) as string[],
    [selectedPets]
  );
  const availabilityEnabled =
    !!checkIn && !!checkOut && totalDays > 0 && uniqueSizes.length > 0;
  const { data: availability } = useQuery({
    queryKey: [
      "rooms-available",
      checkIn?.toISOString(),
      checkOut?.toISOString(),
      uniqueSizes.join(","),
    ],
    queryFn: async () => {
      const entries = await Promise.all(
        uniqueSizes.map(async (size) => {
          const rooms = await getAvailableRooms({
            checkIn: checkIn!.toISOString(),
            checkOut: checkOut!.toISOString(),
            petSize: size,
          });
          return [size, rooms.length] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: availabilityEnabled,
  });
  const unavailableSizes = useMemo(() => {
    if (!availability) return [];
    return Object.entries(availability)
      .filter(([, count]) => count === 0)
      .map(([size]) => size);
  }, [availability]);

  const lodgingTotal = priceBreakdown.reduce((sum, r) => sum + r.subtotal, 0);

  // Bath total by pet
  const bathPriceByPet = useMemo(() => {
    const out: Record<string, number> = {};
    for (const pet of selectedPets) {
      const state = bathByPet[pet.id];
      if (!state?.enabled) continue;
      const variant = findBathVariant(bathVariants, pet.weight, state.deslanado, state.corte);
      if (variant) out[pet.id] = variant.price;
    }
    return out;
  }, [selectedPets, bathByPet, bathVariants]);

  const bathTotal = Object.values(bathPriceByPet).reduce((s, n) => s + n, 0);

  // Medication surcharge: +10% on lodging for each pet on medication
  const medicationSurchargeByPet = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of priceBreakdown) {
      if (medicationByPet[row.pet.id]?.enabled) {
        out[row.pet.id] = Math.ceil(row.subtotal * 0.10);
      }
    }
    return out;
  }, [priceBreakdown, medicationByPet]);
  const medicationTotal = Object.values(medicationSurchargeByPet).reduce(
    (s, n) => s + n,
    0
  );

  const baseTotal = lodgingTotal + bathTotal + medicationTotal;

  // Same-day surcharge: OWNER reservando con menos de 24h de anticipación paga +20%
  const hoursUntilCheckIn = checkIn
    ? (checkIn.getTime() - Date.now()) / (60 * 60 * 1000)
    : Infinity;
  const sameDaySurcharge = role === "OWNER" && hoursUntilCheckIn < 24;
  const surchargeAmount = sameDaySurcharge ? Math.ceil(baseTotal * 0.20) : 0;

  const grandTotal = baseTotal + surchargeAmount;
  const depositAmount = Math.ceil(grandTotal * 0.20);

  // Build payload for API (only enabled pets)
  const bathSelectionsPayload: BathSelectionsByPet | undefined = useMemo(() => {
    const entries = selectedPets
      .filter((p) => bathByPet[p.id]?.enabled)
      .map((p) => [
        p.id,
        { deslanado: bathByPet[p.id]!.deslanado, corte: bathByPet[p.id]!.corte },
      ] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }, [selectedPets, bathByPet]);

  const medicationPayload: MedicationByPet | undefined = useMemo(() => {
    const entries = selectedPets
      .filter((p) => medicationByPet[p.id]?.enabled)
      .map((p) => [p.id, { notes: medicationByPet[p.id]!.notes.trim() }] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }, [selectedPets, medicationByPet]);

  // Medication notes required if toggle is enabled
  const medicationNotesMissing = selectedPets.some(
    (p) => medicationByPet[p.id]?.enabled && medicationByPet[p.id]!.notes.trim().length === 0
  );

  // Anticipo only available if check-in is 3+ days away AND stay is 2+ nights
  const MIN_DAYS_FOR_DEPOSIT = 3;
  const canDeposit =
    !!checkIn &&
    totalDays >= 2 &&
    (checkIn.getTime() - Date.now()) / 86_400_000 >= MIN_DAYS_FOR_DEPOSIT;

  // Reset to FULL if deposit no longer valid
  if (paymentType === "DEPOSIT" && !canDeposit) {
    setPaymentType("FULL");
  }

  const allLegalAccepted = legalTerms && legalVaccines && legalIncidents;
  const canSubmit =
    !!checkIn &&
    !!checkOut &&
    selectedPetIds.length > 0 &&
    allLegalAccepted &&
    totalDays > 0 &&
    !medicationNotesMissing &&
    unavailableSizes.length === 0;

  const [paying, setPaying] = useState(false);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setPaying(true);
    try {
      // 1. Create PaymentIntent on backend
      const intent = await createPaymentIntent({
        petIds: selectedPetIds,
        checkIn: checkIn!.toISOString(),
        checkOut: checkOut!.toISOString(),
        ownerId: userId!,
        roomPreference,
        paymentType,
        bathSelectionsByPet: bathSelectionsPayload,
        medicationByPet: medicationPayload,
      });

      // 2. Init Stripe PaymentSheet
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: intent.clientSecret,
        merchantDisplayName: "HolidogInn",
        applePay: { merchantCountryCode: "MX" },
        appearance: {
          colors: {
            primary: COLORS.primary,
            background: COLORS.white,
            componentBackground: COLORS.bgPage,
            primaryText: COLORS.textPrimary,
            secondaryText: COLORS.textSecondary,
          },
          shapes: {
            borderRadius: 12,
            borderWidth: 1,
          },
          primaryButton: {
            colors: {
              background: COLORS.primary,
              text: COLORS.white,
            },
            shapes: {
              borderRadius: 12,
            },
          },
        },
      });

      if (initError) {
        Alert.alert("Error", initError.message);
        return;
      }

      // 3. Present PaymentSheet to user
      const { error: payError } = await presentPaymentSheet();

      if (payError) {
        if (payError.code !== "Canceled") {
          Alert.alert("Error de pago", payError.message);
        }
        return;
      }

      // 4. Payment succeeded — create reservations
      const result = await createMultiReservation({
        checkIn: checkIn!.toISOString(),
        checkOut: checkOut!.toISOString(),
        petIds: selectedPetIds,
        ownerId: userId!,
        notes: notes.trim() || null,
        legalAccepted: true,
        roomPreference,
        stripePaymentIntentId: intent.paymentIntentId,
        paymentType,
        bathSelectionsByPet: bathSelectionsPayload,
        medicationByPet: medicationPayload,
      });

      queryClient.invalidateQueries({ queryKey: ["reservations"] });

      const firstReservationId = result?.reservations?.[0]?.id;
      router.replace({
        pathname: "/reservation/success" as any,
        params: {
          reservationId: firstReservationId ?? "",
          paymentType,
          amount: paymentType === "DEPOSIT" ? String(depositAmount) : "0",
        },
      });
    } catch (err: any) {
      const msg: string = err?.message || "No se pudo procesar el pago";
      if (msg.toLowerCase().includes("consentimientos legales")) {
        Alert.alert(
          "Falta aceptar consentimientos",
          "Antes de reservar necesitas aceptar los documentos legales vigentes.",
          [
            { text: "Ahora no", style: "cancel" },
            {
              text: "Ir a firmar",
              onPress: () => router.push("/legal/onboarding"),
            },
          ]
        );
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setPaying(false);
    }
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const minCheckOut = checkIn
    ? new Date(checkIn.getTime() + 86_400_000)
    : tomorrow;

  // Avisos de saldo pendiente — una tarjeta por mascota con anticipo sin pagar
  const pendingBalanceAlerts = (pets ?? [])
    .map((p) => {
      const pending = p.reservations?.find((r) => r.status === "PENDING");
      if (!pending) return null;
      return {
        petName: p.name,
        reservationId: pending.id,
        checkIn: new Date(pending.checkIn).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
        }),
        checkOut: new Date(pending.checkOut).toLocaleDateString("es-MX", {
          day: "numeric",
          month: "short",
        }),
        totalAmount: Number(pending.totalAmount ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      testID="reservation-create-screen"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Nueva reservación</Text>
      </View>

      {/* ── Avisos de saldo pendiente ── */}
      {pendingBalanceAlerts.map((alert) => (
        <TouchableOpacity
          key={alert.reservationId}
          style={styles.pendingBanner}
          activeOpacity={0.85}
          onPress={() =>
            router.push(`/(tabs)/reservation/${alert.reservationId}` as any)
          }
        >
          <Ionicons name="alert-circle" size={22} color={COLORS.warningText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingBannerTitle}>
              {alert.petName} tiene un pago pendiente
            </Text>
            <Text style={styles.pendingBannerBody}>
              Reserva del {alert.checkIn} al {alert.checkOut}. Completa el pago
              para poder hacer otra reserva con anticipo.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.warningText} />
        </TouchableOpacity>
      ))}

      {/* ── Fechas ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fechas</Text>

        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <Text style={styles.label}>Check-in</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowCheckInPicker(true)}
              testID="reservation-create-checkin-button"
            >
              <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
              <Text style={[styles.dateText, !checkIn && { color: COLORS.textDisabled }]}>
                {checkIn
                  ? checkIn.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
                  : "Seleccionar"}
              </Text>
            </TouchableOpacity>
          </View>

          <Ionicons
            name="arrow-forward"
            size={20}
            color={COLORS.textDisabled}
            style={{ marginTop: 28 }}
          />

          <View style={styles.dateCol}>
            <Text style={styles.label}>Check-out</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowCheckOutPicker(true)}
              testID="reservation-create-checkout-button"
            >
              <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
              <Text style={[styles.dateText, !checkOut && { color: COLORS.textDisabled }]}>
                {checkOut
                  ? checkOut.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
                  : "Seleccionar"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {totalDays > 0 && (
          <Text style={styles.nightsText}>
            {totalDays} noche{totalDays > 1 ? "s" : ""}
          </Text>
        )}

        {sameDaySurcharge && (
          <View style={styles.surchargeWarning}>
            <Ionicons name="information-circle" size={18} color={COLORS.warningText} />
            <Text style={styles.surchargeWarningText}>
              Reservar con menos de 24 horas de anticipación tiene un cargo extra del 20%.
            </Text>
          </View>
        )}

        {showCheckInPicker && (
          <DateTimePicker
            value={checkIn || tomorrow}
            mode="date"
            minimumDate={new Date()}
            onChange={(_, date) => {
              setShowCheckInPicker(Platform.OS === "ios");
              if (date) {
                setCheckIn(date);
                if (checkOut && date >= checkOut) setCheckOut(null);
              }
            }}
          />
        )}
        {showCheckOutPicker && (
          <DateTimePicker
            value={checkOut && checkOut >= minCheckOut ? checkOut : minCheckOut}
            mode="date"
            minimumDate={minCheckOut}
            onChange={(_, date) => {
              setShowCheckOutPicker(Platform.OS === "ios");
              if (date) setCheckOut(date);
            }}
          />
        )}
      </View>

      {/* ── Mascotas (multi-select) ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mascotas</Text>
        <Text style={styles.hint}>Selecciona una o más mascotas</Text>
        {loadingPets ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : !pets?.length ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No tienes mascotas registradas</Text>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => router.push("/pet/create")}
            >
              <Ionicons name="add-circle" size={18} color={COLORS.primary} />
              <Text style={styles.linkText}>Registrar mascota</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.petRow}>
              {pets.map((pet, index) => {
                const isSelected = selectedPetIds.includes(pet.id);
                const { blockReason, warnings, conflictDates, pendingBalance } = validatePet(
                  pet,
                  checkIn,
                  checkOut
                );
                const cartillaStatus = (pet as any).cartillaStatus as
                  | "PENDING" | "APPROVED" | "REJECTED" | null | undefined;
                const blocked = !!blockReason;

                // Chip label shown at the bottom of the pet card
                let chipLabel: string | null = null;
                let chipColor = COLORS.warningText;
                if (cartillaStatus !== "APPROVED") {
                  chipLabel =
                    cartillaStatus === "PENDING"
                      ? "Cartilla en revisión"
                      : cartillaStatus === "REJECTED"
                      ? "Cartilla rechazada"
                      : "Sin cartilla";
                  chipColor = COLORS.errorText;
                } else if (!pet.weight || !pet.size) {
                  chipLabel = "Completa perfil";
                  chipColor = COLORS.errorText;
                } else if (conflictDates) {
                  chipLabel = `Ocupado ${conflictDates}`;
                  chipColor = COLORS.errorText;
                } else if (pendingBalance) {
                  chipLabel = "Saldo pendiente";
                  chipColor = COLORS.warningText;
                } else if (warnings.length > 0) {
                  chipLabel = `Vacunas: ${warnings.length}`;
                  chipColor = COLORS.warningText;
                }

                return (
                  <TouchableOpacity
                    key={pet.id}
                    style={[
                      styles.petChip,
                      isSelected && styles.petChipSelected,
                      blocked && !isSelected && { opacity: 0.55 },
                    ]}
                    onPress={() => togglePet(pet.id)}
                    testID={
                      index === 0
                        ? "reservation-create-pet-chip-first"
                        : `reservation-create-pet-chip-${pet.id}`
                    }
                  >
                    {isSelected && (
                      <View style={styles.petCheckmark}>
                        <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                      </View>
                    )}
                    {blocked && !isSelected && (
                      <View style={styles.cartillaLock}>
                        <Ionicons name="lock-closed" size={14} color={COLORS.white} />
                      </View>
                    )}
                    <Image
                      source={
                        pet.photoUrl
                          ? { uri: pet.photoUrl }
                          : require("../../assets/pet-placeholder.png")
                      }
                      style={styles.petChipPhoto}
                    />
                    <Text style={[styles.petChipName, isSelected && styles.petChipNameSelected]}>
                      {pet.name}
                    </Text>
                    <Text style={[styles.petChipWeight, isSelected && { color: COLORS.primaryLight }]}>
                      {pet.weight ? `${pet.weight} kg` : pet.size ?? "Sin datos"}
                    </Text>
                    {chipLabel && (
                      <Text style={[styles.cartillaChipWarn, { color: chipColor }]}>
                        {chipLabel}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>

      {/* ── Disponibilidad en vivo ── */}
      {availabilityEnabled && unavailableSizes.length > 0 && (
        <View style={styles.availabilityBanner}>
          <Ionicons name="warning" size={20} color={COLORS.errorText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.availabilityTitle}>
              Sin cuartos disponibles en esas fechas
            </Text>
            <Text style={styles.availabilityBody}>
              No hay habitación libre para tamaño {unavailableSizes.join(", ")}.
              Prueba con otras fechas.
            </Text>
          </View>
        </View>
      )}

      {/* ── Baño (upsell) ── */}
      {selectedPets.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>¿Lo entregamos bañado?</Text>
          <Text style={styles.hint}>Opcional. Se suma al total.</Text>
          {selectedPets.map((pet) => {
            const state = bathByPet[pet.id] ?? {
              enabled: false,
              deslanado: false,
              corte: false,
            };
            const variant = state.enabled
              ? findBathVariant(bathVariants, pet.weight, state.deslanado, state.corte)
              : undefined;
            return (
              <View key={pet.id} style={styles.bathPetBlock}>
                <TouchableOpacity
                  style={styles.bathToggleRow}
                  activeOpacity={0.7}
                  onPress={() =>
                    setBathByPet((prev) => ({
                      ...prev,
                      [pet.id]: { ...state, enabled: !state.enabled },
                    }))
                  }
                >
                  <Ionicons
                    name={state.enabled ? "checkbox" : "square-outline"}
                    size={22}
                    color={state.enabled ? COLORS.primary : COLORS.textDisabled}
                  />
                  <Text style={styles.bathPetName}>Baño para {pet.name}</Text>
                  {state.enabled && variant && (
                    <Text style={styles.bathPrice}>
                      ${variant.price.toLocaleString("es-MX")}
                    </Text>
                  )}
                </TouchableOpacity>
                {state.enabled && (
                  <View style={styles.bathOptionsRow}>
                    <TouchableOpacity
                      style={[styles.bathChip, state.deslanado && styles.bathChipSelected]}
                      onPress={() =>
                        setBathByPet((prev) => ({
                          ...prev,
                          [pet.id]: { ...state, deslanado: !state.deslanado },
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.bathChipText,
                          state.deslanado && styles.bathChipTextSelected,
                        ]}
                      >
                        Deslanado
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.bathChip, state.corte && styles.bathChipSelected]}
                      onPress={() =>
                        setBathByPet((prev) => ({
                          ...prev,
                          [pet.id]: { ...state, corte: !state.corte },
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.bathChipText,
                          state.corte && styles.bathChipTextSelected,
                        ]}
                      >
                        Corte
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* ── Medicamento (por mascota) ── */}
      {selectedPets.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>¿Alguna mascota toma medicamento?</Text>
          <Text style={styles.hint}>Opcional. Incluye un cargo extra del 10% por mascota.</Text>
          {selectedPets.map((pet) => {
            const state = medicationByPet[pet.id] ?? { enabled: false, notes: "" };
            const petSubtotal =
              priceBreakdown.find((r) => r.pet.id === pet.id)?.subtotal ?? 0;
            const surcharge = Math.ceil(petSubtotal * 0.10);
            const notesEmpty = state.enabled && state.notes.trim().length === 0;
            return (
              <View key={pet.id} style={styles.bathPetBlock}>
                <TouchableOpacity
                  style={styles.bathToggleRow}
                  activeOpacity={0.7}
                  onPress={() =>
                    setMedicationByPet((prev) => ({
                      ...prev,
                      [pet.id]: { ...state, enabled: !state.enabled },
                    }))
                  }
                >
                  <Ionicons
                    name={state.enabled ? "checkbox" : "square-outline"}
                    size={22}
                    color={state.enabled ? COLORS.primary : COLORS.textDisabled}
                  />
                  <Text style={styles.bathPetName}>Medicamento para {pet.name}</Text>
                  {state.enabled && surcharge > 0 && (
                    <Text style={styles.bathPrice}>
                      +${surcharge.toLocaleString("es-MX")}
                    </Text>
                  )}
                </TouchableOpacity>
                {state.enabled && (
                  <View style={styles.medicationNotesWrap}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.multiline,
                        notesEmpty && { borderColor: COLORS.errorText, borderWidth: 1.5 },
                      ]}
                      value={state.notes}
                      onChangeText={(text) =>
                        setMedicationByPet((prev) => ({
                          ...prev,
                          [pet.id]: { ...state, notes: text },
                        }))
                      }
                      placeholder="Nombre del medicamento, dosis, horarios, instrucciones especiales..."
                      placeholderTextColor={COLORS.textDisabled}
                      multiline
                      numberOfLines={3}
                    />
                    {notesEmpty && (
                      <View style={styles.medicationErrorRow}>
                        <Ionicons name="alert-circle" size={14} color={COLORS.errorText} />
                        <Text style={styles.medicationNotesError}>
                          Las instrucciones son obligatorias para poder reservar.
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* ── Preferencia de cuarto (solo si 2+ mascotas) ── */}
      {selectedPetIds.length >= 2 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tipo de alojamiento</Text>
          <View style={styles.prefRow}>
            <TouchableOpacity
              style={[styles.prefButton, roomPreference === "shared" && styles.prefButtonSelected]}
              onPress={() => setRoomPreference("shared")}
              testID="reservation-create-room-shared"
            >
              <Ionicons
                name="home-outline"
                size={22}
                color={roomPreference === "shared" ? COLORS.white : COLORS.textTertiary}
              />
              <Text style={[styles.prefText, roomPreference === "shared" && styles.prefTextSelected]}>
                Cuarto compartido
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.prefButton, roomPreference === "separate" && styles.prefButtonSelected]}
              onPress={() => setRoomPreference("separate")}
              testID="reservation-create-room-separate"
            >
              <Ionicons
                name="bed-outline"
                size={22}
                color={roomPreference === "separate" ? COLORS.white : COLORS.textTertiary}
              />
              <Text style={[styles.prefText, roomPreference === "separate" && styles.prefTextSelected]}>
                Cuartos separados
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Resumen de precio ── */}
      {selectedPets.length > 0 && totalDays > 0 && (
        <View style={styles.priceCard}>
          <Text style={styles.priceTitle}>Resumen</Text>
          {priceBreakdown.map((row) => (
            <View key={row.pet.id} style={styles.priceRow}>
              <Text style={styles.priceLabel}>
                {row.pet.name} ({row.pet.weight ?? 0}kg)
              </Text>
              <Text style={styles.priceValue}>
                ${row.perNight} × {totalDays} = ${row.subtotal.toLocaleString("es-MX")}
              </Text>
            </View>
          ))}
          {Object.entries(bathPriceByPet).map(([petId, price]) => {
            const pet = selectedPets.find((p) => p.id === petId);
            return (
              <View key={`bath-${petId}`} style={styles.priceRow}>
                <Text style={styles.priceLabel}>Baño {pet?.name ?? ""}</Text>
                <Text style={styles.priceValue}>
                  ${price.toLocaleString("es-MX")}
                </Text>
              </View>
            );
          })}
          {Object.entries(medicationSurchargeByPet).map(([petId, surcharge]) => {
            const pet = selectedPets.find((p) => p.id === petId);
            return (
              <View key={`med-${petId}`} style={styles.priceRow}>
                <Text style={styles.priceLabel}>
                  Medicamento {pet?.name ?? ""} (+10%)
                </Text>
                <Text style={styles.priceValue}>
                  ${surcharge.toLocaleString("es-MX")}
                </Text>
              </View>
            );
          })}
          {sameDaySurcharge && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Cargo reserva mismo día (+20%)</Text>
              <Text style={styles.priceValue}>
                ${surchargeAmount.toLocaleString("es-MX")}
              </Text>
            </View>
          )}
          {(() => {
            const creditApplied = Math.min(creditBalance, grandTotal);
            const hasCredit = creditApplied > 0;
            const totalAfterCredit = grandTotal - creditApplied;
            return (
              <>
                <View style={[styles.priceRow, styles.priceTotalRow]}>
                  <Text style={styles.priceTotalLabel}>Total</Text>
                  {hasCredit ? (
                    <View style={styles.totalWithCredit}>
                      <Text style={styles.priceTotalStrike}>
                        ${grandTotal.toLocaleString("es-MX")}
                      </Text>
                      <Text style={styles.priceTotalValue}>
                        ${totalAfterCredit.toLocaleString("es-MX")}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.priceTotalValue}>
                      ${grandTotal.toLocaleString("es-MX")}
                    </Text>
                  )}
                </View>
                {hasCredit && (
                  <View style={styles.creditHint}>
                    <Ionicons name="wallet" size={14} color={COLORS.successText} />
                    <Text style={styles.creditHintText}>
                      Se aplicarán ${creditApplied.toLocaleString("es-MX")} de tu saldo a favor
                    </Text>
                  </View>
                )}
              </>
            );
          })()}
        </View>
      )}

      {/* ── Tipo de pago ── */}
      {selectedPets.length > 0 && totalDays > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Forma de pago</Text>
          <View style={styles.prefRow}>
            <TouchableOpacity
              style={[styles.prefButton, paymentType === "FULL" && styles.prefButtonSelected]}
              onPress={() => setPaymentType("FULL")}
            >
              <Ionicons
                name="card-outline"
                size={22}
                color={paymentType === "FULL" ? COLORS.white : COLORS.textTertiary}
              />
              <Text style={[styles.prefText, paymentType === "FULL" && styles.prefTextSelected]}>
                Pago completo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.prefButton,
                paymentType === "DEPOSIT" && styles.prefButtonSelected,
                !canDeposit && { opacity: 0.4 },
              ]}
              onPress={() => canDeposit && setPaymentType("DEPOSIT")}
              disabled={!canDeposit}
            >
              <Ionicons
                name="time-outline"
                size={22}
                color={paymentType === "DEPOSIT" ? COLORS.white : COLORS.textTertiary}
              />
              <Text style={[styles.prefText, paymentType === "DEPOSIT" && styles.prefTextSelected]}>
                Anticipo 20%
              </Text>
            </TouchableOpacity>
          </View>
          {!canDeposit && checkIn && (
            <Text style={styles.depositDisabledHint}>
              {totalDays < 2
                ? "El anticipo no está disponible para estancias de una sola noche"
                : "El anticipo solo está disponible con 3 o más días de anticipación"}
            </Text>
          )}

          {paymentType === "DEPOSIT" && (
            <View style={styles.depositInfo}>
              <Text style={styles.depositCharge}>
                Pagarás ahora: ${depositAmount.toLocaleString("es-MX")} MXN
              </Text>
              <Text style={styles.depositRemaining}>
                Saldo pendiente: ${(grandTotal - depositAmount).toLocaleString("es-MX")} MXN
              </Text>
              <View style={styles.depositWarning}>
                <Ionicons name="warning-outline" size={16} color={COLORS.warningText} />
                <Text style={styles.depositWarningText}>
                  Deberás liquidar el saldo restante al menos 48 horas antes del check-in. De lo contrario, tu reservación será cancelada automáticamente.
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Legal ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Aceptación legal</Text>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setLegalTerms(!legalTerms)}
          testID="reservation-create-legal-terms"
        >
          <Ionicons
            name={legalTerms ? "checkbox" : "square-outline"}
            size={24}
            color={legalTerms ? COLORS.primary : COLORS.textDisabled}
          />
          <Text style={styles.checkText}>
            Acepto los{" "}
            <Text
              style={styles.checkLink}
              onPress={() => router.push("/legal/tos")}
            >
              términos y condiciones del servicio
            </Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setLegalVaccines(!legalVaccines)}
          testID="reservation-create-legal-vaccines"
        >
          <Ionicons
            name={legalVaccines ? "checkbox" : "square-outline"}
            size={24}
            color={legalVaccines ? COLORS.primary : COLORS.textDisabled}
          />
          <Text style={styles.checkText}>
            Confirmo que las vacunas de mi(s) mascota(s) están al día
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setLegalIncidents(!legalIncidents)}
          testID="reservation-create-legal-incidents"
        >
          <Ionicons
            name={legalIncidents ? "checkbox" : "square-outline"}
            size={24}
            color={legalIncidents ? COLORS.primary : COLORS.textDisabled}
          />
          <Text style={styles.checkText}>
            Acepto la{" "}
            <Text
              style={styles.checkLink}
              onPress={() => router.push("/legal/incidents")}
            >
              política de incidentes
            </Text>{" "}
            del hotel
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Notas ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notas (opcional)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Indicaciones especiales para esta estancia..."
          placeholderTextColor={COLORS.textDisabled}
          multiline
          numberOfLines={3}
        />
      </View>

      {/* ── Submit ── */}
      <AnimatedPayButton
        onPress={handleSubmit}
        disabled={!canSubmit}
        loading={paying}
        label="Pagar y confirmar"
        testID="reservation-create-submit-button"
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  contentContainer: { padding: 16, paddingBottom: 40 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.warningBg,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warningText,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  pendingBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.warningText,
    marginBottom: 2,
  },
  pendingBannerBody: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    gap: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary },
  hint: { fontSize: 13, color: COLORS.textTertiary, marginTop: -8 },
  label: { fontSize: 13, fontWeight: "600", color: COLORS.textTertiary, marginBottom: 4 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dateCol: { flex: 1 },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
  },
  dateText: { fontSize: 15, color: COLORS.textPrimary },
  nightsText: { fontSize: 14, fontWeight: "600", color: COLORS.primary, textAlign: "center" },
  // Pets
  petRow: { flexDirection: "row", gap: 12, paddingVertical: 4 },
  petChip: {
    alignItems: "center",
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderRadius: 14,
    padding: 12,
    width: 110,
    position: "relative",
  },
  petChipSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  petCheckmark: { position: "absolute", top: 6, right: 6, zIndex: 1 },
  cartillaLock: {
    position: "absolute",
    top: 6,
    right: 6,
    zIndex: 1,
    backgroundColor: COLORS.warningText,
    borderRadius: 10,
    padding: 3,
  },
  cartillaChipWarn: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.warningText,
    textAlign: "center",
    marginTop: 4,
  },
  petChipPhoto: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginBottom: 6,
    backgroundColor: COLORS.bgSection,
  },
  petChipName: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  petChipNameSelected: { color: COLORS.white },
  petChipWeight: { fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  emptyBox: { alignItems: "center", gap: 8, padding: 12 },
  emptyText: { fontSize: 14, color: COLORS.textDisabled, textAlign: "center" },
  linkButton: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
  // Room preference
  prefRow: { flexDirection: "row", gap: 10 },
  prefButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    paddingVertical: 14,
  },
  prefButtonSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  prefText: { fontSize: 14, fontWeight: "600", color: COLORS.textTertiary },
  prefTextSelected: { color: COLORS.white },
  // Price
  priceCard: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
    gap: 8,
  },
  priceTitle: { fontSize: 16, fontWeight: "700", color: COLORS.primary },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  priceLabel: { fontSize: 14, color: COLORS.textTertiary },
  priceValue: { fontSize: 14, fontWeight: "600", color: COLORS.textSecondary },
  priceTotalRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.primary,
    paddingTop: 8,
    marginTop: 4,
  },
  priceTotalLabel: { fontSize: 16, fontWeight: "700", color: COLORS.primary },
  priceTotalValue: { fontSize: 20, fontWeight: "800", color: COLORS.primary },
  // Legal
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkText: { fontSize: 14, color: COLORS.textSecondary, flex: 1, lineHeight: 20 },
  checkLink: { color: COLORS.primary, fontWeight: "600", textDecorationLine: "underline" },
  // Notes
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  // Submit
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
  },
  submitText: { fontSize: 17, fontWeight: "700", color: COLORS.white },
  // Deposit
  depositDisabledHint: { fontSize: 12, color: COLORS.textDisabled, marginTop: -4 },
  depositInfo: { gap: 6, marginTop: 4 },
  depositCharge: { fontSize: 15, fontWeight: "700", color: COLORS.successText },
  depositRemaining: { fontSize: 14, color: COLORS.textTertiary },
  depositWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: COLORS.warningBg,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  depositWarningText: {
    fontSize: 13,
    color: COLORS.warningText,
    flex: 1,
    lineHeight: 18,
  },
  surchargeWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.warningBg,
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  surchargeWarningText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.warningText,
    flex: 1,
    lineHeight: 18,
  },
  medicationNotesWrap: {
    paddingLeft: 32,
    gap: 6,
  },
  medicationNotesError: {
    flex: 1,
    fontSize: 12,
    color: COLORS.errorText,
    fontWeight: "600",
  },
  medicationErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  availabilityBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorText,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  availabilityTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.errorText,
  },
  availabilityBody: {
    fontSize: 13,
    color: COLORS.errorText,
    marginTop: 2,
    lineHeight: 18,
  },
  // Bath upsell
  bathPetBlock: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 10,
    gap: 8,
  },
  bathToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bathPetName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  bathPrice: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.primary,
  },
  bathOptionsRow: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 32,
  },
  bathChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  bathChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  bathChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  bathChipTextSelected: {
    color: COLORS.white,
  },
  creditHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  creditHintText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.successText,
    fontWeight: "600",
  },
  totalWithCredit: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  priceTotalStrike: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textDisabled,
    textDecorationLine: "line-through",
  },
});
