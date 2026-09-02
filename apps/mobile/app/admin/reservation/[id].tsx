import { COLORS } from "@/constants/colors";
import { ErrorState } from "@/components/ErrorState";
import { SelectionListModal } from "@/components/SelectionListModal";
import { useSuccessBanner } from "@/components/SuccessBanner";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import {
  PaymentManualModal,
  type ManualPaymentValues,
} from "@/components/PaymentManualModal";
import { styles } from "@/styles/reservationDetailStyles";
import { useAuthStore } from "@/store/authStore";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Dimensions,
  RefreshControl,
} from "react-native";

const ROOM_LIST_MAX_HEIGHT = Dimensions.get("window").height * 0.45;
import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  getReservationById,
  updateReservationStatus,
  getOwnerChecklists,
  registerManualPayment,
  adminCancelReservation,
  adminAssignStaff,
  adminAssignRoom,
  getUsers,
  getRooms,
  deleteStayUpdate,
  completeStaffBath,
  adminUpdateReservation,
  adminUpdateReservationAddon,
  updateReservationDelivery,
} from "@/lib/api";
import {
  AmountEditModal,
  type AmountEditValues,
} from "@/components/AmountEditModal";
import { ReservationDeliveryModal } from "@/components/ReservationDeliveryModal";
import { VIAJE_ETIQUETA } from "@/constants/delivery";
import { NoteEditModal } from "@/components/NoteEditModal";
import { MediaViewer } from "@/components/MediaViewer";
import { cloudinaryResized, uploadToCloudinary } from "@/lib/cloudinary";
import * as ImagePicker from "expo-image-picker";
import {
  formatName,
  formatCurrency,
  formatDayLongYear,
  formatDayShort as fmtDayShort,
  formatWeekdayShort,
  formatWeekdayDayShort,
  formatDateTimeShort,
  formatTime,
  formatTimeHHmm,
  utcDayKey,
  localDayKey,
} from "@/lib/format";
import { buildReservationBreakdown } from "@holidoginn/shared";
import { computeDaycareHours } from "@holidoginn/shared/src/pricing";
import { LIVE_OPS } from "@/lib/queryOptions";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { invalidateReservationScope } from "@/lib/invalidateReservations";

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  CHECKED_IN: { label: "Hospedado", bg: COLORS.successBg, text: COLORS.successText },
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, text: COLORS.infoText },
  CHECKED_OUT: { label: "Finalizada", bg: COLORS.bgSection, text: COLORS.textTertiary },
  CANCELLED: { label: "Cancelada", bg: COLORS.errorBg, text: COLORS.errorText },
};

function formatDate(date: string | Date): string {
  return formatDayLongYear(date);
}

function formatDayShort(date: string | Date): string {
  return fmtDayShort(date);
}

function formatWeekday(date: string | Date): string {
  return formatWeekdayShort(date);
}

function formatDateTime(date: string | Date): string {
  return formatDateTimeShort(date);
}

// ¿Cuándo cae (o cayó) al banco el dinero de un pago por Stripe? Si el
// depósito ya se concilió (payoutLines → StripePayout) manda su arrivalDate
// exacta; si no, el estimado es stripeAvailableOn: el día en que Stripe libera
// el dinero y el depósito automático diario lo manda al banco.
function stripeDepositLabel(p: {
  method: string;
  payoutLines?: { payout: { arrivalDate: string | Date; status: string } }[];
  stripeAvailableOn?: string | Date | null;
}): string | null {
  if (p.method !== "STRIPE") return null;
  const payout = p.payoutLines?.[0]?.payout;
  if (payout) {
    const fecha = formatDate(payout.arrivalDate);
    if (payout.status === "paid") return `Depositado al banco el ${fecha}`;
    if (payout.status === "failed") return `Depósito al banco fallido (${fecha})`;
    return `Cae al banco el ${fecha}`;
  }
  if (p.stripeAvailableOn) {
    return `Se deposita alrededor del ${formatDate(p.stripeAvailableOn)}`;
  }
  return null;
}

type StatusAction = {
  label: string;
  status: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
};

function getActions(currentStatus: string): StatusAction[] {
  switch (currentStatus) {
    case "CONFIRMED":
      return [
        {
          label: "Check-in",
          status: "CHECKED_IN",
          color: COLORS.successText,
          icon: "log-in",
        },
        {
          label: "Cancelar",
          status: "CANCELLED",
          color: COLORS.errorText,
          icon: "close-circle",
        },
      ];
    case "CHECKED_IN":
      return [
        {
          label: "Check-out",
          status: "CHECKED_OUT",
          color: COLORS.textTertiary,
          icon: "log-out",
        },
      ];
    default:
      return [];
  }
}

