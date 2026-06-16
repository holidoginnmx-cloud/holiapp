import { COLORS } from "@/constants/colors";
import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
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
  getDeliveryStatus,
  getDeliveryAddress,
  saveDeliveryAddress,
  deliveryQuote,
  type BathVariant,
  type BathSelectionsByPet,
  type MedicationByPet,
} from "@/lib/api";
import DateTimePicker from "@react-native-community/datetimepicker";
import { StripeProvider, useStripe } from "@stripe/stripe-react-native";
import { AnimatedPayButton } from "@/components/AnimatedPayButton";
import { CheckInReminderModal } from "@/components/CheckInReminderModal";
import { ErrorState } from "@/components/ErrorState";
import {
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import { formatName, formatCurrency, formatDayShort, formatDayShortYear } from "@/lib/format";
import { handlePaymentSheetError } from "@/lib/paymentError";
import { styles } from "@/styles/reservationCreateStyles";
import {
  sizeFromWeight,
  pricePerDayForWeight,
  computeDays,
} from "@holidoginn/shared/src/pricing";

function findBathVariant(
  variants: BathVariant[] | undefined,
  petWeight: number | null | undefined,
  deslanado: boolean,
  corte: boolean
): BathVariant | undefined {
  if (!variants) return undefined;
  const size = sizeFromWeight(petWeight);
  return variants.find(
    (v) => v.petSize === size && v.deslanado === deslanado && v.corte === corte
  );
}

type BathState = { enabled: boolean; deslanado: boolean; corte: boolean };
type MedicationState = { enabled: boolean; notes: string };

export default function CreateReservationScreen() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.holidoginnmx.app"
    >
      <CreateReservationScreenContent />
    </StripeProvider>
  );
}

