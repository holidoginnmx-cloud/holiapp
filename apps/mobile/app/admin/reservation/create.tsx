import { COLORS } from "@/constants/colors";
import React, { useMemo, useState } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { LevelSelector } from "@/components/LevelSelector";
import { ErrorState } from "@/components/ErrorState";
import {
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import {
  getAllPets,
  getRooms,
  getBathVariants,
  createReservation,
  getUsers,
  registerManualPayment,
  getDeliveryStatus,
  deliveryQuote,
  getAdminLodgingPricing,
  type PetWithOwner,
} from "@/lib/api";
import {
  formatName,
  formatFullName,
  formatWeekdayDayShort,
  formatTime,
  formatCurrency,
} from "@/lib/format";
import {
  sizeFromWeight,
  computeDaycareHours,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
} from "@holidoginn/shared/src/pricing";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

type ReservationType = "STAY" | "BATH" | "DAYCARE";

// Date → "HH:mm" (hora local del dispositivo, que corre en hora del hotel).
function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDate(d: Date | null): string {
  if (!d) return "Seleccionar";
  return formatWeekdayDayShort(d);
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminCreateReservation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [reservationType, setReservationType] = useState<ReservationType>("STAY");
  const [clientSearch, setClientSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [petId, setPetId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // STAY
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);
  const [showCheckInPicker, setShowCheckInPicker] = useState(false);
  const [showCheckOutPicker, setShowCheckOutPicker] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomsExpanded, setRoomsExpanded] = useState(false);

  // BATH
  const [appointmentAt, setAppointmentAt] = useState<Date | null>(null);
  const [showBathDatePicker, setShowBathDatePicker] = useState(false);
  const [showBathTimePicker, setShowBathTimePicker] = useState(false);
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);

  // DAYCARE (guardería): día + horas estimadas ("HH:mm") + total editable.
  const [dcDate, setDcDate] = useState<Date | null>(null);
  const [showDcDatePicker, setShowDcDatePicker] = useState(false);
  const [dcInTime, setDcInTime] = useState("09:00");
  const [dcOutTime, setDcOutTime] = useState("13:00");
  const [showDcInPicker, setShowDcInPicker] = useState(false);
  const [showDcOutPicker, setShowDcOutPicker] = useState(false);
  // Total sugerido editable (walk-in con precio pactado). Vacío = usar sugerido.
  const [dcTotalOverride, setDcTotalOverride] = useState("");

  // Baño como complemento de un hospedaje (STAY)
  const [stayBathEnabled, setStayBathEnabled] = useState(false);
  const [stayDeslanado, setStayDeslanado] = useState(false);
  const [stayCorte, setStayCorte] = useState(false);

  // Medicamento (STAY)
  const [medEnabled, setMedEnabled] = useState(false);
  const [medNotes, setMedNotes] = useState("");

  // Asignar staff
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staffExpanded, setStaffExpanded] = useState(false);

  // Servicio a domicilio
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);

  // Anticipo / pago
  const [depositAgreed, setDepositAgreed] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "TRANSFER">("CASH");

  const {
    data: pets,
    isLoading: petsLoading,
    isError: petsError,
    error: petsErrorObj,
    refetch: refetchPets,
  } = useQuery({
    queryKey: ["admin", "all-pets"],
    queryFn: getAllPets,
  });

  // Clientes derivados de las mascotas (solo dueños con mascota activa).
  // La búsqueda coincide por nombre de cliente o de mascota (sin acentos);
  // si coincidió una mascota se muestra como subtítulo y queda preseleccionada.
  const owners = useMemo(() => {
    type OwnerEntry = {
      id: string;
      name: string;
      photoUrl: string | null;
      pets: { id: string; name: string; photoUrl: string | null }[];
    };
    const map = new Map<string, OwnerEntry>();
    for (const p of pets ?? []) {
      if (!p.owner) continue;
      let entry = map.get(p.owner.id);
      if (!entry) {
        entry = {
          id: p.owner.id,
          name: formatFullName(p.owner.firstName, p.owner.lastName),
          photoUrl: null,
          pets: [],
        };
        map.set(p.owner.id, entry);
      }
      entry.pets.push({
        id: p.id,
        name: formatName(p.name),
        photoUrl: p.photoUrl ?? null,
      });
      if (!entry.photoUrl && p.photoUrl) entry.photoUrl = p.photoUrl;
    }
    const list = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const q = norm(clientSearch.trim());
    if (!q) {
      return list.map((o) => ({ ...o, matchedPet: null as OwnerEntry["pets"][number] | null }));
    }
    return list.flatMap((o) => {
      const matchedPet = o.pets.find((p) => norm(p.name).includes(q)) ?? null;
      if (!norm(o.name).includes(q) && !matchedPet) return [];
      return [{ ...o, matchedPet }];
    });
  }, [pets, clientSearch]);

  const ownerPets = useMemo(
    () => (pets ?? []).filter((p) => p.owner?.id === ownerId),
    [pets, ownerId],
  );

  const selectedOwnerName = useMemo(() => {
    const owner = (pets ?? []).find((p) => p.owner?.id === ownerId)?.owner;
    return owner ? formatFullName(owner.firstName, owner.lastName) : "";
  }, [pets, ownerId]);

  const selectedPet: PetWithOwner | undefined = useMemo(
    () => (pets ?? []).find((p) => p.id === petId),
    [pets, petId],
  );

  const petSize = selectedPet ? sizeFromWeight(selectedPet.weight) : null;

  // Cuartos disponibles para el tamaño de la mascota (solo STAY).
  const { data: rooms, isLoading: roomsLoading } = useQuery({
    queryKey: ["admin", "rooms", petSize],
    queryFn: () => getRooms(petSize!),
    enabled: reservationType === "STAY" && !!petSize,
  });

  const selectedRoom = useMemo(
    () => (rooms ?? []).find((r) => r.id === roomId),
    [rooms, roomId],
  );

  const { data: bathVariants } = useQuery({
    queryKey: ["admin", "bath-variants"],
    queryFn: getBathVariants,
    enabled: reservationType === "BATH" || stayBathEnabled,
  });

  // Tarifa por hora de guardería (para sugerir el total). Se recalcula server-side.
  const { data: lodgingPricing } = useQuery({
    queryKey: ["admin", "lodging-pricing"],
    queryFn: getAdminLodgingPricing,
    enabled: reservationType === "DAYCARE",
  });
  const daycareHourPrice = lodgingPricing?.daycareHourPrice ?? 0;

  // Estimado de guardería: horas (ceil, mín 1) × tarifa única.
  const daycareEstimate = useMemo(() => {
    if (reservationType !== "DAYCARE") return null;
    const hours = computeDaycareHours(dcInTime, dcOutTime);
    if (hours <= 0 || daycareHourPrice <= 0) return null;
    return { hours, total: hours * daycareHourPrice };
  }, [reservationType, dcInTime, dcOutTime, daycareHourPrice]);

  // Staff (rol STAFF) para asignación opcional.
  const { data: allUsers } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });
  const staffList = useMemo(
    () => (allUsers ?? []).filter((u) => u.role === "STAFF"),
    [allUsers],
  );
  const selectedStaff = useMemo(
    () => (allUsers ?? []).find((u) => u.id === staffId),
    [allUsers, staffId],
  );

  // Servicio a domicilio: gate por config + cotización server-side.
  const { data: deliveryStatus } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: getDeliveryStatus,
    staleTime: 1000 * 60 * 10,
  });
  const deliveryServiceActive = deliveryStatus?.active === true;
  const { data: deliveryQuoteData } = useQuery({
    queryKey: ["delivery-quote", deliveryAddress?.lat, deliveryAddress?.lng],
    queryFn: () => deliveryQuote(deliveryAddress!.lat, deliveryAddress!.lng),
    enabled: deliveryEnabled && !!deliveryAddress,
  });

  // ── Estimados de precio (informativos; el backend recalcula el total) ──
  const stayEstimate = useMemo(() => {
    if (reservationType !== "STAY" || !checkIn || !checkOut || !selectedPet)
      return null;
    const days = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) / 86_400_000,
    );
    if (days <= 0) return null;
    const perDay = (selectedPet.weight ?? 0) >= 20 ? 450 : 350;
    return { days, total: perDay * days };
  }, [reservationType, checkIn, checkOut, selectedPet]);

  const bathEstimate = useMemo(() => {
    if (reservationType !== "BATH" || !petSize || !bathVariants) return null;
    const variant = bathVariants.find(
      (v) =>
        v.petSize === petSize && v.deslanado === deslanado && v.corte === corte,
    );
    return variant ? variant.price : null;
  }, [reservationType, petSize, bathVariants, deslanado, corte]);

  const stayBathPrice = useMemo(() => {
    if (!stayBathEnabled || !petSize || !bathVariants) return null;
    const variant = bathVariants.find(
      (v) =>
        v.petSize === petSize &&
        v.deslanado === stayDeslanado &&
        v.corte === stayCorte,
    );
    return variant ? variant.price : null;
  }, [stayBathEnabled, petSize, bathVariants, stayDeslanado, stayCorte]);

  const deliveryFeeEstimate =
    deliveryEnabled && deliveryQuoteData?.active ? deliveryQuoteData.fee : 0;

  // Total base estimado (informativo; el backend recalcula el total real).
  const grandTotalEstimate = useMemo(() => {
    if (!selectedPet) return null;
    if (reservationType === "STAY") {
      if (!stayEstimate) return null;
      const lodging = stayEstimate.total;
      const med = medEnabled ? lodging * 0.1 : 0;
      const bath = stayBathEnabled ? stayBathPrice ?? 0 : 0;
      return lodging + med + bath + deliveryFeeEstimate;
    }
    if (reservationType === "DAYCARE") {
      const override = Number(dcTotalOverride);
      const base =
        dcTotalOverride.trim() && override > 0
          ? override
          : daycareEstimate?.total ?? null;
      if (base == null) return null;
      return base + deliveryFeeEstimate;
    }
    if (bathEstimate == null) return null;
    return bathEstimate + deliveryFeeEstimate;
  }, [
    selectedPet,
    reservationType,
    stayEstimate,
    medEnabled,
    stayBathEnabled,
    stayBathPrice,
    bathEstimate,
    daycareEstimate,
    dcTotalOverride,
    deliveryFeeEstimate,
  ]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  function selectOwner(id: string, matchedPetId?: string) {
    setOwnerId(id);
    // Si la búsqueda coincidió por mascota, se preselecciona directamente.
    setPetId(matchedPetId ?? null);
    setRoomId(null);
    setClientSearch(""); // colapsa la lista tras elegir
  }

  function selectPet(id: string) {
    setPetId(id);
    setRoomId(null); // el tamaño cambia → la lista de cuartos cambia
    setRoomsExpanded(false);
  }

  async function handleSubmit() {
    if (!ownerId || !petId) {
      Alert.alert("Faltan datos", "Selecciona un cliente y una mascota.");
      return;
    }

    // Validaciones de medicamento y domicilio (comunes).
    if (medEnabled && !medNotes.trim()) {
      Alert.alert("Faltan datos", "Escribe las instrucciones del medicamento.");
      return;
    }
    if (deliveryEnabled && !deliveryAddress) {
      Alert.alert("Faltan datos", "Selecciona la dirección de domicilio.");
      return;
    }

    // Campos comunes adicionales.
    const common: Record<string, unknown> = {
      ownerId,
      petId,
      notes: notes.trim() || null,
      legalAccepted: true,
      ...(staffId ? { staffId } : {}),
      ...(depositAgreed.trim() ? { depositAgreed: Number(depositAgreed) } : {}),
      ...(deliveryEnabled && deliveryAddress
        ? {
            homeDelivery: {
              address: deliveryAddress.address,
              lat: deliveryAddress.lat,
              lng: deliveryAddress.lng,
              placeId: deliveryAddress.placeId,
            },
          }
        : {}),
    };

    let payload: Record<string, unknown>;
    if (reservationType === "STAY") {
      if (!checkIn || !checkOut) {
        Alert.alert("Faltan datos", "Selecciona las fechas de entrada y salida.");
        return;
      }
      if (checkOut <= checkIn) {
        Alert.alert("Fechas inválidas", "La salida debe ser posterior a la entrada.");
        return;
      }
      if (!roomId) {
        Alert.alert("Faltan datos", "Selecciona un cuarto.");
        return;
      }
      if (stayBathEnabled && stayBathPrice == null) {
        Alert.alert(
          "Servicio no disponible",
          "No hay una variante de baño configurada para esta combinación.",
        );
        return;
      }
      payload = {
        ...common,
        reservationType: "STAY",
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        roomId,
        ...(medEnabled ? { medicationNotes: medNotes.trim() } : {}),
        ...(stayBathEnabled
          ? { bath: { deslanado: stayDeslanado, corte: stayCorte } }
          : {}),
      };
    } else if (reservationType === "DAYCARE") {
      if (!dcDate) {
        Alert.alert("Faltan datos", "Selecciona el día de la guardería.");
        return;
      }
      if (computeDaycareHours(dcInTime, dcOutTime) <= 0) {
        Alert.alert(
          "Horario inválido",
          "La hora de salida debe ser posterior a la de entrada.",
        );
        return;
      }
      const override = Number(dcTotalOverride);
      payload = {
        ...common,
        reservationType: "DAYCARE",
        // La hora del ISO no importa: el server ancla el día a mediodía UTC.
        appointmentAt: dcDate.toISOString(),
        checkInTime: dcInTime,
        checkOutTime: dcOutTime,
        ...(dcTotalOverride.trim() && override > 0
          ? { totalAmountOverride: override }
          : {}),
      };
    } else {
      if (!appointmentAt) {
        Alert.alert("Faltan datos", "Selecciona la fecha y hora de la cita.");
        return;
      }
      if (bathEstimate == null) {
        Alert.alert(
          "Servicio no disponible",
          "No hay una variante de baño configurada para esta combinación.",
        );
        return;
      }
      payload = {
        ...common,
        reservationType: "BATH",
        appointmentAt: appointmentAt.toISOString(),
        deslanado,
        corte,
      };
    }

    setSubmitting(true);
    try {
      const created = await createReservation(payload);
      // Pago manual inicial (opcional): se registra contra la reserva creada.
      const amount = Number(payAmount);
      if (payAmount.trim() && amount > 0 && created?.id) {
        await registerManualPayment({
          reservationId: created.id,
          amount,
          method: payMethod,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "reservations"] });
      Alert.alert("Reservación creada", "La reservación se creó correctamente.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert(
        "No se pudo crear",
        err instanceof Error ? err.message : "Error desconocido",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (petsError) {
    return <ErrorState error={petsErrorObj} onRetry={refetchPets} />;
  }

  if (petsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LevelSelector
          label="Tipo de reservación"
          options={[
            { key: "STAY", label: "Hospedaje" },
            { key: "BATH", label: "Baño" },
            { key: "DAYCARE", label: "Guardería" },
          ]}
          selected={reservationType}
          onSelect={(k) => {
            setReservationType(k as ReservationType);
            setRoomId(null);
          }}
        />

        {/* ── Cliente ── */}
        <Text style={styles.label}>Cliente</Text>
        {ownerId && !clientSearch.trim() ? (
          <TouchableOpacity
            style={styles.selectedRow}
            onPress={() => setOwnerId(null)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-circle" size={20} color={COLORS.primary} />
            <Text style={styles.selectedText}>{selectedOwnerName}</Text>
            <Text style={styles.changeText}>Cambiar</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={16} color={COLORS.textDisabled} />
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar cliente o mascota..."
                placeholderTextColor={COLORS.textDisabled}
                value={clientSearch}
                onChangeText={setClientSearch}
                autoCorrect={false}
              />
              {clientSearch.length > 0 && (
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={COLORS.textDisabled}
                  onPress={() => setClientSearch("")}
                />
              )}
            </View>
            {clientSearch.trim().length > 0 && (
              <View style={styles.listBox}>
                {owners.length === 0 ? (
                  <Text style={styles.emptyText}>Sin coincidencias</Text>
                ) : (
                  owners.map((o) => {
                    const avatarUrl = o.matchedPet?.photoUrl ?? o.photoUrl;
                    return (
                      <TouchableOpacity
                        key={o.id}
                        style={[styles.row, ownerId === o.id && styles.rowSelected]}
                        onPress={() => selectOwner(o.id, o.matchedPet?.id)}
                        activeOpacity={0.7}
                      >
                        {avatarUrl ? (
                          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                        ) : (
                          <View style={[styles.avatar, styles.avatarPlaceholder]}>
                            <Ionicons name="paw" size={14} color={COLORS.textTertiary} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.rowText,
                              ownerId === o.id && styles.rowTextSelected,
                            ]}
                          >
                            {o.name}
                          </Text>
                          {o.matchedPet && (
                            <Text style={styles.rowSubText}>
                              🐾 {o.matchedPet.name}
                            </Text>
                          )}
                        </View>
                        {ownerId === o.id && (
                          <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}
          </>
        )}

        {/* ── Mascota ── */}
        {ownerId && (
          <>
            <Text style={styles.label}>Mascota</Text>
            <View style={styles.listBox}>
              {ownerPets.length === 0 ? (
                <Text style={styles.emptyText}>Este cliente no tiene mascotas</Text>
              ) : (
                ownerPets.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.row, petId === p.id && styles.rowSelected]}
                    onPress={() => selectPet(p.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.rowText, petId === p.id && styles.rowTextSelected]}>
                      {formatName(p.name)} ({p.weight ?? 0} kg)
                    </Text>
                    {petId === p.id && (
                      <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          </>
        )}

        {/* ── STAY: fechas + cuarto ── */}
        {petId && reservationType === "STAY" && (
          <>
            <Text style={styles.label}>Fechas</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowCheckInPicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateBtnLabel}>Entrada</Text>
                  <Text style={styles.dateBtnValue}>{formatDate(checkIn)}</Text>
                </TouchableOpacity>
                {showCheckInPicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={checkIn ?? today}
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
                  </View>
                )}
              </View>
              <View style={styles.dateCol}>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowCheckOutPicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateBtnLabel}>Salida</Text>
                  <Text style={styles.dateBtnValue}>{formatDate(checkOut)}</Text>
                </TouchableOpacity>
                {showCheckOutPicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={checkOut ?? (checkIn ?? today)}
                      mode="date"
                      minimumDate={checkIn ?? today}
                      themeVariant="light"
                      textColor={COLORS.textPrimary}
                      onChange={(_, date) => {
                        setShowCheckOutPicker(Platform.OS === "ios");
                        if (date) setCheckOut(date);
                      }}
                    />
                  </View>
                )}
              </View>
            </View>

            <Text style={styles.label}>Cuarto</Text>
            {roomsLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
            ) : (
              <>
                <TouchableOpacity
                  style={styles.collapseHeader}
                  onPress={() => setRoomsExpanded((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.collapseHeaderText,
                      selectedRoom && styles.rowTextSelected,
                    ]}
                  >
                    {selectedRoom
                      ? `${selectedRoom.name} · cap. ${selectedRoom.capacity}`
                      : "Seleccionar cuarto"}
                  </Text>
                  <Ionicons
                    name={roomsExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={COLORS.textTertiary}
                  />
                </TouchableOpacity>
                {roomsExpanded && (
                  <View style={styles.listBox}>
                    {(rooms ?? []).length === 0 ? (
                      <Text style={styles.emptyText}>
                        No hay cuartos para el tamaño de esta mascota
                      </Text>
                    ) : (
                      (rooms ?? []).map((r) => (
                        <TouchableOpacity
                          key={r.id}
                          style={[styles.row, roomId === r.id && styles.rowSelected]}
                          onPress={() => {
                            setRoomId(r.id);
                            setRoomsExpanded(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.rowText,
                              roomId === r.id && styles.rowTextSelected,
                            ]}
                          >
                            {r.name} · cap. {r.capacity}
                          </Text>
                          {roomId === r.id && (
                            <Ionicons
                              name="checkmark-circle"
                              size={18}
                              color={COLORS.primary}
                            />
                          )}
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </>
            )}

            {/* Baño como complemento */}
            <LevelSelector
              label="Incluir baño"
              options={[
                { key: "no", label: "No" },
                { key: "si", label: "Sí" },
              ]}
              selected={stayBathEnabled ? "si" : "no"}
              onSelect={(k) => setStayBathEnabled(k === "si")}
            />
            {stayBathEnabled && (
              <>
                <LevelSelector
                  label="Deslanado"
                  options={[
                    { key: "no", label: "No" },
                    { key: "si", label: "Sí" },
                  ]}
                  selected={stayDeslanado ? "si" : "no"}
                  onSelect={(k) => setStayDeslanado(k === "si")}
                />
                <LevelSelector
                  label="Corte"
                  options={[
                    { key: "no", label: "No" },
                    { key: "si", label: "Sí" },
                  ]}
                  selected={stayCorte ? "si" : "no"}
                  onSelect={(k) => setStayCorte(k === "si")}
                />
                {stayBathPrice != null ? (
                  <Text style={styles.estimate}>Baño: ${stayBathPrice}</Text>
                ) : petSize ? (
                  <Text style={styles.estimateWarn}>
                    No hay variante de baño para esta combinación
                  </Text>
                ) : null}
              </>
            )}

            {/* Medicamento */}
            <LevelSelector
              label="Medicamento (+10%)"
              options={[
                { key: "no", label: "No" },
                { key: "si", label: "Sí" },
              ]}
              selected={medEnabled ? "si" : "no"}
              onSelect={(k) => setMedEnabled(k === "si")}
            />
            {medEnabled && (
              <TextInput
                style={styles.notesInput}
                placeholder="Instrucciones del medicamento..."
                placeholderTextColor={COLORS.textDisabled}
                value={medNotes}
                onChangeText={setMedNotes}
                multiline
              />
            )}

            {stayEstimate && (
              <Text style={styles.estimate}>
                Estimado hospedaje: {stayEstimate.days} día
                {stayEstimate.days === 1 ? "" : "s"} · ${stayEstimate.total}
              </Text>
            )}
          </>
        )}

        {/* ── BATH: fecha/hora + opciones ── */}
        {petId && reservationType === "BATH" && (
          <>
            <Text style={styles.label}>Fecha y hora de la cita</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowBathDatePicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateBtnLabel}>Fecha</Text>
                  <Text style={styles.dateBtnValue}>
                    {appointmentAt ? formatDate(appointmentAt) : "Seleccionar"}
                  </Text>
                </TouchableOpacity>
                {showBathDatePicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={appointmentAt ?? today}
                      mode="date"
                      minimumDate={today}
                      themeVariant="light"
                      textColor={COLORS.textPrimary}
                      onChange={(_, date) => {
                        setShowBathDatePicker(Platform.OS === "ios");
                        if (date) {
                          const base = appointmentAt ?? new Date(today);
                          const next = new Date(date);
                          next.setHours(base.getHours(), base.getMinutes(), 0, 0);
                          setAppointmentAt(next);
                        }
                      }}
                    />
                  </View>
                )}
              </View>
              <View style={styles.dateCol}>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowBathTimePicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateBtnLabel}>Hora</Text>
                  <Text style={styles.dateBtnValue}>
                    {appointmentAt
                      ? formatTime(appointmentAt)
                      : "Seleccionar"}
                  </Text>
                </TouchableOpacity>
                {showBathTimePicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={appointmentAt ?? today}
                      mode="time"
                      themeVariant="light"
                      textColor={COLORS.textPrimary}
                      onChange={(_, date) => {
                        setShowBathTimePicker(Platform.OS === "ios");
                        if (date) {
                          const base = appointmentAt ?? new Date(today);
                          const next = new Date(base);
                          next.setHours(date.getHours(), date.getMinutes(), 0, 0);
                          setAppointmentAt(next);
                        }
                      }}
                    />
                  </View>
                )}
              </View>
            </View>

            <LevelSelector
              label="Deslanado"
              options={[
                { key: "no", label: "No" },
                { key: "si", label: "Sí" },
              ]}
              selected={deslanado ? "si" : "no"}
              onSelect={(k) => setDeslanado(k === "si")}
            />
            <LevelSelector
              label="Corte"
              options={[
                { key: "no", label: "No" },
                { key: "si", label: "Sí" },
              ]}
              selected={corte ? "si" : "no"}
              onSelect={(k) => setCorte(k === "si")}
            />

            {bathEstimate != null ? (
              <Text style={styles.estimate}>Precio: ${bathEstimate}</Text>
            ) : petSize ? (
              <Text style={styles.estimateWarn}>
                No hay variante configurada para esta combinación
              </Text>
            ) : null}
          </>
        )}

        {/* ── DAYCARE: día + horas estimadas + total ── */}
        {petId && reservationType === "DAYCARE" && (
          <>
            <Text style={styles.label}>Día de guardería</Text>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowDcDatePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dateBtnLabel}>Fecha</Text>
              <Text style={styles.dateBtnValue}>
                {dcDate ? formatDate(dcDate) : "Seleccionar"}
              </Text>
            </TouchableOpacity>
            {showDcDatePicker && (
              <View style={styles.pickerWrap}>
                <DateTimePicker
                  value={dcDate ?? today}
                  mode="date"
                  minimumDate={today}
                  themeVariant="light"
                  textColor={COLORS.textPrimary}
                  onChange={(_, date) => {
                    setShowDcDatePicker(Platform.OS === "ios");
                    if (date) setDcDate(date);
                  }}
                />
              </View>
            )}

            <Text style={styles.label}>Horario estimado</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowDcInPicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateBtnLabel}>Entrada</Text>
                  <Text style={styles.dateBtnValue}>{dcInTime}</Text>
                </TouchableOpacity>
                {showDcInPicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={(() => {
                        const [h, m] = dcInTime.split(":").map(Number);
                        const d = new Date(today);
                        d.setHours(h, m, 0, 0);
                        return d;
                      })()}
                      mode="time"
                      themeVariant="light"
                      textColor={COLORS.textPrimary}
                      onChange={(_, date) => {
                        setShowDcInPicker(Platform.OS === "ios");
                        if (date) setDcInTime(toHHmm(date));
                      }}
                    />
                  </View>
                )}
              </View>
              <View style={styles.dateCol}>
                <TouchableOpacity
                  style={styles.dateBtn}
                  onPress={() => setShowDcOutPicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateBtnLabel}>Salida</Text>
                  <Text style={styles.dateBtnValue}>{dcOutTime}</Text>
                </TouchableOpacity>
                {showDcOutPicker && (
                  <View style={styles.pickerWrap}>
                    <DateTimePicker
                      value={(() => {
                        const [h, m] = dcOutTime.split(":").map(Number);
                        const d = new Date(today);
                        d.setHours(h, m, 0, 0);
                        return d;
                      })()}
                      mode="time"
                      themeVariant="light"
                      textColor={COLORS.textPrimary}
                      onChange={(_, date) => {
                        setShowDcOutPicker(Platform.OS === "ios");
                        if (date) setDcOutTime(toHHmm(date));
                      }}
                    />
                  </View>
                )}
              </View>
            </View>
            <Text style={styles.hint}>
              Horario de guardería: {DAYCARE_OPEN_HOUR}:00 a {DAYCARE_CLOSE_HOUR}:00.
            </Text>

            {daycareEstimate ? (
              <Text style={styles.estimate}>
                Sugerido: {daycareEstimate.hours}{" "}
                {daycareEstimate.hours === 1 ? "hora" : "horas"} ×{" "}
                {formatCurrency(daycareHourPrice)} ={" "}
                {formatCurrency(daycareEstimate.total)}
              </Text>
            ) : null}

            <Text style={styles.label}>Total a cobrar (editable)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder={
                daycareEstimate ? String(daycareEstimate.total) : "Total"
              }
              placeholderTextColor={COLORS.textDisabled}
              value={dcTotalOverride}
              onChangeText={setDcTotalOverride}
              keyboardType="numeric"
            />
          </>
        )}

        {/* ── Staff (opcional) ── */}
        {petId && (
          <>
            <Text style={styles.label}>Asignar staff (opcional)</Text>
            <TouchableOpacity
              style={styles.collapseHeader}
              onPress={() => setStaffExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.collapseHeaderText,
                  selectedStaff && styles.rowTextSelected,
                ]}
              >
                {selectedStaff
                  ? formatFullName(selectedStaff.firstName, selectedStaff.lastName)
                  : "Sin asignar"}
              </Text>
              <Ionicons
                name={staffExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={COLORS.textTertiary}
              />
            </TouchableOpacity>
            {staffExpanded && (
              <View style={styles.listBox}>
                <TouchableOpacity
                  style={[styles.row, !staffId && styles.rowSelected]}
                  onPress={() => {
                    setStaffId(null);
                    setStaffExpanded(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.rowText, !staffId && styles.rowTextSelected]}>
                    Sin asignar
                  </Text>
                </TouchableOpacity>
                {staffList.length === 0 ? (
                  <Text style={styles.emptyText}>No hay staff registrado</Text>
                ) : (
                  staffList.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.row, staffId === s.id && styles.rowSelected]}
                      onPress={() => {
                        setStaffId(s.id);
                        setStaffExpanded(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.rowText, staffId === s.id && styles.rowTextSelected]}
                      >
                        {formatFullName(s.firstName, s.lastName)}
                      </Text>
                      {staffId === s.id && (
                        <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}
          </>
        )}

        {/* ── Servicio a domicilio (opcional) ── */}
        {petId && deliveryServiceActive && (
          <>
            <LevelSelector
              label="Servicio a domicilio"
              options={[
                { key: "no", label: "No" },
                { key: "si", label: "Sí" },
              ]}
              selected={deliveryEnabled ? "si" : "no"}
              onSelect={(k) => setDeliveryEnabled(k === "si")}
            />
            {deliveryEnabled && (
              <>
                <DeliveryAddressPicker
                  value={deliveryAddress}
                  onChange={setDeliveryAddress}
                  placeholder="Dirección de entrega/recolección"
                />
                {deliveryQuoteData?.active && (
                  <Text style={styles.estimate}>
                    Tarifa domicilio: ${deliveryQuoteData.fee} (
                    {deliveryQuoteData.distanceKm} km)
                  </Text>
                )}
              </>
            )}
          </>
        )}

        {/* ── Total base estimado ── */}
        {petId && grandTotalEstimate != null && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total base</Text>
            <Text style={styles.totalValue}>${grandTotalEstimate.toFixed(2)}</Text>
          </View>
        )}

        {/* ── Anticipo / pago (opcional) ── */}
        {petId && (
          <>
            <Text style={styles.label}>Anticipo acordado (opcional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={COLORS.textDisabled}
              value={depositAgreed}
              onChangeText={setDepositAgreed}
              keyboardType="numeric"
            />

            <Text style={styles.label}>Registrar pago ahora (opcional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="Monto pagado"
              placeholderTextColor={COLORS.textDisabled}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="numeric"
            />
            {payAmount.trim().length > 0 && (
              <LevelSelector
                label="Método de pago"
                options={[
                  { key: "CASH", label: "Efectivo" },
                  { key: "TRANSFER", label: "Transferencia" },
                ]}
                selected={payMethod}
                onSelect={(k) => setPayMethod(k as "CASH" | "TRANSFER")}
              />
            )}
          </>
        )}

        {/* ── Notas ── */}
        {petId && (
          <>
            <Text style={styles.label}>Notas (opcional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Notas internas..."
              placeholderTextColor={COLORS.textDisabled}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitText}>Crear reservación</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  content: { padding: 16, paddingBottom: 32 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 6,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 8,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textPrimary, padding: 0 },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  selectedText: { flex: 1, fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  changeText: { fontSize: 13, fontWeight: "600", color: COLORS.primary },
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  collapseHeaderText: { fontSize: 14, color: COLORS.textPrimary },
  listBox: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: "hidden",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  rowSelected: { backgroundColor: COLORS.bgSection },
  rowText: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  rowSubText: { fontSize: 12, color: COLORS.textTertiary, marginTop: 1 },
  rowTextSelected: { fontWeight: "700", color: COLORS.primary },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 10,
    backgroundColor: COLORS.bgSection,
  },
  avatarPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textTertiary,
    padding: 14,
    textAlign: "center",
  },
  dateRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 6,
    alignItems: "flex-start",
  },
  dateCol: { flex: 1 },
  dateBtn: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pickerWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  dateBtnLabel: { fontSize: 12, color: COLORS.textTertiary, marginBottom: 2 },
  dateBtnValue: { fontSize: 14, fontWeight: "600", color: COLORS.textPrimary },
  estimate: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  estimateWarn: { fontSize: 13, color: COLORS.errorText, marginTop: 8 },
  hint: { fontSize: 12, color: COLORS.textTertiary, marginTop: 4, marginBottom: 2 },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
  },
  totalLabel: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  totalValue: { fontSize: 16, fontWeight: "800", color: COLORS.primary },
  notesInput: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    minHeight: 70,
    textAlignVertical: "top",
    marginBottom: 6,
  },
  amountInput: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: 16, fontWeight: "700" },
});