export default function AdminReservationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [staffModalVisible, setStaffModalVisible] = useState(false);
  const [roomModalVisible, setRoomModalVisible] = useState(false);
  const [amountModalVisible, setAmountModalVisible] = useState(false);
  const [deliveryModalVisible, setDeliveryModalVisible] = useState(false);
  const [internalNoteModalVisible, setInternalNoteModalVisible] = useState(false);
  const [clientNoteModalVisible, setClientNoteModalVisible] = useState(false);
  // Add-on sobre el que se está actuando (menú de cortesía / editar nota).
  const [addonActionId, setAddonActionId] = useState<string | null>(null);
  const [addonNoteId, setAddonNoteId] = useState<string | null>(null);
  const { banner, showSuccess } = useSuccessBanner();
  // Reabrir una reserva finalizada es corrección de errores: solo admin.
  const isAdminRole = useAuthStore((s) => s.role) === "ADMIN";

  const closePaymentModal = () => setPaymentModalVisible(false);

  // Visor de fotos del baño y mutación para eliminar (optimista: la foto
  // desaparece al confirmar; si el server falla, reaparece).
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const deletePhotoMutation = useOptimisticMutation({
    mutationFn: (updateId: string) => deleteStayUpdate(updateId),
    patches: [
      {
        queryKey: ["reservation", id],
        updater: (old, updateId) => {
          const res = old as { updates?: { id: string }[] };
          if (!res?.updates) return old;
          return { ...res, updates: res.updates.filter((u) => u.id !== updateId) };
        },
      },
    ],
    invalidateKeys: [["reservation", id]],
    errorTitle: "No se pudo eliminar",
  });

  // Marcar baño completado (sube foto + cierra cita).
  const [completingBath, setCompletingBath] = useState(false);

  async function pickBathPhoto(
    source: "camera" | "library",
  ): Promise<string | null> {
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permiso requerido", "Necesitamos acceso a la cámara.");
        return null;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled) return null;
      return result.assets[0].uri;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tus fotos.");
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return null;
    return result.assets[0].uri;
  }

  async function uploadAndCompleteBath(source: "camera" | "library") {
    const uri = await pickBathPhoto(source);
    if (!uri || !id) return;
    setCompletingBath(true);
    try {
      const cloud = await uploadToCloudinary(uri, "baths");
      await completeStaffBath(id, cloud.secure_url);
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-baths"] });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No se pudo completar el baño";
      Alert.alert("Error", msg);
    } finally {
      setCompletingBath(false);
    }
  }

  // Sin foto se pide confirmar: que siga siendo la excepción y no la costumbre.
  async function completeBathWithoutPhoto() {
    if (!id) return;
    setCompletingBath(true);
    try {
      await completeStaffBath(id);
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-baths"] });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No se pudo completar el baño";
      Alert.alert("Error", msg);
    } finally {
      setCompletingBath(false);
    }
  }

  function askCompleteBathWithoutPhoto() {
    Alert.alert(
      "¿Completar sin foto?",
      "Al cliente le encanta recibir la foto de su perro recién bañado. ¿Seguro que quieres completar la cita sin foto?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Completar",
          style: "destructive",
          onPress: () => completeBathWithoutPhoto(),
        },
      ],
    );
  }

  function askCompleteBath() {
    if (!reservation) return;
    Alert.alert(
      "Foto del baño",
      `Sube una foto de ${formatName(reservation.pet?.name ?? "—")} bañado para completar la cita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Tomar foto",
          onPress: () => uploadAndCompleteBath("camera"),
        },
        {
          text: "Elegir foto",
          onPress: () => uploadAndCompleteBath("library"),
        },
        {
          text: "Completar sin foto",
          onPress: () => askCompleteBathWithoutPhoto(),
        },
      ],
    );
  }

  const confirmDeletePhoto = (updateId: string) => {
    Alert.alert(
      "Eliminar foto",
      "¿Estás seguro? Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deletePhotoMutation.mutate(updateId),
        },
      ],
    );
  };

  const {
    data: reservation,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
    ...LIVE_OPS,
  });

  const {
    data: checklists,
    refetch: refetchChecklists,
  } = useQuery({
    queryKey: ["reservation-checklists", id],
    queryFn: () => getOwnerChecklists(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  // Reporte de hoy: el checklist se guarda con la fecha local del equipo
  // truncada a medianoche UTC (ver el formulario), por eso se compara así.
  const todayChecklist = (checklists ?? []).find(
    (c) => utcDayKey(c.date) === localDayKey(),
  );

  // Esta pantalla no tenía NINGUNA forma de refrescarse: ni intervalo, ni foco,
  // ni pull-to-refresh. Un cambio hecho desde otro teléfono no se veía nunca.
  useRefetchOnFocus([["reservation", id]]);

  const refreshAll = () => {
    refetch();
    refetchChecklists();
  };

  // Invalidaciones dirigidas: antes se invalidaba la key ["admin"] completa,
  // lo que refetcheaba TODAS las queries admin (stats, listas, cuartos,
  // cartillas, revenue...) tras cada acción. Ahora el alcance vive en un solo
  // helper para que las listas de staff tampoco queden viejas.
  const invalidateAfterStatusChange = () => {
    invalidateReservationScope(queryClient, id);
  };

  const statusMutation = useMutation({
    mutationFn: ({ newStatus }: { newStatus: string }) =>
      updateReservationStatus(id!, newStatus),
    onSuccess: (_data, { newStatus }) => {
      invalidateAfterStatusChange();
      if (newStatus === "CHECKED_OUT") {
        showSuccess("Check-out realizado correctamente");
      } else if (newStatus === "CHECKED_IN") {
        showSuccess("Check-in realizado correctamente");
      } else if (newStatus === "CONFIRMED") {
        showSuccess("Reserva reabierta");
      }
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => adminCancelReservation(id!),
    onSuccess: (res) => {
      invalidateAfterStatusChange();
      Alert.alert(
        "Reserva cancelada",
        res.awaitingClientChoice
          ? `Notificamos al dueño para que elija cómo recibir su reembolso de ${formatCurrency(res.refundAmount)}.`
          : "La reserva fue cancelada. No había monto pagado por reembolsar."
      );
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const paymentMutation = useMutation({
    mutationFn: (values: ManualPaymentValues) =>
      registerManualPayment({
        reservationId: id!,
        amount: values.amount,
        method: values.method,
        notes: values.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      setPaymentModalVisible(false);
      showSuccess("Pago registrado y notificado al dueño");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Corregir el total. NO usa useOptimisticMutation a propósito: es dinero, y
  // ahí el servidor es la autoridad (isPending + banner, no parche local).
  const totalMutation = useMutation({
    mutationFn: (values: AmountEditValues) =>
      adminUpdateReservation(id!, {
        totalAmount: values.amount,
        priceChangeReason: values.reason,
      }),
    onSuccess: (res) => {
      invalidateAfterStatusChange();
      setAmountModalVisible(false);
      const partes: string[] = [`Total actualizado a ${formatCurrency(res.totalAmount)}`];
      if (res.delta < 0) partes.push("se avisó al dueño");
      if (res.overpaid > 0) {
        partes.push(
          `hay ${formatCurrency(res.overpaid)} a favor por reembolsar o dejar de saldo`,
        );
      }
      showSuccess(`${partes.join(" · ")}.`);
    },
    onError: (e: Error) => Alert.alert("No se pudo cambiar el total", e.message),
  });

  // Servicio a domicilio: la tarifa la recalcula el servidor y mueve el total.
  const deliveryMutation = useMutation({
    mutationFn: (
      payload:
        | { enable: true; address: string; lat: number; lng: number; placeId?: string }
        | { enable: false },
    ) => updateReservationDelivery(id!, payload),
    onSuccess: (res) => {
      invalidateAfterStatusChange();
      setDeliveryModalVisible(false);
      const partes: string[] = [
        res.delta >= 0
          ? `Domicilio actualizado · el total subió ${formatCurrency(res.delta)}`
          : `Domicilio actualizado · el total bajó ${formatCurrency(-res.delta)}`,
        "se avisó al dueño",
      ];
      if (res.overpaid > 0) {
        partes.push(
          `hay ${formatCurrency(res.overpaid)} a favor por reembolsar o dejar de saldo`,
        );
      }
      showSuccess(`${partes.join(" · ")}.`);
    },
    onError: (e: Error) => Alert.alert("No se pudo actualizar el domicilio", e.message),
  });

  // Notas: texto, reversible y sin dinero de por medio → sí van optimistas.
  const internalNoteMutation = useOptimisticMutation({
    mutationFn: (value: string | null) =>
      adminUpdateReservation(id!, { internalNotes: value }),
    patches: [
      {
        queryKey: ["reservation", id],
        updater: (old, value) =>
          old ? { ...(old as object), internalNotes: value } : old,
      },
    ],
    invalidateKeys: [["reservation", id]],
    onSuccess: () => {
      setInternalNoteModalVisible(false);
      showSuccess("Nota interna guardada");
    },
    errorTitle: "No se pudo guardar la nota",
  });

  const clientNoteMutation = useOptimisticMutation({
    mutationFn: (value: string | null) =>
      adminUpdateReservation(id!, { notes: value }),
    patches: [
      {
        queryKey: ["reservation", id],
        updater: (old, value) =>
          old ? { ...(old as object), notes: value } : old,
      },
    ],
    invalidateKeys: [["reservation", id]],
    onSuccess: () => {
      setClientNoteModalVisible(false);
      showSuccess("Nota guardada");
    },
    errorTitle: "No se pudo guardar la nota",
  });

  // Cortesía: toca el total, así que va sin optimismo y con banner.
  const courtesyMutation = useMutation({
    mutationFn: (vars: { addonId: string; isCourtesy: boolean }) =>
      adminUpdateReservationAddon(id!, vars.addonId, {
        isCourtesy: vars.isCourtesy,
      }),
    onSuccess: (res, vars) => {
      invalidateAfterStatusChange();
      setAddonActionId(null);
      const cambio =
        res.delta === 0
          ? "el total no cambió"
          : res.delta < 0
            ? `el total bajó ${formatCurrency(-res.delta)}`
            : `el total subió ${formatCurrency(res.delta)}`;
      showSuccess(
        vars.isCourtesy
          ? `Marcado como cortesía · ${cambio}`
          : `Cortesía quitada · ${cambio}`,
      );
    },
    onError: (e: Error) => Alert.alert("No se pudo actualizar el servicio", e.message),
  });

  const addonNoteMutation = useMutation({
    mutationFn: (vars: { addonId: string; internalNote: string | null }) =>
      adminUpdateReservationAddon(id!, vars.addonId, {
        internalNote: vars.internalNote,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      setAddonNoteId(null);
      showSuccess("Nota del servicio guardada");
    },
    onError: (e: Error) => Alert.alert("No se pudo guardar la nota", e.message),
  });

  // Lista de staff activos — solo se carga cuando se abre el modal.
  const { data: staffList } = useQuery({
    queryKey: ["admin", "users", "staff"],
    queryFn: getUsers,
    enabled: staffModalVisible,
    select: (users) =>
      users.filter((u) => u.role === "STAFF" && u.isActive),
  });

  // Optimista: el staff seleccionado aparece en el detalle en el mismo frame;
  // el modal se cierra al tap y el server confirma en background.
  const assignStaffMutation = useOptimisticMutation({
    mutationFn: (staffId: string) => adminAssignStaff(id!, staffId),
    patches: [
      {
        queryKey: ["reservation", id],
        updater: (old, staffId) => {
          const selected = staffList?.find((s) => s.id === staffId);
          if (!old || !selected) return old;
          return {
            ...(old as object),
            staff: {
              id: selected.id,
              firstName: selected.firstName,
              lastName: selected.lastName,
              avatarUrl: selected.avatarUrl ?? null,
            },
          };
        },
      },
    ],
    invalidateKeys: [["reservation", id]],
    onSuccess: () => showSuccess("Staff asignado y notificado"),
    errorTitle: "No se pudo asignar el staff",
  });

  // Cuartos del tamaño de la mascota — solo se cargan al abrir el modal.
  const { data: roomList } = useQuery({
    queryKey: ["admin", "rooms", reservation?.pet?.size],
    queryFn: () => getRooms(reservation!.pet.size),
    enabled: roomModalVisible && !!reservation?.pet?.size,
  });

  const assignRoomMutation = useOptimisticMutation({
    mutationFn: (roomId: string) => adminAssignRoom(id!, roomId),
    patches: [
      {
        queryKey: ["reservation", id],
        updater: (old, roomId) => {
          const selected = roomList?.find((r) => r.id === roomId);
          if (!old || !selected) return old;
          return { ...(old as object), room: selected };
        },
      },
    ],
    invalidateKeys: [["reservation", id], ["admin", "rooms"]],
    onSuccess: () => showSuccess("Cuarto asignado"),
    errorTitle: "No se pudo asignar el cuarto",
  });

  // Deshacer un check-out equivocado (pasa: querían cancelar o era otro
  // perro). Nadie recibe avisos: el estado simplemente regresa, y desde ahí
  // se puede cancelar por el camino normal o retomar la estancia.
  const handleReopen = () => {
    const buttons = [
      { text: "No, dejarla así", style: "cancel" as const },
      {
        text: "A Confirmada",
        onPress: () => statusMutation.mutate({ newStatus: "CONFIRMED" }),
      },
      ...(!isBath
        ? [
            {
              text: isDaycare ? "A En guardería" : "A Hospedado",
              onPress: () =>
                statusMutation.mutate({ newStatus: "CHECKED_IN" }),
            },
          ]
        : []),
    ];
    Alert.alert(
      "Reabrir reserva",
      "Para corregir un check-out hecho por error. No se avisa al cliente ni se mueve ningún pago: solo regresa el estado. ¿A cuál?",
      buttons,
    );
  };

  const handleStatusChange = (action: StatusAction) => {
    if (action.status === "CANCELLED") {
      Alert.alert(
        "Cancelar reserva",
        "Vamos a marcar la reserva como cancelada y notificaremos al dueño para que elija cómo recibir su reembolso (tarjeta o saldo a favor). ¿Continuar?",
        [
          { text: "No", style: "cancel" },
          {
            text: "Sí, cancelar",
            style: "destructive",
            onPress: () => cancelMutation.mutate(),
          },
        ]
      );
      return;
    }
    Alert.alert(
      action.label,
      `¿Cambiar estado a "${action.label}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: action.label,
          onPress: () => statusMutation.mutate({ newStatus: action.status }),
        },
      ]
    );
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !reservation) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const baseConfig = STATUS_CONFIG[reservation.status] || STATUS_CONFIG.CONFIRMED;
  const actions = getActions(reservation.status);
  const isBath = reservation.reservationType === "BATH";
  const isDaycare = reservation.reservationType === "DAYCARE";
  // Editar fechas solo aplica al hospedaje: baño y guardería son de un día y
  // no tienen checkIn/checkOut que recalcular.
  const canEditDates =
    !isBath &&
    !isDaycare &&
    (reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN");
  // La HORA estimada de llegada/recogida se corrige mientras la estancia siga
  // viva: con el perro adentro es justo cuando el cliente avisa a qué hora pasa
  // por él. Va aparte de canEditDates porque son dos cosas distintas — mover el
  // día recalcula el precio, mover la hora no.
  const canEditTimes =
    !isBath &&
    !isDaycare &&
    (reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN");
  // Reagendar la cita (appointmentAt) solo aplica a baños sueltos confirmados.
  const canEditAppointment = isBath && reservation.status === "CONFIRMED";
  // La guardería se mueve mientras siga viva: con el perro adentro es cuando
  // más se pide ("me lo recogen hasta las 7"). Concluida ya cobró sus horas
  // extra, así que ahí se cierra.
  const canEditDaycareSchedule =
    isDaycare &&
    (reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN");
  // Horas facturables del horario estimado (las mismas que dan el precio).
  const daycareHours =
    isDaycare && reservation.checkInTime && reservation.checkOutTime
      ? computeDaycareHours(reservation.checkInTime, reservation.checkOutTime)
      : 0;
  // El domicilio se puede tocar mientras la reserva siga viva (el equipo también
  // con la estancia en curso).
  const canEditDelivery =
    reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN";
  // Decimal serializado: llega como string desde la API.
  const deliveryFee = Number(reservation.homeDeliveryFee ?? 0);
  const bathAddon = reservation.addons?.find(
    (a) => a.variant?.serviceType?.code === "BATH",
  );
  const bathExtras: string[] = [];
  if (bathAddon?.variant?.deslanado) bathExtras.push("Deslanado");
  if (bathAddon?.variant?.corte) bathExtras.push("Corte");

  // Total que se muestra en la card de info. Para baños, suma los extras
  // (Deslanado/Corte) ya definidos por el staff a la base de la reserva.
  const extrasSum = (reservation.addons ?? []).reduce((sum, a) => {
    const d = a.extraDeslanadoPrice ? Number(a.extraDeslanadoPrice) : 0;
    const c = a.extraCortePrice ? Number(a.extraCortePrice) : 0;
    if (d > 0 || c > 0) return sum + d + c;
    return sum + (a.extraPrice ? Number(a.extraPrice) : 0);
  }, 0);
  const displayedTotal = isBath
    ? Number(reservation.totalAmount) + extrasSum
    : Number(reservation.totalAmount);

  // Menú del servicio seleccionado. Se arma aquí (y no en el render del modal)
  // porque necesita el addon vivo de la reserva ya cargada.
  const selectedAddon = (reservation.addons ?? []).find(
    (a) => a.id === addonActionId,
  );
  const addonActions: {
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  }[] = selectedAddon
    ? [
        selectedAddon.isCourtesy
          ? {
              key: "courtesy-off",
              label: "Quitar cortesía (se vuelve a cobrar)",
              icon: "cash-outline" as const,
              onPress: () =>
                courtesyMutation.mutate({
                  addonId: selectedAddon.id,
                  isCourtesy: false,
                }),
            }
          : {
              key: "courtesy-on",
              label: "Marcar como cortesía (no se cobra)",
              icon: "gift-outline" as const,
              onPress: () =>
                courtesyMutation.mutate({
                  addonId: selectedAddon.id,
                  isCourtesy: true,
                }),
            },
        {
          key: "note",
          label: selectedAddon.internalNote ? "Editar nota" : "Agregar nota",
          icon: "create-outline" as const,
          onPress: () => {
            setAddonNoteId(selectedAddon.id);
            setAddonActionId(null);
          },
        },
      ]
    : [];

  // Staff que completó el baño. La fuente buena es `completedBy` del addon; el
  // StayUpdate con caption de baño queda como respaldo para las citas
  // completadas antes de que existiera esa columna.
  const bathCompletedUpdate = isBath
    ? reservation.updates.find(
        (u) =>
          u.staff &&
          (u.caption?.toLowerCase().includes("baño") ?? false),
      ) ??
      // Fallback: si no hay caption, usar el update más reciente con foto.
      reservation.updates.find((u) => u.staff)
    : null;
  const bathStaff = bathAddon?.completedBy ?? bathCompletedUpdate?.staff ?? null;
  // Ya se ejecutó el servicio (con o sin foto).
  const bathDone = isBath && !!bathAddon?.completedAt;
  // Un baño hecho al que solo le falta el cobro sigue en CONFIRMED (para poder
  // cobrarlo al entregar) y se veía igual que uno pendiente: se marca en ámbar.
  const config =
    bathDone &&
    reservation.status !== "CHECKED_OUT" &&
    reservation.status !== "CANCELLED"
      ? {
          label: "Baño listo · por cobrar",
          bg: COLORS.warningBg,
          text: COLORS.warningText,
        }
      : baseConfig;

  const SIZE_LABELS: Record<string, string> = {
    XS: "Extra pequeño",
    S: "Pequeño",
    M: "Mediano",
    L: "Grande",
    XL: "Extra grande",
  };
  const petMetaParts: string[] = [];
  if (reservation.pet?.size) {
    petMetaParts.push(
      `Talla ${SIZE_LABELS[reservation.pet.size] ?? reservation.pet.size}`,
    );
  }
  if (reservation.pet?.weight) {
    petMetaParts.push(`${reservation.pet.weight} kg`);
  }
  if (reservation.pet?.breed) {
    petMetaParts.push(reservation.pet.breed);
  }

  return (
    <>
    <Stack.Screen
      options={{
        title:
          reservation.reservationType === "BATH"
            ? "Detalle del baño"
            : reservation.reservationType === "DAYCARE"
              ? "Detalle de guardería"
              : "Detalle de reservación",
      }}
    />
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refreshAll}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerLeft}
          activeOpacity={0.7}
          disabled={!reservation.pet?.id}
          onPress={() => router.push(`/pet/${reservation.pet!.id}` as any)}
          testID="admin-reservation-pet-link"
        >
          {reservation.pet?.photoUrl ? (
            <Image
              source={{ uri: reservation.pet.photoUrl }}
              style={styles.petAvatar}
            />
          ) : (
            <View style={[styles.petAvatar, styles.petAvatarFallback]}>
              <Ionicons name="paw" size={22} color={COLORS.primary} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.petName} numberOfLines={1}>
              {formatName(reservation.pet?.name ?? "—")}
            </Text>
            <Text style={styles.ownerName} numberOfLines={1}>
              {formatName(reservation.owner?.firstName ?? "")} {formatName(reservation.owner?.lastName ?? "")}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <Text style={[styles.badgeText, { color: config.text }]}>
            {config.label}
          </Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.card}>
        {/* Bath hero — cita + variante + datos relevantes para el baño */}
        {isBath && (
          <View style={styles.bathHeroWrap}>
            {/* Tocable para reagendar la cita mientras siga confirmada. */}
            <TouchableOpacity
              style={styles.bathHero}
              activeOpacity={0.7}
              disabled={!canEditAppointment}
              onPress={() =>
                router.push(`/admin/reservation/edit-appointment?id=${id}` as any)
              }
              testID="admin-reservation-edit-appointment"
            >
              <View style={styles.bathBadge}>
                <Ionicons name="water" size={14} color={COLORS.primary} />
                <Text style={styles.bathBadgeText}>Baño</Text>
              </View>
              {reservation.appointmentAt && (
                <View style={styles.bathInfoRow}>
                  <Text style={styles.bathDay}>
                    {formatDayShort(reservation.appointmentAt)}
                  </Text>
                  <Text style={styles.bathTime}>
                    {formatTime(reservation.appointmentAt)}
                  </Text>
                  {canEditAppointment && (
                    <Ionicons name="pencil" size={12} color={COLORS.primary} />
                  )}
                </View>
              )}
            </TouchableOpacity>

            {bathExtras.length > 0 && (
              <View style={styles.bathChipsRow}>
                {bathExtras.map((e) => (
                  <View key={e} style={styles.bathExtraChip}>
                    <Ionicons name="cut" size={11} color={COLORS.primary} />
                    <Text style={styles.bathExtraChipText}>{e}</Text>
                  </View>
                ))}
              </View>
            )}

            {petMetaParts.length > 0 && (
              <View style={styles.petMetaStrip}>
                <Ionicons name="paw-outline" size={13} color={COLORS.textTertiary} />
                <Text style={styles.petMetaText} numberOfLines={1}>
                  {petMetaParts.join(" · ")}
                </Text>
              </View>
            )}

            {(bathStaff || bathDone) && (
              <View style={styles.bathStaffStrip}>
                <Ionicons
                  name="ribbon-outline"
                  size={14}
                  color={COLORS.primary}
                />
                <Text style={styles.bathStaffText}>
                  {bathStaff ? (
                    <>
                      Bañó:{" "}
                      <Text style={styles.bathStaffName}>
                        {formatName(bathStaff.firstName)}{" "}
                        {formatName(bathStaff.lastName)}
                      </Text>
                    </>
                  ) : (
                    // Citas viejas completadas sin registro de quién lo hizo.
                    "Baño completado"
                  )}
                </Text>
                {(bathCompletedUpdate?.createdAt ?? bathAddon?.completedAt) && (
                  <Text style={styles.bathStaffDate}>
                    {" · "}
                    {formatDateTime(
                      bathCompletedUpdate?.createdAt ?? bathAddon!.completedAt!,
                    )}
                  </Text>
                )}
              </View>
            )}

            {reservation.pet?.notes ? (
              <View style={styles.petNotesBox}>
                <Ionicons
                  name="information-circle-outline"
                  size={14}
                  color={COLORS.warningText}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.petNotesLabel}>Notas de la mascota</Text>
                  <Text style={styles.petNotesText}>
                    {reservation.pet.notes}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* Daycare hero — día + entrada → salida con las horas al centro.
            Antes la guardería no mostraba NI el día NI el horario aquí (el
            hero de fechas se salta las reservas sin checkIn/checkOut), así que
            no había dónde verlo ni cómo corregirlo desde la app. */}
        {isDaycare && (
          <TouchableOpacity
            style={styles.daycareHeroWrap}
            activeOpacity={0.7}
            disabled={!canEditDaycareSchedule}
            onPress={() =>
              router.push(
                `/admin/reservation/edit-daycare-schedule?id=${id}` as any,
              )
            }
            testID="admin-reservation-edit-daycare-schedule"
          >
            <View style={styles.daycareDayRow}>
              <Ionicons
                name="calendar-outline"
                size={13}
                color={COLORS.textTertiary}
              />
              <Text style={styles.daycareDayText}>
                {reservation.appointmentAt
                  ? formatWeekdayDayShort(reservation.appointmentAt, {
                      timeZone: "UTC",
                    })
                  : "Sin día"}
              </Text>
            </View>

            <View style={styles.dateHero}>
              <View style={styles.datePill}>
                <Text style={styles.datePillLabel}>ENTRADA</Text>
                <Text style={styles.daycareTime}>
                  {reservation.checkInTime
                    ? formatTimeHHmm(reservation.checkInTime)
                    : "—"}
                </Text>
              </View>

              <View style={styles.dateConnector}>
                <View style={styles.connectorLine} />
                <View style={styles.nightsBadge}>
                  <Ionicons name="time" size={12} color={COLORS.primary} />
                  <Text style={styles.nightsBadgeText}>
                    {daycareHours > 0
                      ? `${daycareHours} ${daycareHours === 1 ? "hora" : "horas"}`
                      : "Sin horario"}
                  </Text>
                  {canEditDaycareSchedule && (
                    <Ionicons name="pencil" size={11} color={COLORS.primary} />
                  )}
                </View>
                <View style={styles.connectorLine} />
              </View>

              <View style={styles.datePill}>
                <Text style={styles.datePillLabel}>SALIDA</Text>
                <Text style={styles.daycareTime}>
                  {reservation.checkOutTime
                    ? formatTimeHHmm(reservation.checkOutTime)
                    : "—"}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Date hero — entrada → salida con noches al centro. El DÍA y la HORA
            se editan por separado: tocar una pill abre el horario (lo que el
            equipo cambia a diario, cuando el cliente avisa a qué hora llega o
            pasa por su perro) y el badge de noches lleva a mover las fechas. */}
        {!isBath && reservation.checkIn && reservation.checkOut && (
          <View style={styles.dateHero}>
            <TouchableOpacity
              style={styles.datePill}
              activeOpacity={0.7}
              disabled={!canEditTimes}
              onPress={() =>
                router.push(`/admin/reservation/edit-times?id=${id}` as any)
              }
              testID="admin-reservation-edit-checkin-time"
            >
              <Text style={styles.datePillLabel}>ENTRADA</Text>
              <Text style={styles.datePillDay}>
                {fmtDayShort(reservation.checkIn, { timeZone: "UTC" })}
              </Text>
              <Text style={styles.datePillSub}>
                {formatWeekdayShort(reservation.checkIn, { timeZone: "UTC" })}
              </Text>
              {reservation.checkInTime ? (
                <Text style={styles.datePillTime}>
                  {formatTimeHHmm(reservation.checkInTime)}
                </Text>
              ) : (
                canEditTimes && (
                  <Text style={styles.datePillTimeEmpty}>Sin hora</Text>
                )
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dateConnector}
              activeOpacity={0.7}
              disabled={!canEditDates}
              onPress={() =>
                router.push(`/admin/reservation/edit-dates?id=${id}` as any)
              }
              testID="admin-reservation-edit-dates"
            >
              <View style={styles.connectorLine} />
              <View style={styles.nightsBadge}>
                <Ionicons name="moon" size={12} color={COLORS.primary} />
                <Text style={styles.nightsBadgeText}>
                  {reservation.totalDays}{" "}
                  {reservation.totalDays === 1 ? "noche" : "noches"}
                </Text>
                {canEditDates && (
                  <Ionicons name="pencil" size={11} color={COLORS.primary} />
                )}
              </View>
              <View style={styles.connectorLine} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.datePill}
              activeOpacity={0.7}
              disabled={!canEditTimes}
              onPress={() =>
                router.push(`/admin/reservation/edit-times?id=${id}` as any)
              }
              testID="admin-reservation-edit-checkout-time"
            >
              <Text style={styles.datePillLabel}>SALIDA</Text>
              <Text style={styles.datePillDay}>
                {fmtDayShort(reservation.checkOut, { timeZone: "UTC" })}
              </Text>
              <Text style={styles.datePillSub}>
                {formatWeekdayShort(reservation.checkOut, { timeZone: "UTC" })}
              </Text>
              {reservation.checkOutTime ? (
                <Text style={styles.datePillTime}>
                  {formatTimeHHmm(reservation.checkOutTime)}
                </Text>
              ) : (
                canEditTimes && (
                  <Text style={styles.datePillTimeEmpty}>Sin hora</Text>
                )
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Cuarto + Staff lado a lado (sólo hospedajes). En guardería el perro
            pasa el día, no duerme: el cuarto nunca se asigna y salía siempre
            como "Por asignar". */}
        {!isBath && (
        <View style={styles.metaRow}>
          {!isDaycare && (
          <>
          <TouchableOpacity
            style={styles.metaItem}
            onPress={() => setRoomModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.metaIconWrap}>
              <Ionicons
                name="bed-outline"
                size={16}
                color={COLORS.primary}
              />
            </View>
            <Text style={styles.metaLabel}>Cuarto</Text>
            {reservation.room ? (
              <View style={styles.metaValueRow}>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {reservation.room.name}
                </Text>
                <Ionicons name="pencil" size={11} color={COLORS.primary} />
              </View>
            ) : (
              <View style={styles.metaValueRow}>
                <Text style={[styles.metaValue, styles.unassigned]}>
                  Por asignar
                </Text>
                <Ionicons name="add-circle" size={13} color={COLORS.primary} />
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.metaDivider} />
          </>
          )}

          <TouchableOpacity
            style={styles.metaItem}
            onPress={() => setStaffModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.metaIconWrap}>
              <Ionicons
                name="person-outline"
                size={16}
                color={COLORS.primary}
              />
            </View>
            <Text style={styles.metaLabel}>Staff</Text>
            {reservation.staff ? (
              <View style={styles.metaValueRow}>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {formatName(reservation.staff.firstName)}
                </Text>
                <Ionicons name="pencil" size={11} color={COLORS.primary} />
              </View>
            ) : (
              <View style={styles.metaValueRow}>
                <Text style={[styles.metaValue, styles.unassigned]}>
                  Sin asignar
                </Text>
                <Ionicons name="add-circle" size={13} color={COLORS.primary} />
              </View>
            )}
          </TouchableOpacity>
        </View>
        )}

        {/* Servicio a domicilio — antes solo se podía capturar al crear la
            reserva; si el cliente lo pedía después, no había dónde anotarlo. */}
        {(deliveryFee > 0 || reservation.homeDelivery || canEditDelivery) && (
          <TouchableOpacity
            style={styles.deliveryRow}
            onPress={() => canEditDelivery && setDeliveryModalVisible(true)}
            disabled={!canEditDelivery}
            activeOpacity={0.7}
            testID="admin-reservation-edit-delivery"
          >
            <View style={styles.metaIconWrap}>
              <Ionicons name="car-outline" size={16} color={COLORS.primary} />
            </View>
            <View style={styles.deliveryTexts}>
              {/* El viaje va en el TÍTULO: si dice solo "Servicio a domicilio",
                  nadie sabe que hay que hacer el segundo viaje de un redondo. */}
              <Text style={styles.deliveryLabel}>
                Servicio a domicilio
                {reservation.homeDelivery
                  ? ` · ${VIAJE_ETIQUETA[reservation.homeDeliveryTrip ?? "PICKUP"]}`
                  : ""}
              </Text>
              {reservation.homeDelivery ? (
                <Text style={styles.deliveryValue} numberOfLines={2}>
                  {reservation.homeDeliveryAddress ?? "Dirección no registrada"}
                  {deliveryFee > 0 ? ` · ${formatCurrency(deliveryFee)}` : ""}
                </Text>
              ) : (
                <Text style={styles.deliveryEmpty}>Agregar servicio a domicilio</Text>
              )}
            </View>
            {canEditDelivery && (
              <Ionicons
                name={reservation.homeDelivery ? "pencil" : "add-circle"}
                size={reservation.homeDelivery ? 12 : 15}
                color={COLORS.primary}
              />
            )}
          </TouchableOpacity>
        )}

        {/* Desglose del cobro: hospedaje × noches, medicamento, servicios,
            descuento, domicilio. El cálculo vive en @holidoginn/shared para que
            el equipo y el cliente vean exactamente lo mismo; antes estaba
            inline aquí y solo existía en estancias con `lodgingAmount`, así que
            baños y guarderías se quedaban sin él. Si el total se editó después,
            la diferencia sale como "Ajuste del equipo". */}
        {(() => {
          const { rows } = buildReservationBreakdown(reservation as any, {
            formatMoney: formatCurrency,
          });
          if (rows.length < 2) return null;
          return (
            <View style={styles.breakdownBox}>
              <Text style={styles.breakdownTitle}>Desglose del cobro</Text>
              {rows.map((r) => (
                <View key={r.key} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    {r.label}
                    {r.isCourtesy ? " · Cortesía" : ""}
                  </Text>
                  <Text
                    style={[
                      styles.breakdownValue,
                      (r.negative || r.isCourtesy) && styles.breakdownNegative,
                    ]}
                  >
                    {r.isCourtesy
                      ? "Gratis"
                      : `${r.negative ? "−" : ""}${formatCurrency(r.amount)}`}
                  </Text>
                </View>
              ))}
            </View>
          );
        })()}

        {/* Total — editable: una reserva capturada sin el descuento no tenía
            forma de corregirse. */}
        <TouchableOpacity
          style={styles.totalFooter}
          onPress={() => setAmountModalVisible(true)}
          activeOpacity={0.7}
          testID="admin-reservation-edit-total"
        >
          <Text style={styles.totalLabel}>Total</Text>
          <View style={styles.metaValueRow}>
            <Text style={styles.totalAmount}>
              {formatCurrency(displayedTotal)}
            </Text>
            <Ionicons name="pencil" size={13} color={COLORS.primary} />
          </View>
        </TouchableOpacity>

        {/* Nota interna: SIEMPRE presente. Antes el bloque solo existía si la
            reserva ya tenía notas, así que en las que se crearon sin ellas no
            había ni dónde tocar para agregarlas. */}
        <TouchableOpacity
          style={styles.notesBox}
          onPress={() => setInternalNoteModalVisible(true)}
          activeOpacity={0.7}
          testID="admin-reservation-edit-internal-note"
        >
          <Ionicons name="lock-closed-outline" size={14} color={COLORS.notesText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.notesLabel}>Nota interna (solo el equipo)</Text>
            {reservation.internalNotes ? (
              <Text style={styles.notesText}>{reservation.internalNotes}</Text>
            ) : (
              <Text style={[styles.notesText, styles.unassigned]}>
                Agregar nota interna
              </Text>
            )}
          </View>
          <Ionicons
            name={reservation.internalNotes ? "pencil" : "add-circle"}
            size={14}
            color={COLORS.primary}
          />
        </TouchableOpacity>

        {/* Nota del cliente: solo si escribió algo al reservar. */}
        {reservation.notes && (
          <TouchableOpacity
            style={styles.notesBox}
            onPress={() => setClientNoteModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="document-text-outline"
              size={14}
              color={COLORS.notesText}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.notesLabel}>Nota del cliente</Text>
              <Text style={styles.notesText}>{reservation.notes}</Text>
            </View>
            <Ionicons name="pencil" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Fotos del baño — sólo baños, sólo imágenes (no videos). */}
      {isBath &&
        (() => {
          const photos = reservation.updates.filter(
            (u) => u.mediaType === "image" && !!u.mediaUrl,
          );
          if (photos.length === 0) return null;
          return (
            <View style={styles.sectionCard}>
              <View style={styles.sectionCardHeader}>
                <Text style={styles.sectionCardTitle}>Fotos del baño</Text>
                <View style={styles.countChip}>
                  <Text style={styles.countChipText}>{photos.length}</Text>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photosRow}
              >
                {photos.map((u, idx) => (
                  <View key={u.id} style={styles.photoTile}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => {
                        setPhotoViewerIndex(idx);
                        setPhotoViewerVisible(true);
                      }}
                    >
                      <Image
                        source={{
                          uri: cloudinaryResized(u.mediaUrl, 280, "fill"),
                        }}
                        style={styles.photoImage}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.photoDeleteBtn}
                      onPress={() => confirmDeletePhoto(u.id)}
                      disabled={deletePhotoMutation.isPending}
                      hitSlop={6}
                      testID={`bath-photo-delete-${u.id}`}
                    >
                      <Ionicons name="trash" size={14} color={COLORS.white} />
                    </TouchableOpacity>
                    {u.staff ? (
                      <Text style={styles.photoCaption} numberOfLines={1}>
                        {formatName(u.staff.firstName)}{" "}
                        {formatName(u.staff.lastName)}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
              <Text style={styles.photoHint}>
                El dueño ve estas fotos. Elimina la que no cumpla con la
                calidad esperada.
              </Text>

              <MediaViewer
                items={
                  photoViewerVisible
                    ? photos.map((u) => ({
                        url: u.mediaUrl,
                        type: "image" as const,
                        caption: u.staff
                          ? `${formatName(u.staff.firstName)} ${formatName(u.staff.lastName)}`
                          : null,
                      }))
                    : null
                }
                index={photoViewerIndex}
                title={formatName(reservation.pet?.name ?? "Foto del baño")}
                onClose={() => setPhotoViewerVisible(false)}
              />
            </View>
          );
        })()}

      {/* Servicios contratados — sólo hospedajes (en baños el servicio es la
          reserva misma y ya aparece en el hero). */}
      {!isBath && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>Servicios contratados</Text>
            <TouchableOpacity
              style={styles.metaValueRow}
              onPress={() =>
                router.push(`/admin/reservation/add-addon?id=${id}` as any)
              }
              activeOpacity={0.7}
              testID="admin-reservation-add-addon"
            >
              <Text style={styles.addAddonText}>Agregar</Text>
              <Ionicons name="add-circle" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          {(reservation.addons ?? []).length === 0 && (
            <Text style={styles.addonEmpty}>
              Sin servicios adicionales. Usa "Agregar" para sumar un baño
              (también de cortesía) o un desparasitante.
            </Text>
          )}
          {(reservation.addons ?? []).map((addon, idx) => {
            const extras: string[] = [];
            if (addon.variant?.deslanado) extras.push("Deslanado");
            if (addon.variant?.corte) extras.push("Corte");
            const label =
              extras.length > 0
                ? `${addon.variant?.serviceType?.name ?? "—"} · ${extras.join(" + ")}`
                : addon.variant?.serviceType?.name ?? "—";
            const code = addon.variant?.serviceType?.code;
            const icon: keyof typeof Ionicons.glyphMap =
              code === "BATH" ? "water" : "sparkles";
            const isInBooking = addon.paidWith === "BOOKING";
            const isLastAddon = idx === (reservation.addons?.length ?? 0) - 1;
            return (
              <TouchableOpacity
                key={addon.id}
                style={[styles.addonRow, isLastAddon && styles.lastRow]}
                onPress={() => setAddonActionId(addon.id)}
                activeOpacity={0.7}
                testID={`admin-reservation-addon-${addon.id}`}
              >
                <View style={styles.addonIconWrap}>
                  <Ionicons name={icon} size={18} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addonLabel}>{label}</Text>
                  <View style={styles.addonMetaRow}>
                    {addon.isCourtesy ? (
                      <View style={[styles.metaPill, styles.metaPillCourtesy]}>
                        <Text
                          style={[
                            styles.metaPillText,
                            { color: COLORS.warningText },
                          ]}
                        >
                          Cortesía
                        </Text>
                      </View>
                    ) : (
                      <View
                        style={[
                          styles.metaPill,
                          isInBooking ? styles.metaPillSuccess : styles.metaPillInfo,
                        ]}
                      >
                        <Text
                          style={[
                            styles.metaPillText,
                            isInBooking
                              ? { color: COLORS.successText }
                              : { color: COLORS.infoText },
                          ]}
                        >
                          {isInBooking ? "En reserva" : "Después"}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.addonDate}>
                      {formatDateTime(addon.createdAt)}
                    </Text>
                  </View>
                  {addon.internalNote ? (
                    <Text style={styles.addonNote} numberOfLines={2}>
                      {addon.internalNote}
                    </Text>
                  ) : null}
                </View>
                {/* En cortesía el precio de catálogo va tachado: así se ve qué
                    se regaló sin tener que abrir nada. */}
                <Text
                  style={[
                    styles.addonPrice,
                    addon.isCourtesy && styles.addonPriceCourtesy,
                  ]}
                >
                  {formatCurrency(addon.unitPrice)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Payments */}
      <View style={styles.sectionCard}>
        {(() => {
          const extraStripeIdsForCount = new Set(
            (reservation.addons ?? [])
              .map((a) => a.extraStripePaymentIntentId)
              .filter(Boolean) as string[],
          );
          const visiblePaymentsCount = isBath
            ? reservation.payments.filter(
                (p) =>
                  !(p.notes && /^Extras/i.test(p.notes)) &&
                  !(
                    p.stripePaymentIntentId &&
                    extraStripeIdsForCount.has(p.stripePaymentIntentId)
                  ),
              ).length
            : reservation.payments.length;
          return (
            <View style={styles.sectionCardHeader}>
              <Text style={styles.sectionCardTitle}>Pagos</Text>
              <View style={styles.countChip}>
                <Text style={styles.countChipText}>
                  {visiblePaymentsCount}
                </Text>
              </View>
            </View>
          );
        })()}

        {/* Extras del baño (Deslanado / Corte cobrados post-servicio). */}
        {isBath &&
          (() => {
            const extraRows: {
              key: string;
              label: string;
              price: number;
              status: "PAID" | "PENDING_PAYMENT" | "PAY_ON_PICKUP";
              method: "CASH" | "TRANSFER" | "STRIPE" | null;
              paidAt: string | null;
            }[] = [];

            for (const a of reservation.addons ?? []) {
              if (!a.extraPaymentStatus) continue;
              const status = a.extraPaymentStatus;
              // Derivar método del pago vinculado.
              let method: "CASH" | "TRANSFER" | "STRIPE" | null = null;
              if (status === "PAID") {
                // 1) Si el addon tiene PaymentIntent de Stripe, fue tarjeta.
                if (a.extraStripePaymentIntentId) {
                  method = "STRIPE";
                } else {
                  // 2) Buscar Payment con notes de extras (varios formatos
                  //    usados por la API: "Extras (CASH)", "Extras de baño (...)").
                  const extrasPayment = reservation.payments.find(
                    (p) => p.notes != null && /^Extras/i.test(p.notes),
                  );
                  if (extrasPayment) {
                    method = extrasPayment.method as any;
                  } else if (a.extraPaidAt) {
                    // 3) Fallback: el Payment PAID más cercano en tiempo a extraPaidAt.
                    const target = new Date(a.extraPaidAt).getTime();
                    const close = reservation.payments
                      .filter((p) => p.status === "PAID" && p.paidAt)
                      .map((p) => ({
                        p,
                        dt: Math.abs(
                          new Date(p.paidAt!).getTime() - target,
                        ),
                      }))
                      .sort((x, y) => x.dt - y.dt)[0];
                    if (close && close.dt < 5 * 60_000) {
                      method = close.p.method as any;
                    }
                  }
                }
              }
              const dPrice = a.extraDeslanadoPrice
                ? Number(a.extraDeslanadoPrice)
                : 0;
              const cPrice = a.extraCortePrice
                ? Number(a.extraCortePrice)
                : 0;
              if (dPrice > 0) {
                extraRows.push({
                  key: `${a.id}-deslanado`,
                  label: "Deslanado",
                  price: dPrice,
                  status,
                  method,
                  paidAt: a.extraPaidAt,
                });
              }
              if (cPrice > 0) {
                extraRows.push({
                  key: `${a.id}-corte`,
                  label: "Corte",
                  price: cPrice,
                  status,
                  method,
                  paidAt: a.extraPaidAt,
                });
              }
              // Fallback: si hay extraPrice pero no se desglosó.
              if (dPrice === 0 && cPrice === 0 && a.extraPrice) {
                extraRows.push({
                  key: `${a.id}-extra`,
                  label: a.extraDescription ?? "Extras",
                  price: Number(a.extraPrice),
                  status,
                  method,
                  paidAt: a.extraPaidAt,
                });
              }
            }

            if (extraRows.length === 0) return null;

            const methodInfo = (
              m: "CASH" | "TRANSFER" | "STRIPE" | null,
            ): {
              icon: keyof typeof Ionicons.glyphMap;
              label: string;
            } => {
              if (m === "CASH")
                return { icon: "cash-outline", label: "Efectivo" };
              if (m === "TRANSFER")
                return {
                  icon: "swap-horizontal-outline",
                  label: "Transferencia",
                };
              if (m === "STRIPE")
                return { icon: "card-outline", label: "Tarjeta" };
              return { icon: "ellipsis-horizontal", label: "—" };
            };

            const statusBadge = (s: typeof extraRows[number]["status"]) =>
              s === "PAID"
                ? {
                    bg: COLORS.successBg,
                    color: COLORS.successText,
                    label: "Pagado",
                  }
                : s === "PAY_ON_PICKUP"
                ? {
                    bg: COLORS.warningBg,
                    color: COLORS.warningText,
                    label: "Pagar al recoger",
                  }
                : {
                    bg: COLORS.infoBg,
                    color: COLORS.infoText,
                    label: "Por cobrar",
                  };

            return (
              <View style={styles.extrasGroup}>
                <View style={styles.extrasGroupHeader}>
                  <Ionicons name="cut" size={13} color={COLORS.primary} />
                  <Text style={styles.extrasGroupTitle}>
                    Extras del baño
                  </Text>
                </View>
                {extraRows.map((row) => {
                  const m = methodInfo(row.method);
                  const b = statusBadge(row.status);
                  return (
                    <View key={row.key} style={styles.extraRow}>
                      <View style={styles.addonIconWrap}>
                        <Ionicons
                          name={m.icon}
                          size={18}
                          color={COLORS.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.paymentAmount}>
                          {row.label} ·{" "}
                          <Text style={styles.extraPriceInline}>
                            {formatCurrency(row.price)}
                          </Text>
                        </Text>
                        <Text style={styles.paymentMeta}>
                          {m.label}
                          {row.paidAt
                            ? ` · ${formatDateTime(row.paidAt)}`
                            : ""}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.paymentBadge,
                          { backgroundColor: b.bg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.paymentBadgeText,
                            { color: b.color },
                          ]}
                        >
                          {b.label}
                        </Text>
                      </View>
                    </View>
                  );
                })}
                <View style={styles.extrasGroupDivider} />
              </View>
            );
          })()}
        {(() => {
          // En baños, los pagos de extras ya se muestran desglosados arriba
          // (Deslanado/Corte), así que ocultamos su Payment-suma de esta lista
          // para evitar duplicar el monto.
          const extraStripeIds = new Set(
            (reservation.addons ?? [])
              .map((a) => a.extraStripePaymentIntentId)
              .filter(Boolean) as string[],
          );
          const displayedPayments = isBath
            ? reservation.payments.filter((p) => {
                if (p.notes && /^Extras/i.test(p.notes)) return false;
                if (
                  p.stripePaymentIntentId &&
                  extraStripeIds.has(p.stripePaymentIntentId)
                )
                  return false;
                return true;
              })
            : reservation.payments;

          if (displayedPayments.length === 0) {
            return (
              <Text style={styles.emptyText}>Sin pagos registrados</Text>
            );
          }
          return displayedPayments.map((p, idx) => {
            const methodIcon: keyof typeof Ionicons.glyphMap =
              p.method === "CASH"
                ? "cash-outline"
                : p.method === "TRANSFER"
                ? "swap-horizontal-outline"
                : "card-outline";
            const badgeStyle: { bg: string; color: string; label: string } =
              p.status === "PAID"
                ? { bg: COLORS.successBg, color: COLORS.successText, label: "Pagado" }
                : p.status === "PARTIAL"
                ? { bg: COLORS.warningBg, color: COLORS.warningText, label: "Anticipo" }
                : p.status === "REFUNDED"
                ? { bg: COLORS.bgSection, color: COLORS.textTertiary, label: "Reembolsado" }
                : { bg: COLORS.errorBg, color: COLORS.errorText, label: "Sin pagar" };
            const willHaveCTA =
              reservation.status !== "CANCELLED" &&
              reservation.status !== "CHECKED_OUT";
            const isLastPayment =
              idx === displayedPayments.length - 1 && !willHaveCTA;
            return (
              <View
                key={p.id}
                style={[styles.paymentRow, isLastPayment && styles.lastRow]}
              >
                <View style={styles.addonIconWrap}>
                  <Ionicons name={methodIcon} size={18} color={COLORS.primary} />
                </View>
                {(() => {
                  // Cuando Stripe se quedó una comisión, el número grande es lo
                  // que REALMENTE recibió el hotel y el bruto baja a la línea de
                  // abajo. Es la pregunta que se hace el dueño al ver un pago:
                  // "¿cuánto me quedó?". Lo que el cliente pagó sigue a la
                  // vista porque es lo que abona a su saldo.
                  //
                  // La condición mira la comisión, no el método: un cobro de
                  // Stripe reetiquetado a mano como transferencia sigue teniendo
                  // su comisión, y seguiría siendo dinero que no entró completo.
                  //
                  // Sin comisión (efectivo, transferencia real, terminal) no
                  // cambia nada: mostrar un "neto" ahí haría creer que el
                  // cliente pagó menos de lo que pagó.
                  const bruto = Number(p.amount);
                  const comision =
                    p.stripeFeeAmount != null ? Number(p.stripeFeeAmount) : 0;
                  const hayComision = comision > 0;
                  const principal = hayComision ? bruto - comision : bruto;
                  return (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.paymentAmount}>
                        {isBath ? "Anticipo · " : ""}
                        <Text
                          style={isBath ? styles.extraPriceInline : undefined}
                        >
                          {formatCurrency(principal)}
                        </Text>
                      </Text>
                      <Text style={styles.paymentMeta}>
                        {hayComision ? "Neto al negocio · " : ""}
                        {p.method} ·{" "}
                        {p.paidAt ? formatDateTime(p.paidAt) : "Pendiente"}
                      </Text>
                      {hayComision && (
                        <Text style={styles.paymentMeta}>
                          Pagó el cliente {formatCurrency(bruto)} · Comisión
                          Stripe −{formatCurrency(comision)}
                        </Text>
                      )}
                      {stripeDepositLabel(p) && (
                        <Text style={styles.paymentMeta}>
                          {stripeDepositLabel(p)}
                        </Text>
                      )}
                    </View>
                  );
                })()}
                <View
                  style={[styles.paymentBadge, { backgroundColor: badgeStyle.bg }]}
                >
                  <Text
                    style={[styles.paymentBadgeText, { color: badgeStyle.color }]}
                  >
                    {badgeStyle.label}
                  </Text>
                </View>
              </View>
            );
          });
        })()}
        {reservation.status !== "CANCELLED" &&
          reservation.status !== "CHECKED_OUT" && (
            <TouchableOpacity
              style={styles.registerPaymentBtn}
              onPress={() => setPaymentModalVisible(true)}
            >
              <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
              <Text style={styles.registerPaymentText}>Registrar pago manual</Text>
            </TouchableOpacity>
          )}
      </View>

      {/* Reportes diarios + Incidentes — sólo hospedajes */}
      {!isBath && (
        <>
          {/* Llenar el reporte del día también desde el admin: hasta ahora
              sólo se podía desde el flujo staff, así que un admin (o una
              guardería, que no aparece en las listas de estancias) se quedaba
              sin dónde registrarlo. */}
          {reservation.status === "CHECKED_IN" && (
            <TouchableOpacity
              style={styles.checklistsCard}
              onPress={() => router.push(`/staff/checklist/${id}` as any)}
              activeOpacity={0.85}
              testID="admin-reservation-fill-checklist"
            >
              <View style={styles.checklistsIcon}>
                <Ionicons name="create-outline" size={22} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.checklistsTitle}>
                  {todayChecklist ? "Ver el reporte de hoy" : "Llenar el reporte de hoy"}
                </Text>
                <Text style={styles.checklistsSubtitle}>
                  {todayChecklist
                    ? "Ya se envió al dueño; puedes actualizarlo"
                    : "Ánimo, comida, paseo y fotos del día"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.checklistsCard}
            onPress={() => router.push(`/reservation/checklists/${id}` as any)}
            activeOpacity={0.85}
            testID="admin-reservation-checklists-link"
          >
            <View style={styles.checklistsIcon}>
              <Ionicons name="document-text" size={22} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checklistsTitle}>Reportes diarios</Text>
              <Text style={styles.checklistsSubtitle}>
                {checklists && checklists.length > 0
                  ? `${checklists.length} ${checklists.length === 1 ? "reporte" : "reportes"} del equipo HDI`
                  : "Sin reportes aún"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.checklistsCard}
            onPress={() =>
              router.push(`/pet/incidents/${reservation.pet?.id}` as any)
            }
            activeOpacity={0.85}
            testID="admin-reservation-incidents-link"
          >
            <View style={styles.checklistsIcon}>
              <Ionicons name="alert-circle" size={22} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.checklistsTitle}>Incidentes</Text>
              <Text style={styles.checklistsSubtitle}>
                Historial de alertas del staff de {formatName(reservation.pet?.name ?? "—")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
          </TouchableOpacity>
        </>
      )}

      {/* Acciones primarias (Confirmar / Check-in / Check-out) — sólo hospedajes */}
      {!isBath && actions.filter((a) => a.status !== "CANCELLED").length > 0 && (
        <View style={styles.actionsRow}>
          {actions
            .filter((a) => a.status !== "CANCELLED")
            .map((action) => (
              <TouchableOpacity
                key={action.status}
                style={[styles.actionButton, { backgroundColor: action.color }]}
                onPress={() => handleStatusChange(action)}
                disabled={statusMutation.isPending || cancelMutation.isPending}
                activeOpacity={0.8}
              >
                <Ionicons name={action.icon} size={20} color={COLORS.white} />
                <Text style={styles.actionText}>{action.label}</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}

      {/* Marcar baño como completado — sólo si el baño no está completado/cancelado.
          Se mira `completedAt` del addon, no el StayUpdate: sin foto no hay
          update y el botón reaparecería sobre un baño ya hecho. */}
      {isBath &&
        !bathDone &&
        reservation.status !== "CHECKED_OUT" &&
        reservation.status !== "CANCELLED" && (
          <TouchableOpacity
            style={[
              styles.completeBathBtn,
              completingBath && styles.completeBathBtnDisabled,
            ]}
            onPress={askCompleteBath}
            disabled={completingBath}
            activeOpacity={0.85}
            testID="admin-reservation-complete-bath"
          >
            {completingBath ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={COLORS.white}
                />
                <Text style={styles.completeBathBtnText}>
                  Marcar como completado
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

      {/* Cancelar — al final para evitar taps accidentales */}
      {actions.some((a) => a.status === "CANCELLED") && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() =>
            handleStatusChange(actions.find((a) => a.status === "CANCELLED")!)
          }
          disabled={statusMutation.isPending || cancelMutation.isPending}
          activeOpacity={0.8}
        >
          <Ionicons name="close-circle-outline" size={18} color={COLORS.errorText} />
          <Text style={styles.cancelButtonText}>Cancelar reservación</Text>
        </TouchableOpacity>
      )}

      {/* Reabrir una reserva finalizada (deshacer un check-out equivocado).
          Solo admin: es corrección de errores, no operación del día. */}
      {reservation.status === "CHECKED_OUT" && isAdminRole && (
        <TouchableOpacity
          style={styles.reopenButton}
          onPress={handleReopen}
          disabled={statusMutation.isPending}
          activeOpacity={0.8}
          testID="admin-reservation-reopen"
        >
          <Ionicons name="refresh-circle-outline" size={18} color={COLORS.primary} />
          <Text style={styles.reopenButtonText}>
            Reabrir reserva (deshacer check-out)
          </Text>
        </TouchableOpacity>
      )}

    </ScrollView>

    {/* Payment Modal */}
    <PaymentManualModal
      visible={paymentModalVisible}
      onClose={closePaymentModal}
      submitting={paymentMutation.isPending}
      onSubmit={(values) => paymentMutation.mutate(values)}
    />

    {/* Corregir el total. Se precarga `totalAmount`, NO `displayedTotal`: en
        baños el segundo incluye los extras del staff y guardarlo los metería
        dentro de la columna, duplicándolos en cada edición. */}
    <AmountEditModal
      visible={amountModalVisible}
      onClose={() => setAmountModalVisible(false)}
      submitting={totalMutation.isPending}
      onSubmit={(values) => totalMutation.mutate(values)}
      initialAmount={String(reservation.totalAmount)}
      title="Editar total de la reserva"
      label={isBath ? "Total de la reserva (sin extras del baño)" : "Total"}
      hint={
        isBath
          ? "Los extras de deslanado/corte que define el staff se suman aparte."
          : undefined
      }
    />

    <ReservationDeliveryModal
      visible={deliveryModalVisible}
      onClose={() => setDeliveryModalVisible(false)}
      submitting={deliveryMutation.isPending}
      onSubmit={(payload) => deliveryMutation.mutate(payload)}
      current={{
        enabled: !!reservation.homeDelivery,
        address: reservation.homeDeliveryAddress ?? null,
        fee: deliveryFee,
      }}
    />

    <NoteEditModal
      visible={internalNoteModalVisible}
      onClose={() => setInternalNoteModalVisible(false)}
      submitting={internalNoteMutation.isPending}
      onSubmit={(value) => internalNoteMutation.mutate(value)}
      initialValue={reservation.internalNotes}
      title="Nota interna"
      hint="Solo la ve el equipo. El dueño nunca la ve en su app."
      placeholder="Ej. Baño de cortesía, no cobrar."
    />

    <NoteEditModal
      visible={clientNoteModalVisible}
      onClose={() => setClientNoteModalVisible(false)}
      submitting={clientNoteMutation.isPending}
      onSubmit={(value) => clientNoteMutation.mutate(value)}
      initialValue={reservation.notes}
      title="Nota del cliente"
      hint="Es lo que el dueño indicó al reservar."
    />

    {/* Acciones de un servicio: cortesía y nota. */}
    <SelectionListModal
      variant="view"
      visible={!!addonActionId}
      onClose={() => setAddonActionId(null)}
      title="Servicio"
      subtitle="Marcar como cortesía ajusta el total automáticamente."
      data={addonActions}
      emptyText=""
      keyExtractor={(a) => a.key}
      styles={{
        overlay: styles.modalOverlay,
        content: styles.modalContent,
        header: styles.staffModalHeader,
        title: styles.modalTitle,
        subtitle: styles.staffModalSubtitle,
        list: styles.staffList,
        empty: styles.staffEmptyText,
      }}
      renderItem={(a) => (
        <TouchableOpacity
          style={styles.staffRow}
          onPress={a.onPress}
          disabled={courtesyMutation.isPending}
          activeOpacity={0.7}
        >
          <View style={styles.addonIconWrap}>
            <Ionicons name={a.icon} size={18} color={COLORS.primary} />
          </View>
          <Text style={[styles.staffName, { flex: 1 }]}>{a.label}</Text>
          {courtesyMutation.isPending && a.key !== "note" ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : null}
        </TouchableOpacity>
      )}
    />

    <NoteEditModal
      visible={!!addonNoteId}
      onClose={() => setAddonNoteId(null)}
      submitting={addonNoteMutation.isPending}
      onSubmit={(value) =>
        addonNoteId &&
        addonNoteMutation.mutate({ addonId: addonNoteId, internalNote: value })
      }
      initialValue={
        (reservation.addons ?? []).find((a) => a.id === addonNoteId)
          ?.internalNote ?? null
      }
      title="Nota del servicio"
      hint="La ve quien ejecuta el servicio en su lista del día."
      placeholder="Ej. Usar shampoo hipoalergénico."
      maxLength={500}
    />

    {/* Staff Picker Modal */}
    <SelectionListModal
      variant="view"
      visible={staffModalVisible}
      onClose={() => setStaffModalVisible(false)}
      title="Asignar staff"
      subtitle="Se notificará al staff por la app cuando sea asignado."
      data={staffList}
      emptyText="No hay staff activo registrado."
      keyExtractor={(s) => s.id}
      isItemSelected={(s) => reservation.staff?.id === s.id}
      isItemPending={(s) =>
        assignStaffMutation.isPending && assignStaffMutation.variables === s.id
      }
      styles={{
        overlay: styles.modalOverlay,
        content: styles.modalContent,
        header: styles.staffModalHeader,
        title: styles.modalTitle,
        subtitle: styles.staffModalSubtitle,
        list: styles.staffList,
        empty: styles.staffEmptyText,
      }}
      renderItem={(s, { selected: isCurrent, pending: isPending }) => (
        <TouchableOpacity
          style={[styles.staffRow, isCurrent && styles.staffRowCurrent]}
          onPress={() => {
            assignStaffMutation.mutate(s.id);
            setStaffModalVisible(false);
          }}
          disabled={isCurrent || assignStaffMutation.isPending}
          activeOpacity={0.7}
        >
          <View style={styles.staffAvatar}>
            <Text style={styles.staffAvatarText}>
              {(s.firstName?.[0] ?? "S").toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.staffName} numberOfLines={1}>
              {formatName(s.firstName)} {formatName(s.lastName)}
            </Text>
            <Text style={styles.staffEmail} numberOfLines={1}>
              {s.email}
            </Text>
          </View>
          {isPending ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : isCurrent ? (
            <View style={styles.currentPill}>
              <Text style={styles.currentPillText}>Asignado</Text>
            </View>
          ) : (
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textTertiary}
            />
          )}
        </TouchableOpacity>
      )}
    />

    {/* Room Picker Modal */}
    <SelectionListModal
      variant="view"
      visible={roomModalVisible}
      onClose={() => setRoomModalVisible(false)}
      title="Asignar cuarto"
      subtitle={`Solo se muestran cuartos para el tamaño de ${formatName(reservation.pet.name)}.`}
      data={roomList}
      emptyText="No hay cuartos para el tamaño de esta mascota."
      keyExtractor={(r) => r.id}
      isItemSelected={(r) => reservation.room?.id === r.id}
      isItemPending={(r) =>
        assignRoomMutation.isPending && assignRoomMutation.variables === r.id
      }
      styles={{
        overlay: styles.modalOverlay,
        content: styles.modalContent,
        header: styles.staffModalHeader,
        title: styles.modalTitle,
        subtitle: styles.staffModalSubtitle,
        list: styles.staffList,
        listMaxHeight: ROOM_LIST_MAX_HEIGHT,
        empty: styles.staffEmptyText,
      }}
      renderItem={(r, { selected: isCurrent, pending: isPending }) => (
        <TouchableOpacity
          style={[styles.staffRow, isCurrent && styles.staffRowCurrent]}
          onPress={() => {
            assignRoomMutation.mutate(r.id);
            setRoomModalVisible(false);
          }}
          disabled={isCurrent || assignRoomMutation.isPending}
          activeOpacity={0.7}
        >
          <View style={styles.staffAvatar}>
            <Ionicons name="bed-outline" size={16} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.staffName} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={styles.staffEmail} numberOfLines={1}>
              Capacidad {r.capacity}
            </Text>
          </View>
          {isPending ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : isCurrent ? (
            <View style={styles.currentPill}>
              <Text style={styles.currentPillText}>Asignado</Text>
            </View>
          ) : (
            <Ionicons
              name="chevron-forward"
              size={18}
              color={COLORS.textTertiary}
            />
          )}
        </TouchableOpacity>
      )}
    />

    {/* Confirmación de éxito no bloqueante (check-in/out, pago, staff, cuarto). */}
    {banner}
    </>
  );
}
