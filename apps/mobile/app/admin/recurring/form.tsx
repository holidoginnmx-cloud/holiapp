import { COLORS } from "@/constants/colors";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { DateTimeField } from "@/components/DateTimeField";
import { SelectField } from "@/components/SelectField";
import { SwitchRow } from "@/components/SwitchRow";
import { LevelSelector } from "@/components/LevelSelector";
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from "@/components/KeyboardDoneBar";
import { ErrorState } from "@/components/ErrorState";
import { DeliveryAddressPicker, type SelectedAddress } from "@/components/DeliveryAddressPicker";
import { VIAJES_DOMICILIO, VIAJE_HINT_EQUIPO } from "@/constants/delivery";
import {
  getAllPets,
  getUsers,
  getRecurringBooking,
  createRecurringBooking,
  updateRecurringBooking,
  type DeliveryTrip,
  type RecurringBookingBody,
  type RecurringSaveResult,
} from "@/lib/api";
import { formatFullName, formatName, formatTimeHHmm, hotelTodayYMD } from "@/lib/format";
import { coincideBusqueda, filtrarPorBusqueda } from "@/lib/search";
import { alertaDeError } from "@/lib/errorAlert";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { RECURRING_QUERY_KEY, dateToYMD, ymdToDate } from "@/lib/recurringUi";
import {
  addDaysYMD,
  nextOccurrences,
  recurringBookingIssues,
  shortDateLabelES,
  weekdayOfDateYMD,
  describeRecurrence,
} from "@holidoginn/shared/src/recurrence";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

type Tipo = "BATH" | "DAYCARE";

// Lunes primero: así lo piensa el equipo. Valor = numeración de JS (0 = domingo).
const DIAS: { value: number; label: string }[] = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "Mi" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 0, label: "D" },
];

const FRECUENCIAS = [
  { key: "1", label: "Cada semana" },
  { key: "2", label: "Cada 2" },
  { key: "3", label: "Cada 3" },
  { key: "4", label: "Cada 4" },
];

const ANTICIPACION = [
  { key: "3", label: "3 días antes" },
  { key: "7", label: "1 semana antes" },
  { key: "14", label: "2 semanas antes" },
];

const SIN_STAFF = "__sin_staff__";

/** Primer día ≥ `from` que cae en alguno de `weekdays`. */
function nextMatching(from: string, weekdays: number[]): string {
  if (weekdays.length === 0) return from;
  for (let i = 0; i < 7; i++) {
    const d = addDaysYMD(from, i);
    if (weekdays.includes(weekdayOfDateYMD(d))) return d;
  }
  return from;
}

function hhmmToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function RecurringBookingForm() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const esAdmin = useAuthStore((s) => s.role) === "ADMIN";
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);

  const [tipo, setTipo] = useState<Tipo>("BATH");
  const [clientSearch, setClientSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [petIds, setPetIds] = useState<string[]>([]);
  const [intervalWeeks, setIntervalWeeks] = useState(2);
  const [weekdays, setWeekdays] = useState<number[]>([5]);
  const [anchor, setAnchor] = useState<string>(() => nextMatching(addDaysYMD(hotelTodayYMD(), 1), [5]));
  const [endDate, setEndDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("10:00");
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [inTime, setInTime] = useState("09:00");
  const [outTime, setOutTime] = useState("13:00");
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryTrip, setDeliveryTrip] = useState<DeliveryTrip>("ROUND_TRIP");
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);
  const [chargeDelivery, setChargeDelivery] = useState(false);
  const [price, setPrice] = useState("");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [leadDays, setLeadDays] = useState(7);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: pets, isLoading: petsLoading, isError: petsError, error: petsErr, refetch } = useQuery({
    queryKey: ["admin", "all-pets"],
    queryFn: getAllPets,
  });
  const { data: allUsers } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
    enabled: esAdmin,
  });
  const staffList = useMemo(() => (allUsers ?? []).filter((u) => u.role === "STAFF"), [allUsers]);

  // ── Edición: precargar UNA vez ───────────────────────────────────────────
  const { data: serie, isLoading: serieLoading } = useQuery({
    queryKey: [...RECURRING_QUERY_KEY, id],
    queryFn: () => getRecurringBooking(id!),
    enabled: editing,
  });
  const hidratado = useRef(false);
  useEffect(() => {
    if (!serie || hidratado.current) return;
    hidratado.current = true;
    setTipo(serie.reservationType);
    setOwnerId(serie.ownerId);
    // Solo las activas: una mascota dada de baja no sale en la lista (no se
    // podría desmarcar) y el API rechazaría el guardado por ella.
    setPetIds(serie.pets.filter((p) => p.isActive).map((p) => p.id));
    setIntervalWeeks(serie.intervalWeeks);
    setWeekdays(serie.weekdays);
    setAnchor(serie.anchorDate);
    setEndDate(serie.endDate);
    if (serie.startTime) setStartTime(serie.startTime);
    setDeslanado(serie.deslanado);
    setCorte(serie.corte);
    if (serie.checkInTime) setInTime(serie.checkInTime);
    if (serie.checkOutTime) setOutTime(serie.checkOutTime);
    setDeliveryEnabled(serie.homeDelivery);
    setDeliveryTrip(serie.homeDeliveryTrip);
    if (serie.homeDeliveryAddress && serie.homeDeliveryLat != null && serie.homeDeliveryLng != null) {
      setDeliveryAddress({
        address: serie.homeDeliveryAddress,
        lat: serie.homeDeliveryLat,
        lng: serie.homeDeliveryLng,
        ...(serie.homeDeliveryPlaceId ? { placeId: serie.homeDeliveryPlaceId } : {}),
      });
    }
    setChargeDelivery(serie.chargeDelivery);
    if (serie.totalAmountOverride != null) setPrice(String(serie.totalAmountOverride));
    setStaffId(serie.staffId);
    setLeadDays(serie.leadDays);
    setNotes(serie.internalNotes ?? "");
  }, [serie]);

  // ── Clientes (derivados de las mascotas, igual que "Crear reservación") ──
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
        entry = { id: p.owner.id, name: formatFullName(p.owner.firstName, p.owner.lastName), photoUrl: null, pets: [] };
        map.set(p.owner.id, entry);
      }
      entry.pets.push({ id: p.id, name: formatName(p.name), photoUrl: p.photoUrl ?? null });
      if (!entry.photoUrl && p.photoUrl) entry.photoUrl = p.photoUrl;
    }
    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!clientSearch.trim()) return [];
    return filtrarPorBusqueda(list, clientSearch, (o) => ({ textos: [o.name, ...o.pets.map((p) => p.name)] })).map(
      (o) => ({
        ...o,
        matchedPet: o.pets.find((p) => coincideBusqueda(clientSearch, { textos: [p.name] })) ?? null,
      })
    );
  }, [pets, clientSearch]);

  const ownerPets = useMemo(() => (pets ?? []).filter((p) => p.owner?.id === ownerId), [pets, ownerId]);
  const selectedOwnerName = useMemo(() => {
    const o = (pets ?? []).find((p) => p.owner?.id === ownerId)?.owner;
    if (o) return formatFullName(o.firstName, o.lastName);
    return serie ? formatFullName(serie.owner.firstName, serie.owner.lastName) : "";
  }, [pets, ownerId, serie]);

  const selectOwner = (oid: string, matchedPetId?: string) => {
    setOwnerId(oid);
    setClientSearch("");
    // Con todos sus perros de una vez: el caso típico (Gurrola) es el grupo completo.
    const suyos = (pets ?? []).filter((p) => p.owner?.id === oid).map((p) => p.id);
    setPetIds(matchedPetId && suyos.length > 3 ? [matchedPetId] : suyos);
  };

  const togglePet = (pid: string) =>
    setPetIds((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]));

  const toggleDay = (d: number) => {
    const next = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d];
    setWeekdays(next);
    // Que la primera fecha siga siendo uno de los días elegidos.
    if (next.length > 0 && !next.includes(weekdayOfDateYMD(anchor))) {
      setAnchor(nextMatching(anchor, next));
    }
  };

  const onPickAnchor = (d: Date) => {
    const ymd = dateToYMD(d);
    setAnchor(ymd);
    // Con un solo día por semana, la fecha elegida MANDA: elegir el viernes 27
    // es decir "los viernes".
    const wd = weekdayOfDateYMD(ymd);
    if (weekdays.length <= 1 && !weekdays.includes(wd)) setWeekdays([wd]);
  };

  const issues = recurringBookingIssues({
    reservationType: tipo,
    weekdays,
    anchorDate: anchor,
    endDate,
    startTime: tipo === "BATH" ? startTime : null,
    checkInTime: tipo === "DAYCARE" ? inTime : null,
    checkOutTime: tipo === "DAYCARE" ? outTime : null,
  });

  const preview = useMemo(
    () =>
      weekdays.length === 0
        ? []
        : nextOccurrences(
            { intervalWeeks, weekdays, anchorDate: anchor, endDate, skipDates: serie?.skipDates ?? [] },
            hotelTodayYMD(),
            4
          ),
    [intervalWeeks, weekdays, anchor, endDate, serie?.skipDates]
  );

  const handleSubmit = async () => {
    if (!ownerId) return Alert.alert("Falta el cliente", "Busca y elige al cliente.");
    if (petIds.length === 0) return Alert.alert("Faltan las mascotas", "Elige al menos una mascota.");
    if (weekdays.length === 0) return Alert.alert("Faltan los días", "Elige qué día(s) de la semana.");
    if (issues.length > 0) return Alert.alert("Revisa la cita", issues[0]);
    if (deliveryEnabled && !deliveryAddress) {
      return Alert.alert("Falta la dirección", "Escribe la dirección donde se recoge al perro.");
    }
    const precio = price.trim() ? Number(price.replace(/[^0-9.]/g, "")) : null;
    if (precio != null && !Number.isFinite(precio)) return Alert.alert("Precio inválido", "Revisa el precio pactado.");

    const body: RecurringBookingBody = {
      reservationType: tipo,
      ownerId,
      petIds,
      intervalWeeks,
      weekdays,
      anchorDate: anchor,
      endDate,
      startTime: tipo === "BATH" ? startTime : null,
      deslanado: tipo === "BATH" ? deslanado : false,
      corte: tipo === "BATH" ? corte : false,
      checkInTime: tipo === "DAYCARE" ? inTime : null,
      checkOutTime: tipo === "DAYCARE" ? outTime : null,
      homeDelivery:
        deliveryEnabled && deliveryAddress
          ? {
              address: deliveryAddress.address,
              lat: deliveryAddress.lat,
              lng: deliveryAddress.lng,
              ...(deliveryAddress.placeId ? { placeId: deliveryAddress.placeId } : {}),
              trip: deliveryTrip,
            }
          : null,
      chargeDelivery,
      ...(esAdmin ? { totalAmountOverride: precio } : {}),
      internalNotes: notes.trim() || null,
      ...(esAdmin ? { staffId } : {}),
      leadDays,
    };

    setSubmitting(true);
    try {
      let res: RecurringSaveResult;
      if (editing && id) {
        const { ownerId: _o, ...patch } = body;
        res = await updateRecurringBooking(id, patch);
      } else {
        res = await createRecurringBooking(body);
      }
      await queryClient.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
      if (res.generated.length > 0) invalidateReservationScope(queryClient);

      const creadas = res.generated.map((g) => shortDateLabelES(g.date));
      const proxima = res.upcoming.find((u) => !u.reservationId);
      const mensaje = [
        creadas.length > 0 ? `Ya quedó en la agenda: ${creadas.join(", ")}.` : null,
        proxima
          ? `La siguiente (${shortDateLabelES(proxima.date)}) se agenda sola ${res.leadDays} días antes.`
          : null,
        res.failed.length > 0
          ? `⚠️ No se pudo agendar: ${res.failed.map((f) => `${shortDateLabelES(f.date)} (${f.error})`).join(", ")}.`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      Alert.alert(editing ? "Cambios guardados" : "Cita recurrente creada", mensaje || undefined);
      if (editing) router.back();
      else router.replace(`/admin/recurring/${res.id}` as any);
    } catch (e) {
      alertaDeError(e, { titulo: "No se pudo guardar" });
    } finally {
      setSubmitting(false);
    }
  };

  if (petsLoading || (editing && serieLoading)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (petsError) return <ErrorState error={petsErr} onRetry={refetch} />;

  const resumen = weekdays.length > 0 ? describeRecurrence({ intervalWeeks, weekdays }) : null;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: editing ? "Editar cita recurrente" : "Nueva cita recurrente" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <View style={styles.banner}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.primary} />
            <Text style={styles.bannerText}>
              Los cambios aplican a las visitas que todavía no están en la agenda. Las que ya están se
              cambian desde la reserva.
            </Text>
          </View>
        ) : (
          <LevelSelector
            label="Servicio"
            options={[
              { key: "BATH", label: "Baño" },
              { key: "DAYCARE", label: "Guardería" },
            ]}
            selected={tipo}
            onSelect={(k) => setTipo(k as Tipo)}
          />
        )}

        {/* ── Cliente ── */}
        <Text style={styles.label}>Cliente</Text>
        {ownerId && (editing || !clientSearch.trim()) ? (
          <TouchableOpacity
            style={styles.selectedRow}
            onPress={() => {
              if (editing) return;
              setOwnerId(null);
              setPetIds([]);
            }}
            activeOpacity={editing ? 1 : 0.7}
          >
            <Ionicons name="person-circle" size={20} color={COLORS.primary} />
            <Text style={styles.selectedText}>{selectedOwnerName}</Text>
            {!editing && <Text style={styles.changeText}>Cambiar</Text>}
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
            </View>
            {clientSearch.trim().length > 0 && (
              <View style={styles.listBox}>
                {owners.length === 0 ? (
                  <Text style={styles.emptyText}>Sin coincidencias</Text>
                ) : (
                  owners.slice(0, 20).map((o) => {
                    const avatarUrl = o.matchedPet?.photoUrl ?? o.photoUrl;
                    return (
                      <TouchableOpacity
                        key={o.id}
                        style={styles.row}
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
                          <Text style={styles.rowText}>{o.name}</Text>
                          <Text style={styles.rowSubText}>🐾 {o.pets.map((p) => p.name).join(", ")}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}
          </>
        )}

        {/* ── Mascotas ── */}
        {ownerId && (
          <>
            <Text style={styles.label}>Mascotas{petIds.length > 1 ? ` (${petIds.length})` : ""}</Text>
            <View style={styles.listBox}>
              {ownerPets.length === 0 ? (
                <Text style={styles.emptyText}>Este cliente no tiene mascotas activas</Text>
              ) : (
                ownerPets.map((p) => {
                  const sel = petIds.includes(p.id);
                  const orden = sel && petIds.length > 1 ? `${petIds.indexOf(p.id) + 1}. ` : "";
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.row, sel && styles.rowSelected]}
                      onPress={() => togglePet(p.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.rowText, sel && styles.rowTextSelected]}>
                        {orden}
                        {formatName(p.name)}
                      </Text>
                      <Ionicons
                        name={sel ? "checkmark-circle" : "ellipse-outline"}
                        size={18}
                        color={sel ? COLORS.primary : COLORS.borderLight}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
            {tipo === "BATH" && petIds.length > 1 && (
              <Text style={styles.hint}>Se bañan uno tras otro, en este orden, desde la hora de la cita.</Text>
            )}
          </>
        )}

        {/* ── Cuándo ── */}
        {petIds.length > 0 && (
          <>
            <LevelSelector
              label="¿Cada cuánto?"
              options={FRECUENCIAS}
              selected={String(intervalWeeks)}
              onSelect={(k) => setIntervalWeeks(Number(k))}
            />

            <Text style={styles.label}>¿Qué día?</Text>
            <View style={styles.daysRow}>
              {DIAS.map((d) => {
                const sel = weekdays.includes(d.value);
                return (
                  <TouchableOpacity
                    key={d.value}
                    style={[styles.dayChip, sel && styles.dayChipSel]}
                    onPress={() => toggleDay(d.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dayText, sel && styles.dayTextSel]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Primera visita"
                  mode="date"
                  text={shortDateLabelES(anchor)}
                  pickerValue={ymdToDate(anchor)}
                  minimumDate={editing ? undefined : ymdToDate(hotelTodayYMD())}
                  onChange={onPickAnchor}
                />
              </View>
              {tipo === "BATH" ? (
                <View style={styles.dateCol}>
                  <DateTimeField
                    label="Hora"
                    mode="time"
                    text={formatTimeHHmm(startTime)}
                    pickerValue={hhmmToDate(startTime)}
                    onChange={(d) => setStartTime(dateToHHmm(d))}
                  />
                </View>
              ) : null}
            </View>
            {tipo === "DAYCARE" && (
              <View style={styles.dateRow}>
                <View style={styles.dateCol}>
                  <DateTimeField
                    label="Entrada"
                    mode="time"
                    text={formatTimeHHmm(inTime)}
                    pickerValue={hhmmToDate(inTime)}
                    onChange={(d) => setInTime(dateToHHmm(d))}
                  />
                </View>
                <View style={styles.dateCol}>
                  <DateTimeField
                    label="Salida"
                    mode="time"
                    text={formatTimeHHmm(outTime)}
                    pickerValue={hhmmToDate(outTime)}
                    onChange={(d) => setOutTime(dateToHHmm(d))}
                  />
                </View>
              </View>
            )}

            {issues.length > 0 ? (
              <Text style={styles.warn}>{issues[0]}</Text>
            ) : preview.length > 0 ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewTitle}>🔁 {resumen}</Text>
                <Text style={styles.previewText}>
                  Próximas: {preview.map(shortDateLabelES).join(" · ")}
                </Text>
              </View>
            ) : null}

            {tipo === "BATH" && (
              <>
                <SwitchRow label="Deslanado" value={deslanado} onValueChange={setDeslanado} />
                <SwitchRow label="Corte" value={corte} onValueChange={setCorte} />
              </>
            )}

            {/* ── Domicilio ── */}
            <SwitchRow
              label="Vamos por ellos (domicilio)"
              hint="El equipo verá en la agenda que hay que ir a su casa."
              value={deliveryEnabled}
              onValueChange={setDeliveryEnabled}
            />
            {deliveryEnabled && (
              <>
                <LevelSelector
                  label="Viaje"
                  options={VIAJES_DOMICILIO}
                  selected={deliveryTrip}
                  onSelect={(k) => setDeliveryTrip(k as DeliveryTrip)}
                />
                <Text style={styles.hint}>{VIAJE_HINT_EQUIPO[deliveryTrip]}</Text>
                <DeliveryAddressPicker
                  value={deliveryAddress}
                  onChange={setDeliveryAddress}
                  placeholder="Dirección donde se recoge"
                />
                <SwitchRow
                  label="Cobrar el domicilio"
                  hint={
                    chargeDelivery
                      ? "Se suma la tarifa de domicilio a cada visita."
                      : "Apagado: el viaje queda registrado sin costo ($0)."
                  }
                  value={chargeDelivery}
                  onValueChange={setChargeDelivery}
                  nested
                />
              </>
            )}

            {/* ── Solo ADMIN: precio y responsable ── */}
            {esAdmin && (
              <>
                <Text style={styles.label}>Precio pactado por visita (opcional)</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Vacío = precio normal por talla"
                  placeholderTextColor={COLORS.textDisabled}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_DONE_ID}
                  value={price}
                  onChangeText={setPrice}
                />
                {petIds.length > 1 && price.trim() !== "" && (
                  <Text style={styles.hint}>Es el total de los {petIds.length} perros; se reparte entre ellos.</Text>
                )}
                {staffList.length > 0 && (
                  <SelectField
                    title="Responsable"
                    placeholder="Sin asignar"
                    options={[
                      { key: SIN_STAFF, label: "Sin asignar" },
                      ...staffList.map((u) => ({ key: u.id, label: formatFullName(u.firstName, u.lastName) })),
                    ]}
                    selectedKey={staffId ?? SIN_STAFF}
                    onSelect={(k) => setStaffId(k === SIN_STAFF ? null : k)}
                  />
                )}
              </>
            )}

            <LevelSelector
              label="¿Cuándo se agenda cada visita?"
              options={ANTICIPACION}
              selected={String(leadDays)}
              onSelect={(k) => setLeadDays(Number(k))}
            />
            <Text style={styles.hint}>
              Ese día aparece en la agenda y al cliente le llega el aviso de su cita.
            </Text>

            <DateTimeField
              label="Termina (opcional)"
              mode="date"
              text={endDate ? shortDateLabelES(endDate) : "Sin fecha de fin"}
              empty={!endDate}
              pickerValue={ymdToDate(endDate ?? addDaysYMD(anchor, 90))}
              minimumDate={ymdToDate(anchor)}
              onChange={(d) => setEndDate(dateToYMD(d))}
              onClear={endDate ? () => setEndDate(null) : undefined}
            />

            <Text style={styles.label}>Nota interna (opcional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Se copia a cada cita. Solo la ve el equipo."
              placeholderTextColor={COLORS.textDisabled}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitText}>{editing ? "Guardar cambios" : "Crear cita recurrente"}</Text>
          )}
        </TouchableOpacity>
      </View>
      <KeyboardDoneBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 32 },
  banner: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  bannerText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: COLORS.textPrimary },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
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
  searchInput: { flex: 1, fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textPrimary, padding: 0 },
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
  selectedText: { flex: 1, fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  changeText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.primary },
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
  rowText: { flex: 1, fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textPrimary },
  rowSubText: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 1 },
  rowTextSelected: { fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  avatar: { width: 28, height: 28, borderRadius: 14, marginRight: 10, backgroundColor: COLORS.bgSection },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  emptyText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    padding: 14,
    textAlign: "center",
  },
  daysRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  dayChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
    alignItems: "center",
  },
  dayChipSel: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textSecondary },
  dayTextSel: { color: COLORS.white },
  dateRow: { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "flex-start" },
  dateCol: { flex: 1 },
  previewBox: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 10,
    gap: 4,
  },
  previewTitle: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  previewText: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textPrimary },
  warn: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: COLORS.errorText, marginTop: 4, marginBottom: 10 },
  hint: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 4, marginBottom: 8 },
  notesInput: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  submitBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