function CreateReservationScreenContent() {
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

  // ── Servicio a domicilio ──
  const [homeDeliveryEnabled, setHomeDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);

  // ¿El servicio está activo? Gate para mostrar la opción.
  const { data: deliveryStatus } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: getDeliveryStatus,
    staleTime: 1000 * 60 * 10,
  });
  const deliveryServiceActive = deliveryStatus?.active === true;

  // Precarga la dirección guardada del usuario (para futuras reservas).
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

  // Cotiza distancia + tarifa para la dirección seleccionada.
  const { data: deliveryQuoteData, isLoading: deliveryQuoteLoading } = useQuery({
    queryKey: ["delivery-quote", deliveryAddress?.lat, deliveryAddress?.lng],
    queryFn: () => deliveryQuote(deliveryAddress!.lat, deliveryAddress!.lng),
    enabled: homeDeliveryEnabled && !!deliveryAddress,
  });
  const deliveryActive =
    homeDeliveryEnabled && !!deliveryAddress && deliveryQuoteData?.active === true;
  const deliveryFee = deliveryActive ? deliveryQuoteData!.fee : 0;

  // Fetch owner's pets
  const {
    data: pets,
    isLoading: loadingPets,
    isError: petsError,
    error: petsErrorObj,
    refetch: refetchPets,
  } = useQuery({
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

    // Detectar reserva con saldo pendiente (anticipo sin pago del balance)
    const pendingReservation = Array.isArray(pet?.reservations)
      ? pet.reservations.find(
          (r: any) => r.paymentType === "DEPOSIT" && r.hasBalance === true,
        )
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
          ? `${formatName(pet.name)} aún no tiene cartilla subida. Sube la cartilla desde su perfil y espera la aprobación del equipo HDI.`
          : status === "PENDING"
          ? `${formatName(pet.name)} tiene su cartilla en revisión. Te avisaremos cuando el equipo HDI la apruebe.`
          : `${formatName(pet.name)} tiene la cartilla rechazada. Sube una nueva desde su perfil.`;
      return { blockReason: msg, warnings: [], conflictDates: null, pendingBalance };
    }

    if (!pet.weight || !pet.size) {
      return {
        blockReason: `Faltan datos en el perfil de ${formatName(pet.name)}: ${
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
        const ci = formatDayShort(conflict.checkIn);
        const co = formatDayShort(conflict.checkOut);
        conflictDates = `${ci} — ${co}`;
        return {
          blockReason: `${formatName(pet.name)} ya tiene una reservación del ${ci} al ${co}. Elige fechas que no se traslapen.`,
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
          const label = formatDayShortYear(exp);
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
        const cartillaStatus = (pet as any).cartillaStatus as
          | "PENDING" | "APPROVED" | "REJECTED" | null | undefined;
        // Si el bloqueo es por cartilla y la cartilla no está PENDING (en
        // revisión), ofrecemos un atajo para subirla/actualizarla.
        const offerCartillaUpload =
          cartillaStatus !== "APPROVED" && cartillaStatus !== "PENDING";
        if (offerCartillaUpload) {
          Alert.alert("No se puede seleccionar", blockReason, [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Subir cartilla",
              onPress: () =>
                router.push({
                  pathname: "/pet/create",
                  params: { editId: pet.id, focus: "cartilla" },
                } as any),
            },
          ]);
        } else {
          Alert.alert("No se puede seleccionar", blockReason);
        }
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

  // Price calculation. computeDays (UTC, redondeo) es la MISMA función que usa
  // el backend al cobrar → el estimado y el cargo no divergen en el nº de noches.
  const totalDays = checkIn && checkOut ? computeDays(checkIn, checkOut) : 0;

  const priceBreakdown = useMemo(
    () =>
      selectedPets.map((pet) => {
        const perNight = pricePerDayForWeight(pet.weight ?? null);
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

  // La fee de domicilio es un costo logístico fijo: no lleva el recargo
  // mismo-día, pero sí entra en la base del anticipo (igual que el backend).
  const grandTotal = baseTotal + surchargeAmount + deliveryFee;
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

  // Payload de domicilio — el backend recalcula la fee desde lat/lng.
  const homeDeliveryPayload = useMemo(
    () =>
      deliveryActive && deliveryAddress
        ? {
            address: deliveryAddress.address,
            lat: deliveryAddress.lat,
            lng: deliveryAddress.lng,
            placeId: deliveryAddress.placeId,
          }
        : undefined,
    [deliveryActive, deliveryAddress],
  );

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
  // Si activó domicilio, exige una dirección con cotización válida antes de pagar
  // (evita reservar sin el servicio que pidió).
  const deliveryIncomplete = homeDeliveryEnabled && !deliveryActive;
  const canSubmit =
    !!checkIn &&
    !!checkOut &&
    selectedPetIds.length > 0 &&
    allLegalAccepted &&
    totalDays > 0 &&
    !medicationNotesMissing &&
    !deliveryIncomplete &&
    unavailableSizes.length === 0;

  const [paying, setPaying] = useState(false);
  const [showCheckInReminder, setShowCheckInReminder] = useState(false);

  // Al presionar "Pagar y confirmar" mostramos primero el recordatorio de
  // horarios de check-in/check-out. El cobro real ocurre en runPayment cuando
  // el usuario presiona "Entendido".
  const handleSubmit = () => {
    if (!canSubmit) return;
    setShowCheckInReminder(true);
  };

  const handleReminderAcknowledge = () => {
    setShowCheckInReminder(false);
    runPayment();
  };

  const runPayment = async () => {
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
        homeDelivery: homeDeliveryPayload,
      });

      // 2. Saldo a favor cubre todo: confirmar con el usuario antes de aplicar
      // el cargo. Sin esto el botón "Reservar" se sentiría mágico — Stripe no
      // muestra ningún modal porque no hay cobro.
      if (intent.coveredByCredit) {
        const remaining = creditBalance - intent.creditApplied;
        const userConfirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Pagar con saldo a favor",
            `Se aplicarán ${formatCurrency(intent.creditApplied)} de tu saldo a favor para cubrir el anticipo.\n\nSaldo restante después: ${formatCurrency(remaining)}.`,
            [
              { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
              { text: "Confirmar", onPress: () => resolve(true) },
            ],
            { cancelable: false }
          );
        });
        if (!userConfirmed) return;
      }

      // 3. Open Stripe PaymentSheet only when there is something to charge.
      if (!intent.coveredByCredit && intent.clientSecret) {
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: intent.clientSecret,
          merchantDisplayName: "Holidog Inn",
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

        const { error: payError } = await presentPaymentSheet();

        if (handlePaymentSheetError(payError, "reservation")) return;
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
        homeDelivery: homeDeliveryPayload,
      });

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

      const firstReservationId = result?.reservations?.[0]?.id;
      router.replace({
        pathname: "/reservation/success" as any,
        params: {
          reservationId: firstReservationId ?? "",
          paymentType,
          amount: paymentType === "DEPOSIT" ? String(depositAmount) : "0",
          paidWith: intent.coveredByCredit ? "CREDIT" : "STRIPE",
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

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const minCheckOut = useMemo(() => {
    if (!checkIn) return tomorrow;
    const d = new Date(checkIn.getTime() + 86_400_000);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [checkIn, tomorrow]);

  const checkInValue =
    checkIn && checkIn >= today ? checkIn : tomorrow;

  // Avisos de saldo pendiente — una tarjeta por mascota con anticipo sin pagar
  const pendingBalanceAlerts = (pets ?? [])
    .map((p) => {
      const pending = p.reservations?.find(
        (r) => r.paymentType === "DEPOSIT" && r.hasBalance === true,
      );
      if (!pending) return null;
      return {
        petName: p.name,
        reservationId: pending.id,
        checkIn: formatDayShort(pending.checkIn),
        checkOut: formatDayShort(pending.checkOut),
        totalAmount: Number(pending.totalAmount ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      // En iOS dejamos que el ScrollView mueva el input enfocado arriba del
      // teclado vía automaticallyAdjustKeyboardInsets (el padding del KAV solo
      // achica el viewport pero no hace scroll-to-input, por eso Notas — el
      // input de hasta abajo — quedaba tapado). En Android usamos "height".
      behavior={Platform.OS === "ios" ? undefined : "height"}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
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
            router.push(`/reservation/detail/${alert.reservationId}` as any)
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
                  ? formatDayShort(checkIn)
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
                  ? formatDayShort(checkOut)
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

        {(showCheckInPicker || showCheckOutPicker) && (
          <View style={styles.datePickersRow}>
            {showCheckInPicker && (
              <DateTimePicker
                value={checkInValue}
                mode="date"
                minimumDate={today}
                themeVariant="light"
                textColor={COLORS.textPrimary}
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
                themeVariant="light"
                textColor={COLORS.textPrimary}
                onChange={(_, date) => {
                  setShowCheckOutPicker(Platform.OS === "ios");
                  if (date) setCheckOut(date);
                }}
              />
            )}
          </View>
        )}
      </View>

      {/* ── Mascotas (multi-select) ── */}
      <View
        style={[
          styles.section,
          selectedPetIds.length === 0 && pets?.length ? styles.petSectionHighlight : null,
        ]}
      >
        <View style={styles.petTitleRow}>
          <Text style={styles.sectionTitle}>
            Mascotas{" "}
            <Text style={styles.requiredAsterisk}>*</Text>
          </Text>
          {selectedPetIds.length > 0 && (
            <View style={styles.petCountBadge}>
              <Ionicons name="checkmark" size={12} color={COLORS.white} />
              <Text style={styles.petCountBadgeText}>
                {selectedPetIds.length} seleccionada{selectedPetIds.length === 1 ? "" : "s"}
              </Text>
            </View>
          )}
        </View>
        {selectedPetIds.length === 0 && pets?.length ? (
          <View style={styles.petCueBanner}>
            <Ionicons name="paw" size={18} color={COLORS.primary} />
            <Text style={styles.petCueBannerText}>
              Toca la mascota que se hospedará para continuar
            </Text>
          </View>
        ) : (
          <Text style={styles.hint}>Selecciona una o más mascotas</Text>
        )}
        {petsError ? (
          <ErrorState error={petsErrorObj} onRetry={refetchPets} compact />
        ) : loadingPets ? (
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
                  | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | null | undefined;
                const blocked = !!blockReason;

                // Chip label shown at the bottom of the pet card
                let chipLabel: string | null = null;
                let chipColor: string = COLORS.warningText;
                if (cartillaStatus !== "APPROVED") {
                  chipLabel =
                    cartillaStatus === "PENDING"
                      ? "Cartilla en revisión"
                      : cartillaStatus === "REJECTED"
                      ? "Cartilla rechazada"
                      : cartillaStatus === "EXPIRED"
                      ? "Cartilla vencida"
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
                      {formatName(pet.name)}
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
                  <Text style={styles.bathPetName}>Baño para {formatName(pet.name)}</Text>
                  {state.enabled && variant && (
                    <Text style={styles.bathPrice}>
                      {formatCurrency(variant.price)}
                    </Text>
                  )}
                </TouchableOpacity>
                {state.enabled && (
                  <>
                    <View style={styles.bathOptionsRow}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={[styles.bathChip, state.deslanado && styles.bathChipSelected]}
                        onPress={() =>
                          setBathByPet((prev) => ({
                            ...prev,
                            [pet.id]: { ...state, deslanado: !state.deslanado },
                          }))
                        }
                      >
                        <Ionicons
                          name={state.deslanado ? "checkmark-circle" : "sparkles-outline"}
                          size={15}
                          color={state.deslanado ? COLORS.primary : COLORS.textTertiary}
                        />
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
                        activeOpacity={0.7}
                        style={[styles.bathChip, state.corte && styles.bathChipSelected]}
                        onPress={() =>
                          setBathByPet((prev) => ({
                            ...prev,
                            [pet.id]: { ...state, corte: !state.corte },
                          }))
                        }
                      >
                        <Ionicons
                          name={state.corte ? "checkmark-circle" : "cut-outline"}
                          size={15}
                          color={state.corte ? COLORS.primary : COLORS.textTertiary}
                        />
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
                    {(state.deslanado || state.corte) && (
                      <View style={styles.bathExtrasNote}>
                        <Ionicons
                          name="information-circle"
                          size={14}
                          color={COLORS.warningText}
                        />
                        <Text style={styles.bathExtrasNoteText}>
                          El{" "}
                          {state.deslanado && state.corte
                            ? "deslanado y corte"
                            : state.deslanado
                              ? "deslanado"
                              : "corte"}{" "}
                          se cobra al traer a tu mascota. El precio depende del estado del pelaje.
                        </Text>
                      </View>
                    )}
                  </>
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
                  <Text style={styles.bathPetName}>Medicamento para {formatName(pet.name)}</Text>
                  {state.enabled && surcharge > 0 && (
                    <Text style={styles.bathPrice}>
                      +{formatCurrency(surcharge)}
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

      {/* ── Servicio a domicilio ── */}
      {deliveryServiceActive && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Servicio a domicilio</Text>
          <Text style={styles.hint}>
            Recogemos y entregamos a tu mascota en tu domicilio. Opcional.
          </Text>
          <TouchableOpacity
            style={styles.bathToggleRow}
            activeOpacity={0.7}
            onPress={() => setHomeDeliveryEnabled((v) => !v)}
            testID="reservation-delivery-toggle"
          >
            <Ionicons
              name={homeDeliveryEnabled ? "checkbox" : "square-outline"}
              size={22}
              color={homeDeliveryEnabled ? COLORS.primary : COLORS.textDisabled}
            />
            <Text style={styles.bathPetName}>Quiero servicio a domicilio</Text>
            {deliveryActive && (
              <Text style={styles.bathPrice}>
                {formatCurrency(deliveryFee)}
              </Text>
            )}
          </TouchableOpacity>
          {homeDeliveryEnabled && (
            <View style={{ gap: 8 }}>
              <DeliveryAddressPicker
                value={deliveryAddress}
                onChange={setDeliveryAddress}
              />
              {deliveryAddress && deliveryQuoteLoading && (
                <Text style={styles.hint}>Calculando distancia…</Text>
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
                {formatName(row.pet.name)} ({row.pet.weight ?? 0}kg)
              </Text>
              <Text style={styles.priceValue}>
                ${row.perNight} × {totalDays} = {formatCurrency(row.subtotal)}
              </Text>
            </View>
          ))}
          {Object.entries(bathPriceByPet).map(([petId, price]) => {
            const pet = selectedPets.find((p) => p.id === petId);
            return (
              <View key={`bath-${petId}`} style={styles.priceRow}>
                <Text style={styles.priceLabel}>Baño {pet?.name ?? ""}</Text>
                <Text style={styles.priceValue}>
                  {formatCurrency(price)}
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
                  {formatCurrency(surcharge)}
                </Text>
              </View>
            );
          })}
          {sameDaySurcharge && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Cargo reserva mismo día (+20%)</Text>
              <Text style={styles.priceValue}>
                {formatCurrency(surchargeAmount)}
              </Text>
            </View>
          )}
          {deliveryActive && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Servicio a domicilio</Text>
              <Text style={styles.priceValue}>
                {formatCurrency(deliveryFee)}
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
                        {formatCurrency(grandTotal)}
                      </Text>
                      <Text style={styles.priceTotalValue}>
                        {formatCurrency(totalAfterCredit)}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.priceTotalValue}>
                      {formatCurrency(grandTotal)}
                    </Text>
                  )}
                </View>
                {hasCredit && (
                  <View style={styles.creditHint}>
                    <Ionicons name="wallet" size={14} color={COLORS.successText} />
                    <Text style={styles.creditHintText}>
                      Se aplicarán {formatCurrency(creditApplied)} de tu saldo a favor
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
                Pagarás ahora: {formatCurrency(depositAmount)} MXN
              </Text>
              <Text style={styles.depositRemaining}>
                Saldo pendiente: {formatCurrency(grandTotal - depositAmount)} MXN
              </Text>
              <View style={styles.depositWarning}>
                <Ionicons name="information-circle-outline" size={16} color={COLORS.infoText} />
                <Text style={styles.depositWarningText}>
                  Puedes liquidar el saldo en la app o pagarlo al entregar a tu mascota en la sucursal de Holidog Inn.
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

      <CheckInReminderModal
        visible={showCheckInReminder}
        onAcknowledge={handleReminderAcknowledge}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
