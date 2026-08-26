import { COLORS } from "@/constants/colors";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { DateTimeField } from "@/components/DateTimeField";
import { SelectField } from "@/components/SelectField";
import { SwitchRow } from "@/components/SwitchRow";
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
  getBathSlots,
  getQuote,
  type PetWithOwner,
} from "@/lib/api";
import {
  formatName,
  formatFullName,
  formatWeekdayDayShort,
  formatTime,
  formatTimeHHmm,
  formatCurrency,
} from "@/lib/format";
import {
  sizeFromWeight,
  computeDaycareHours,
  DAYCARE_OPEN_HOUR,
  DAYCARE_CLOSE_HOUR,
} from "@holidoginn/shared/src/pricing";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import {
  useBathConflict,
  localDayKey,
  formatDurationMin,
} from "@/hooks/useBathConflict";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

type ReservationType = "STAY" | "BATH" | "DAYCARE";

// Clave de la opción "sin staff" en el selector (staffId real es null).
const SIN_STAFF = "__sin_staff__";

// Date → "HH:mm" (hora local del dispositivo, que corre en hora del hotel).
function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "HH:mm" → Date sobre un día base, para alimentar al reloj nativo.
function fromHHmm(hhmm: string, base: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
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
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // Esta pantalla la usan admin y staff: el staff registra al perro que acaba
  // de llegar. Lo que cambia entre ambos es el selector de responsable, que
  // sale de GET /users (solo-admin) y no le sirve a quien está en el mostrador.
  const esAdmin = useAuthStore((s) => s.role) === "ADMIN";
  // Se llegó aquí desde una cotización: el formulario se precarga con lo que ya
  // se le prometió al cliente. Ver la hidratación más abajo.
  const { quoteId } = useLocalSearchParams<{ quoteId?: string }>();

  const [reservationType, setReservationType] = useState<ReservationType>("STAY");
  const [clientSearch, setClientSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  // Multi-perro: se crea UNA reserva por mascota con groupId compartido.
  const [petIds, setPetIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // STAY
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);
  // Hora estimada de llegada/recogida ("HH:mm"). Opcional: a diferencia de la
  // guardería arrancan en null y la reserva se puede guardar sin ellas.
  const [stayInTime, setStayInTime] = useState<string | null>(null);
  const [stayOutTime, setStayOutTime] = useState<string | null>(null);
  // Cuarto elegido por mascota (petId → roomId). Cada perro del grupo puede ir
  // a un cuarto distinto: no siempre caben juntos ni comparten talla.
  const [roomByPet, setRoomByPet] = useState<Record<string, string>>({});

  // BATH
  const [appointmentAt, setAppointmentAt] = useState<Date | null>(null);
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  // "Agendar de todos modos": permite guardar una cita que se encima o que
  // termina después de que sale la estilista. La operación real tiene
  // excepciones, pero quedan marcadas para verlas distinto en la agenda.
  const [forceSchedule, setForceSchedule] = useState(false);

  // "Registrar de todos modos": el perro ya está en la casa y nadie alcanzó a
  // capturar la reserva (llegó sin avisar, o entró de noche). Mismo trato que
  // los baños que ya ocurrieron: el picker no pone tope, el aviso + este switch
  // son el gate. Sin esto la salida era inventar fechas y pedirle a alguien que
  // las corrigiera después, que es como se ensucian ocupación e ingresos.
  const [forceBackdate, setForceBackdate] = useState(false);

  // DAYCARE (guardería): día + horas estimadas ("HH:mm").
  const [dcDate, setDcDate] = useState<Date | null>(null);
  const [dcInTime, setDcInTime] = useState("09:00");
  const [dcOutTime, setDcOutTime] = useState("13:00");
  // Total sugerido editable para cualquier servicio (precio pactado con el
  // cliente). Vacío = usar el cálculo automático del servidor.
  const [totalOverride, setTotalOverride] = useState("");

  // Baño como complemento de un hospedaje (STAY)
  const [stayBathEnabled, setStayBathEnabled] = useState(false);
  const [stayDeslanado, setStayDeslanado] = useState(false);
  const [stayCorte, setStayCorte] = useState(false);

  // Medicamento (STAY)
  const [medEnabled, setMedEnabled] = useState(false);
  const [medNotes, setMedNotes] = useState("");

  // Asignar staff
  const [staffId, setStaffId] = useState<string | null>(null);

  // Servicio a domicilio
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);

  // Anticipo ya cobrado al crear la reserva. Un solo monto: se guarda como
  // anticipo acordado de la reserva Y se registra como pago real (lo normal es
  // que el cliente ya lo haya pagado al apartar). Antes eran dos campos y el
  // "anticipo acordado" no generaba ningún pago: el dinero no aparecía en el
  // admin web, que cuenta lo pagado como la suma de los pagos.
  const [depositAgreed, setDepositAgreed] = useState("");
  const [payMethod, setPayMethod] = useState<"CASH" | "TRANSFER">("CASH");

  // Cotización de origen (si la hay): folio y total prometido, para el banner y
  // para el switch de "respetar el precio cotizado".
  const [desdeCotizacion, setDesdeCotizacion] = useState<{
    folio: number;
    total: number;
    isExpired: boolean;
    // Conceptos que el total ya cobra pero que esta pantalla no crea: hay que
    // agregarlos después desde el detalle, SIN volver a cobrarlos.
    pendientes: { label: string; amount: number }[];
  } | null>(null);
  const [respetarPrecio, setRespetarPrecio] = useState(true);

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

  // ── Prefill desde una cotización ──────────────────────────────────────────
  // La cotización no aparta cuarto ni horario, así que aquí se precarga TODO lo
  // demás y el operador solo decide lo que faltaba. La hidratación corre UNA
  // sola vez: después de eso el formulario es suyo y no se debe pisar lo que
  // vaya escribiendo.
  const { data: cotizacion } = useQuery({
    queryKey: ["quotes", "detail", quoteId],
    queryFn: () => getQuote(quoteId!),
    enabled: Boolean(quoteId),
  });
  const yaHidratado = useRef(false);

  useEffect(() => {
    if (!cotizacion || yaHidratado.current) return;
    const p = cotizacion.prefill;
    yaHidratado.current = true;

    setReservationType(p.reservationType);
    if (p.ownerId) setOwnerId(p.ownerId);
    if (p.petIds.length > 0) setPetIds(p.petIds);

    // Las fechas vienen como "YYYY-MM-DD" y se reconstruyen en hora LOCAL: un
    // new Date("2026-09-01") lo interpreta como UTC y en Hermosillo mostraría
    // el 31 de agosto.
    const desdeYMD = (ymd: string | null): Date | null => {
      if (!ymd) return null;
      const [y, m, d] = ymd.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    if (p.checkIn) setCheckIn(desdeYMD(p.checkIn));
    if (p.checkOut) setCheckOut(desdeYMD(p.checkOut));
    // En BATH se deja SIN hora a propósito: la cotización no aparta agenda, y
    // precargar el día a medianoche se vería como una cita ya elegida a las
    // 12:00 am. El operador elige el horario real de los que sí caben.
    if (p.reservationType === "DAYCARE") {
      if (p.date) setDcDate(desdeYMD(p.date));
      if (p.checkInTime) setDcInTime(p.checkInTime);
      if (p.checkOutTime) setDcOutTime(p.checkOutTime);
    }

    if (p.bath) {
      if (p.reservationType === "BATH") {
        setDeslanado(p.bath.deslanado);
        setCorte(p.bath.corte);
      } else {
        setStayBathEnabled(true);
        setStayDeslanado(p.bath.deslanado);
        setStayCorte(p.bath.corte);
      }
    }
    if (p.hasMedication) {
      setMedEnabled(true);
      if (p.medicationNotes) setMedNotes(p.medicationNotes);
    }
    if (p.homeDelivery) {
      setDeliveryEnabled(true);
      setDeliveryAddress({
        address: p.homeDelivery.address,
        lat: p.homeDelivery.lat,
        lng: p.homeDelivery.lng,
        placeId: p.homeDelivery.placeId ?? undefined,
      });
    }
    // El campo de "nota interna" de esta pantalla escribe en internalNotes; se
    // precarga con el aviso de qué incluye el total, para que quien atienda el
    // día del servicio no re-cobre lo que ya está pagado.
    if (p.internalNotesSugeridas) setNotes(p.internalNotesSugeridas);
    else if (p.notes) setNotes(p.notes);
    // El precio prometido manda por defecto: si las tarifas subieron entre
    // cotizar y cerrar, se cobra lo que se prometió.
    setTotalOverride(String(p.quotedTotal));
    setDesdeCotizacion({
      folio: p.folio,
      total: p.quotedTotal,
      isExpired: p.isExpired,
      pendientes: p.pendientes ?? [],
    });
  }, [cotizacion]);

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

  const selectedPets: PetWithOwner[] = useMemo(
    () => petIds.map((id) => (pets ?? []).find((p) => p.id === id)!).filter(Boolean),
    [pets, petIds],
  );

  // Todos los cuartos activos: cada mascota elige el suyo, filtrado por SU
  // talla (sizeAllowed). Antes se pedían filtrados por el tamaño más grande
  // del grupo porque todas compartían cuarto.
  const { data: rooms, isLoading: roomsLoading } = useQuery({
    queryKey: ["admin", "rooms"],
    queryFn: () => getRooms(),
    enabled: reservationType === "STAY",
  });

  // TODOS los cuartos activos, marcando cuáles no admiten la talla de la
  // mascota. Antes se filtraban y desaparecían de la lista sin explicación: el
  // dueño veía "12 cuartos" teniendo 18 y no había forma de saber por qué.
  const roomsForPet = useCallback(
    (pet: PetWithOwner) => {
      const size = sizeFromWeight(pet.weight);
      return (rooms ?? []).map((r) => ({
        room: r,
        admiteTalla: r.sizeAllowed.includes(size),
        size,
      }));
    },
    [rooms],
  );

  const { data: bathVariants } = useQuery({
    queryKey: ["admin", "bath-variants"],
    queryFn: getBathVariants,
    enabled: reservationType === "BATH" || stayBathEnabled,
  });

  // Disponibilidad de la agenda de estética para el día elegido. La duración
  // depende del servicio (talla × corte × deslanado), así que se recalcula al
  // cambiar la mascota o los extras.
  const bathDateYMD = useMemo(
    () => (appointmentAt ? localDayKey(appointmentAt) : null),
    [appointmentAt],
  );
  const { data: bathSlots } = useQuery({
    queryKey: ["admin", "bath-slots", bathDateYMD, petIds[0], deslanado, corte],
    queryFn: () =>
      getBathSlots(bathDateYMD!, { petId: petIds[0], deslanado, corte }),
    enabled: reservationType === "BATH" && !!bathDateYMD && petIds.length > 0,
  });

  const bathConflict = useBathConflict(bathSlots, appointmentAt);

  // Tarifa por hora de guardería (para sugerir el total). Se recalcula server-side.
  const { data: lodgingPricing } = useQuery({
    queryKey: ["admin", "lodging-pricing"],
    queryFn: getAdminLodgingPricing,
    enabled: reservationType === "DAYCARE",
  });
  const daycareHourPrice = lodgingPricing?.daycareHourPrice ?? 0;

  // Estimado de guardería: horas (ceil, mín 1) × tarifa única × mascotas.
  const daycareEstimate = useMemo(() => {
    if (reservationType !== "DAYCARE") return null;
    const hours = computeDaycareHours(dcInTime, dcOutTime);
    if (hours <= 0 || daycareHourPrice <= 0 || selectedPets.length === 0)
      return null;
    return { hours, total: hours * daycareHourPrice * selectedPets.length };
  }, [reservationType, dcInTime, dcOutTime, daycareHourPrice, selectedPets.length]);

  // Staff (rol STAFF) para asignación opcional. Solo admin: GET /users es
  // la lista completa de clientes y sigue siendo solo-admin.
  const { data: allUsers } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
    enabled: esAdmin,
  });
  const staffList = useMemo(
    () => (allUsers ?? []).filter((u) => u.role === "STAFF"),
    [allUsers],
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
    if (
      reservationType !== "STAY" ||
      !checkIn ||
      !checkOut ||
      selectedPets.length === 0
    )
      return null;
    const days = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) / 86_400_000,
    );
    if (days <= 0) return null;
    // Suma por mascota (la tarifa por día depende del peso de cada una).
    const total = selectedPets.reduce(
      (sum, p) => sum + ((p.weight ?? 0) >= 20 ? 450 : 350) * days,
      0,
    );
    return { days, total };
  }, [reservationType, checkIn, checkOut, selectedPets]);

  // Suma de la variante de baño de CADA mascota (talla propia); null si a
  // alguna le falta variante configurada.
  const sumBathVariants = (dl: boolean, ct: boolean): number | null => {
    if (!bathVariants || selectedPets.length === 0) return null;
    let total = 0;
    for (const p of selectedPets) {
      const size = sizeFromWeight(p.weight);
      const variant = bathVariants.find(
        (v) => v.petSize === size && v.deslanado === dl && v.corte === ct,
      );
      if (!variant) return null;
      total += variant.price;
    }
    return total;
  };

  const bathEstimate = useMemo(() => {
    if (reservationType !== "BATH") return null;
    return sumBathVariants(deslanado, corte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationType, selectedPets, bathVariants, deslanado, corte]);

  const stayBathPrice = useMemo(() => {
    if (!stayBathEnabled) return null;
    return sumBathVariants(stayDeslanado, stayCorte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayBathEnabled, selectedPets, bathVariants, stayDeslanado, stayCorte]);

  const deliveryFeeEstimate =
    deliveryEnabled && deliveryQuoteData?.active ? deliveryQuoteData.fee : 0;

  // Sugerido base por tipo de servicio (sin domicilio ni total manual).
  const suggestedBase = useMemo(() => {
    if (selectedPets.length === 0) return null;
    if (reservationType === "STAY") {
      if (!stayEstimate) return null;
      const lodging = stayEstimate.total;
      const med = medEnabled ? lodging * 0.1 : 0;
      const bath = stayBathEnabled ? stayBathPrice ?? 0 : 0;
      return lodging + med + bath;
    }
    if (reservationType === "DAYCARE") return daycareEstimate?.total ?? null;
    return bathEstimate;
  }, [
    selectedPets.length,
    reservationType,
    stayEstimate,
    medEnabled,
    stayBathEnabled,
    stayBathPrice,
    bathEstimate,
    daycareEstimate,
  ]);

  // Total base estimado (informativo; el backend recalcula el total real).
  // Si el admin capturó un total manual, ese manda.
  const grandTotalEstimate = useMemo(() => {
    if (selectedPets.length === 0) return null;
    const override = Number(totalOverride);
    // `>= 0`, no `> 0`: un total de $0 es legítimo (baño de cortesía, servicio
    // regalado). Con `> 0` escribir "0" caía en silencio al precio automático.
    const base =
      totalOverride.trim() && Number.isFinite(override) && override >= 0
        ? override
        : suggestedBase;
    if (base == null) return null;
    return base + deliveryFeeEstimate;
  }, [selectedPets.length, totalOverride, suggestedBase, deliveryFeeEstimate]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ¿La reserva se está registrando después de que el perro llegó? `today` está
  // a medianoche, así que esto es "de un día anterior", no "hace un rato".
  const stayBackdated = checkIn != null && checkIn < today;
  const daycareBackdated = dcDate != null && dcDate < today;
  const backdated =
    (reservationType === "STAY" && stayBackdated) ||
    (reservationType === "DAYCARE" && daycareBackdated);

  function selectOwner(id: string, matchedPetId?: string) {
    setOwnerId(id);
    // Si la búsqueda coincidió por mascota, se preselecciona directamente.
    setPetIds(matchedPetId ? [matchedPetId] : []);
    setRoomByPet({});
    setClientSearch(""); // colapsa la lista tras elegir
  }

  // Toggle multi-perro: tocar agrega/quita la mascota de la selección. El
  // cuarto de las demás se conserva (cada mascota tiene el suyo); al quitar
  // una se olvida el suyo.
  function togglePet(id: string) {
    setPetIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
    setRoomByPet((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSubmit() {
    if (!ownerId || petIds.length === 0) {
      Alert.alert("Faltan datos", "Selecciona un cliente y al menos una mascota.");
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

    // Total manual pactado (opcional, cualquier servicio). Con varias
    // mascotas es el total del GRUPO; el server lo reparte entre las filas.
    // `>= 0`, no `> 0`: el server acepta 0 (`nonnegative`) pero aquí se
    // descartaba, así que era imposible crear una reserva de $0 desde el móvil.
    const override = Number(totalOverride);
    const overrideFields =
      totalOverride.trim() && Number.isFinite(override) && override >= 0
        ? { totalAmountOverride: override }
        : {};

    // Campos comunes adicionales. Con una mascota se manda petId (forma
    // clásica); con varias, petIds (el server crea una reserva por mascota).
    const common: Record<string, unknown> = {
      ownerId,
      ...(petIds.length === 1 ? { petId: petIds[0] } : { petIds }),
      // Va a `internalNotes`, no a `notes`: el campo dice "Notas internas..."
      // pero escribía en la nota del cliente, que el dueño ve en su app.
      internalNotes: notes.trim() || null,
      legalAccepted: true,
      ...overrideFields,
      ...(staffId ? { staffId } : {}),
      ...(depositAgreed.trim() ? { depositAgreed: Number(depositAgreed) } : {}),
      // Enlaza la reserva con la cotización que la originó: el servidor la
      // marca CONVERTED. No afecta al cálculo — el precio prometido ya viaja,
      // como cualquier otro, en totalAmountOverride.
      ...(quoteId ? { quoteId } : {}),
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

    // El switch es el gate de lo retroactivo: sin él, un mal tap en el
    // calendario crearía una estancia de la semana pasada sin que nadie lo note.
    if (backdated && !forceBackdate) {
      Alert.alert(
        reservationType === "STAY" ? "La entrada ya pasó" : "Ese día ya pasó",
        "Activa «Registrar de todos modos» para guardarla con esa fecha.",
      );
      return;
    }

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
      // Un cuarto por mascota, en el mismo orden que petIds.
      const sinCuarto = selectedPets.filter((p) => !roomByPet[p.id]);
      if (sinCuarto.length > 0) {
        Alert.alert(
          "Faltan datos",
          selectedPets.length > 1
            ? `Selecciona el cuarto de ${sinCuarto.map((p) => p.name).join(", ")}.`
            : "Selecciona un cuarto.",
        );
        return;
      }
      if (stayBathEnabled && stayBathPrice == null) {
        Alert.alert(
          "Servicio no disponible",
          "No hay una variante de baño configurada para esta combinación.",
        );
        return;
      }
      const roomIds = petIds.map((id) => roomByPet[id]);
      payload = {
        ...common,
        reservationType: "STAY",
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        ...(stayInTime ? { checkInTime: stayInTime } : {}),
        ...(stayOutTime ? { checkOutTime: stayOutTime } : {}),
        // Con una mascota se manda roomId (forma clásica); con varias, roomIds.
        ...(roomIds.length === 1 ? { roomId: roomIds[0] } : { roomIds }),
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
      payload = {
        ...common,
        reservationType: "DAYCARE",
        // La hora del ISO no importa: el server ancla el día a mediodía UTC.
        appointmentAt: dcDate.toISOString(),
        checkInTime: dcInTime,
        checkOutTime: dcOutTime,
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
        ...(forceSchedule ? { scheduleOverride: true } : {}),
      };
    }

    setSubmitting(true);
    try {
      const created = await createReservation(payload);
      // El anticipo se registra como pago real contra la reserva creada.
      // En grupos multi-perro se reparte proporcional al total de cada fila
      // (la última absorbe el residuo) para que ninguna quede desbalanceada.
      const amount = Number(depositAgreed);
      if (depositAgreed.trim() && amount > 0 && created?.id) {
        const groupRows = (
          created as unknown as {
            groupReservations?: { id: string; totalAmount: string | number }[];
          }
        ).groupReservations;
        if (groupRows && groupRows.length > 1) {
          const totals = groupRows.map((r) => Number(r.totalAmount) || 0);
          const grand = totals.reduce((a, b) => a + b, 0);
          let allocated = 0;
          for (let i = 0; i < groupRows.length; i++) {
            const isLast = i === groupRows.length - 1;
            const share = isLast
              ? Number((amount - allocated).toFixed(2))
              : grand > 0
                ? Number(((amount * totals[i]) / grand).toFixed(2))
                : Number((amount / groupRows.length).toFixed(2));
            allocated += share;
            if (share > 0) {
              await registerManualPayment({
                reservationId: groupRows[i].id,
                amount: share,
                method: payMethod,
              });
            }
          }
        } else {
          await registerManualPayment({
            reservationId: created.id,
            amount,
            method: payMethod,
          });
        }
      }
      invalidateReservationScope(queryClient, created?.id);
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
        {/* Viene de una cotización: se recuerda cuánto se prometió y con qué
            folio, para que quien confirma sepa que ese número ya salió. */}
        {desdeCotizacion && (
          <View style={styles.cotizacionBanner}>
            <Ionicons name="document-text" size={16} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cotizacionTexto}>
                Desde la cotización COT-
                {String(desdeCotizacion.folio).padStart(6, "0")} ·{" "}
                {formatCurrency(desdeCotizacion.total)}
              </Text>
              {desdeCotizacion.isExpired && (
                <Text style={styles.cotizacionVencida}>
                  Estaba vencida: revisa el precio antes de confirmar.
                </Text>
              )}
              {desdeCotizacion.pendientes.length > 0 && (
                <Text style={styles.cotizacionPendientes}>
                  Ya cobrado en el total:{" "}
                  {desdeCotizacion.pendientes.map((p) => p.label).join(", ")}.
                  Agrégalo desde el detalle SIN volver a cobrarlo.
                </Text>
              )}
            </View>
          </View>
        )}
        {desdeCotizacion && (
          <SwitchRow
            label="Respetar el precio cotizado"
            hint="Apágalo para recalcular con las tarifas de hoy"
            value={respetarPrecio}
            onValueChange={(v) => {
              setRespetarPrecio(v);
              // El precio prometido vive en el mismo campo de "total pactado"
              // que ya existía: encenderlo lo repone, apagarlo lo vacía para
              // que el servidor recalcule.
              setTotalOverride(v ? String(desdeCotizacion.total) : "");
            }}
          />
        )}

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
            setRoomByPet({});
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
            <Text style={styles.label}>
              Mascotas{petIds.length > 1 ? ` (${petIds.length})` : ""}
            </Text>
            <View style={styles.listBox}>
              {ownerPets.length === 0 ? (
                <Text style={styles.emptyText}>Este cliente no tiene mascotas</Text>
              ) : (
                ownerPets.map((p) => {
                  const isSelected = petIds.includes(p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.row, isSelected && styles.rowSelected]}
                      onPress={() => togglePet(p.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                        {formatName(p.name)} ({p.weight ?? 0} kg)
                      </Text>
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={18}
                        color={isSelected ? COLORS.primary : COLORS.borderLight}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
            {ownerPets.length > 1 && (
              <Text style={styles.hint}>
                Puedes elegir varias: se crea una reserva por mascota, agrupadas.
              </Text>
            )}
          </>
        )}

        {/* ── STAY: fechas + cuarto ── */}
        {petIds.length > 0 && reservationType === "STAY" && (
          <>
            <Text style={styles.label}>Fechas</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Entrada"
                  title="Fecha de entrada"
                  text={formatDate(checkIn)}
                  empty={!checkIn}
                  mode="date"
                  pickerValue={checkIn ?? today}
                  // Sin minimumDate a propósito, igual que la cita de baño: el
                  // equipo registra estancias que ya empezaron. El aviso "ya
                  // pasó" + "Registrar de todos modos" hacen el gate.
                  onChange={(date) => {
                    setCheckIn(date);
                    if (checkOut && date >= checkOut) setCheckOut(null);
                  }}
                />
              </View>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Salida"
                  title="Fecha de salida"
                  text={formatDate(checkOut)}
                  empty={!checkOut}
                  mode="date"
                  pickerValue={checkOut ?? checkIn ?? today}
                  minimumDate={checkIn ?? today}
                  onChange={setCheckOut}
                />
              </View>
            </View>

            {stayBackdated && (
              <>
                <Text style={styles.estimateWarn}>
                  La entrada ya pasó: se registra como llegada retroactiva.
                </Text>
                <SwitchRow
                  label="Registrar de todos modos"
                  value={forceBackdate}
                  onValueChange={setForceBackdate}
                />
              </>
            )}

            <Text style={styles.label}>Horario estimado (opcional)</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Llegada"
                  title="Hora de llegada"
                  testID="admin-create-stay-in-time"
                  text={stayInTime ? formatTimeHHmm(stayInTime) : "Sin definir"}
                  empty={!stayInTime}
                  mode="time"
                  pickerValue={fromHHmm(stayInTime ?? "09:00", today)}
                  onChange={(date) => setStayInTime(toHHmm(date))}
                  onClear={() => setStayInTime(null)}
                />
              </View>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Recogida"
                  title="Hora de recogida"
                  testID="admin-create-stay-out-time"
                  text={stayOutTime ? formatTimeHHmm(stayOutTime) : "Sin definir"}
                  empty={!stayOutTime}
                  mode="time"
                  pickerValue={fromHHmm(stayOutTime ?? "13:00", today)}
                  onChange={(date) => setStayOutTime(toHHmm(date))}
                  onClear={() => setStayOutTime(null)}
                />
              </View>
            </View>
            <Text style={styles.hint}>
              Check-in de 9:00 am a 6:00 pm y check-out de 9:00 am a 1:00 pm.
              Después de la 1:00 pm se considera guardería.
            </Text>

            <Text style={styles.label}>
              {selectedPets.length > 1 ? "Cuarto de cada mascota" : "Cuarto"}
            </Text>
            {roomsLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
            ) : (
              selectedPets.map((pet) => (
                <View key={pet.id}>
                  {selectedPets.length > 1 && (
                    <Text style={styles.petRoomName}>{pet.name}</Text>
                  )}
                  <SelectField
                    title={
                      selectedPets.length > 1
                        ? `Cuarto de ${pet.name}`
                        : "Elegir cuarto"
                    }
                    placeholder="Seleccionar cuarto"
                    emptyText={`No hay cuartos para el tamaño de ${pet.name}`}
                    showCount
                    selectedKey={roomByPet[pet.id] ?? null}
                    options={roomsForPet(pet).map(({ room, admiteTalla, size }) => {
                      // Cuántos otros perros del grupo ya van a este cuarto
                      // (comparten cuarto: es válido, sólo se avisa).
                      const compañeros = selectedPets.filter(
                        (p) => p.id !== pet.id && roomByPet[p.id] === room.id,
                      ).length;
                      return {
                        key: room.id,
                        label: `${room.name} · cap. ${room.capacity}`,
                        disabled: !admiteTalla,
                        hint: !admiteTalla
                          ? `No configurado para talla ${size}`
                          : compañeros > 0
                            ? `Ya con ${compañeros} del grupo`
                            : undefined,
                      };
                    })}
                    onSelect={(roomId) =>
                      setRoomByPet((prev) => ({ ...prev, [pet.id]: roomId }))
                    }
                  />
                </View>
              ))
            )}

            {/* Baño como complemento */}
            <SwitchRow
              label="Incluir baño"
              value={stayBathEnabled}
              onValueChange={setStayBathEnabled}
            />
            {stayBathEnabled && (
              <>
                <SwitchRow
                  label="Deslanado"
                  value={stayDeslanado}
                  onValueChange={setStayDeslanado}
                  nested
                />
                <SwitchRow
                  label="Corte"
                  value={stayCorte}
                  onValueChange={setStayCorte}
                  nested
                />
                {stayBathPrice != null ? (
                  <Text style={styles.estimate}>Baño: ${stayBathPrice}</Text>
                ) : selectedPets.length > 0 ? (
                  <Text style={styles.estimateWarn}>
                    No hay variante de baño para esta combinación
                  </Text>
                ) : null}
              </>
            )}

            {/* Medicamento */}
            <SwitchRow
              label="Medicamento"
              hint="Suma 10% al hospedaje"
              value={medEnabled}
              onValueChange={setMedEnabled}
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
        {petIds.length > 0 && reservationType === "BATH" && (
          <>
            <Text style={styles.label}>Fecha y hora de la cita</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Fecha"
                  title="Fecha de la cita"
                  text={appointmentAt ? formatDate(appointmentAt) : "Seleccionar"}
                  empty={!appointmentAt}
                  mode="date"
                  pickerValue={appointmentAt ?? today}
                  // Sin minimumDate a propósito: el admin registra baños que ya
                  // ocurrieron (backfill). El aviso "ya pasó" + "Agendar de
                  // todos modos" hacen el gate, no el picker.
                  onChange={(date) => {
                    const base = appointmentAt ?? new Date(today);
                    const next = new Date(date);
                    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
                    setAppointmentAt(next);
                  }}
                />
              </View>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Hora"
                  title="Hora de la cita"
                  text={appointmentAt ? formatTime(appointmentAt) : "Seleccionar"}
                  empty={!appointmentAt}
                  mode="time"
                  pickerValue={appointmentAt ?? today}
                  onChange={(date) => {
                    const base = appointmentAt ?? new Date(today);
                    const next = new Date(base);
                    next.setHours(date.getHours(), date.getMinutes(), 0, 0);
                    setAppointmentAt(next);
                  }}
                />
              </View>
            </View>

            <SwitchRow
              label="Deslanado"
              value={deslanado}
              onValueChange={setDeslanado}
            />
            <SwitchRow label="Corte" value={corte} onValueChange={setCorte} />

            {bathSlots?.durationMinutes != null && (
              <Text style={styles.estimate}>
                Toma {formatDurationMin(bathSlots.durationMinutes)}
                {appointmentAt
                  ? ` · termina ${formatTime(
                      new Date(
                        appointmentAt.getTime() + bathSlots.durationMinutes * 60000,
                      ),
                    )}`
                  : ""}
              </Text>
            )}

            {bathConflict && (
              <>
                <Text style={styles.estimateWarn}>{bathConflict}</Text>
                <SwitchRow
                  label="Agendar de todos modos"
                  value={forceSchedule}
                  onValueChange={setForceSchedule}
                />
              </>
            )}

            {bathEstimate != null ? (
              <Text style={styles.estimate}>Precio: ${bathEstimate}</Text>
            ) : selectedPets.length > 0 ? (
              <Text style={styles.estimateWarn}>
                No hay variante configurada para esta combinación
              </Text>
            ) : null}
          </>
        )}

        {/* ── DAYCARE: día + horas estimadas + total ── */}
        {petIds.length > 0 && reservationType === "DAYCARE" && (
          <>
            <Text style={styles.label}>Día de guardería</Text>
            <DateTimeField
              label="Fecha"
              title="Día de guardería"
              text={dcDate ? formatDate(dcDate) : "Seleccionar"}
              empty={!dcDate}
              mode="date"
              pickerValue={dcDate ?? today}
              // Sin minimumDate: la guardería de ayer se cobra hoy si nadie
              // alcanzó a registrarla. Ver `daycareBackdated`.
              onChange={setDcDate}
            />

            {daycareBackdated && (
              <>
                <Text style={styles.estimateWarn}>
                  Ese día ya pasó: se registra como guardería retroactiva.
                </Text>
                <SwitchRow
                  label="Registrar de todos modos"
                  value={forceBackdate}
                  onValueChange={setForceBackdate}
                />
              </>
            )}

            <Text style={styles.label}>Horario estimado</Text>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Entrada"
                  title="Hora de entrada"
                  text={formatTimeHHmm(dcInTime)}
                  mode="time"
                  pickerValue={fromHHmm(dcInTime, today)}
                  onChange={(date) => setDcInTime(toHHmm(date))}
                />
              </View>
              <View style={styles.dateCol}>
                <DateTimeField
                  label="Salida"
                  title="Hora de salida"
                  text={formatTimeHHmm(dcOutTime)}
                  mode="time"
                  pickerValue={fromHHmm(dcOutTime, today)}
                  onChange={(date) => setDcOutTime(toHHmm(date))}
                />
              </View>
            </View>
            <Text style={styles.hint}>
              Horario de guardería: {DAYCARE_OPEN_HOUR}:00 a {DAYCARE_CLOSE_HOUR}:00.
            </Text>

            {daycareEstimate ? (
              <Text style={styles.estimate}>
                Sugerido: {daycareEstimate.hours}{" "}
                {daycareEstimate.hours === 1 ? "hora" : "horas"} ×{" "}
                {formatCurrency(daycareHourPrice)}
                {selectedPets.length > 1
                  ? ` × ${selectedPets.length} mascotas`
                  : ""}{" "}
                = {formatCurrency(daycareEstimate.total)}
              </Text>
            ) : null}
          </>
        )}

        {/* ── Staff (opcional) — solo admin: ver `esAdmin` ── */}
        {petIds.length > 0 && esAdmin && (
          <>
            <Text style={styles.label}>Asignar staff (opcional)</Text>
            <SelectField
              title="Asignar staff"
              placeholder="Sin asignar"
              emptyText="No hay staff registrado"
              selectedKey={staffId ?? SIN_STAFF}
              options={
                staffList.length === 0
                  ? []
                  : [
                      { key: SIN_STAFF, label: "Sin asignar" },
                      ...staffList.map((s) => ({
                        key: s.id,
                        label: formatFullName(s.firstName, s.lastName),
                      })),
                    ]
              }
              onSelect={(k) => setStaffId(k === SIN_STAFF ? null : k)}
            />
          </>
        )}

        {/* ── Servicio a domicilio (opcional) ── */}
        {petIds.length > 0 && deliveryServiceActive && (
          <>
            <SwitchRow
              label="Servicio a domicilio"
              value={deliveryEnabled}
              onValueChange={setDeliveryEnabled}
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

        {/* ── Total a cobrar (editable, cualquier servicio) ── */}
        {petIds.length > 0 && (
          <>
            <Text style={styles.label}>Total a cobrar (editable)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder={
                suggestedBase != null ? String(suggestedBase) : "Total pactado"
              }
              placeholderTextColor={COLORS.textDisabled}
              value={totalOverride}
              onChangeText={setTotalOverride}
              keyboardType="numeric"
            />
            {petIds.length > 1 && (
              <Text style={styles.hint}>
                Es el total del grupo: se reparte entre las reservas de cada
                mascota.
              </Text>
            )}
          </>
        )}

        {/* ── Total base estimado ── */}
        {petIds.length > 0 && grandTotalEstimate != null && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total base</Text>
            <Text style={styles.totalValue}>${grandTotalEstimate.toFixed(2)}</Text>
          </View>
        )}

        {/* ── Anticipo ya pagado (opcional) ── */}
        {petIds.length > 0 && (
          <>
            <Text style={styles.label}>Anticipo pagado (opcional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={COLORS.textDisabled}
              value={depositAgreed}
              onChangeText={setDepositAgreed}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              Monto que el cliente YA pagó al apartar. Se registra como pago de
              la reserva y baja el saldo pendiente.
            </Text>
            {depositAgreed.trim().length > 0 && (
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
            {depositAgreed.trim().length > 0 &&
              grandTotalEstimate != null &&
              Number(depositAgreed) > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Saldo pendiente</Text>
                  <Text style={styles.totalValue}>
                    ${Math.max(0, grandTotalEstimate - Number(depositAgreed)).toFixed(2)}
                  </Text>
                </View>
              )}
          </>
        )}

        {/* ── Notas ── */}
        {petIds.length > 0 && (
          <>
            <Text style={styles.label}>Nota interna (opcional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Solo la ve el equipo, nunca el dueño..."
              placeholderTextColor={COLORS.textDisabled}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </>
        )}
      </ScrollView>

      {/* En iPhone con home indicator esto da 46pt; el piso de 20 es para los
          modelos sin él (iPhone SE, insets.bottom = 0), donde 12pt dejarían el
          botón pegado al borde. */}
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
  // Nombre de la mascota sobre su selector de cuarto (solo en multi-perro).
  petRoomName: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_500Medium",
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
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
    fontFamily: "PlusJakartaSans_400Regular",
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
  estimate: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  estimateWarn: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.errorText, marginTop: 8 },
  hint: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 4, marginBottom: 2 },
  cotizacionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  cotizacionTexto: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  cotizacionVencida: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.errorText,
    marginTop: 2,
  },
  cotizacionPendientes: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.warningText,
    marginTop: 3,
  },
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
  totalLabel: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  totalValue: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
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
    // Barra fija: el botón va inset y despegado del borde inferior (el
    // paddingBottom real lo pone el safe area, inline).
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
