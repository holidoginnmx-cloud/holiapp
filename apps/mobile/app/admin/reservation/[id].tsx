import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Image,
  Pressable,
  Dimensions,
} from "react-native";

const ROOM_LIST_MAX_HEIGHT = Dimensions.get("window").height * 0.45;
import { useState, useEffect } from "react";
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
} from "@/lib/api";
import ImageView from "react-native-image-viewing";
import { cloudinaryResized, uploadToCloudinary } from "@/lib/cloudinary";
import * as ImagePicker from "expo-image-picker";
import { formatName } from "@/lib/format";

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
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDayShort(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function formatWeekday(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    weekday: "short",
  });
}

function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [staffModalVisible, setStaffModalVisible] = useState(false);
  const [roomModalVisible, setRoomModalVisible] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(null), 2000);
    return () => clearTimeout(t);
  }, [successMessage]);

  const closePaymentModal = () => {
    setPaymentModalVisible(false);
    setPaymentAmount("");
    setPaymentNotes("");
  };

  // Visor de fotos del baño y mutación para eliminar.
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const deletePhotoMutation = useMutation({
    mutationFn: (updateId: string) => deleteStayUpdate(updateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
    },
    onError: (err: Error) =>
      Alert.alert("No se pudo eliminar", err.message),
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

  const { data: reservation, isLoading } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const { data: checklists } = useQuery({
    queryKey: ["reservation-checklists", id],
    queryFn: () => getOwnerChecklists(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ newStatus }: { newStatus: string }) =>
      updateReservationStatus(id!, newStatus),
    onSuccess: (_data, { newStatus }) => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      if (newStatus === "CHECKED_OUT") {
        setSuccessMessage("Check-out realizado correctamente");
      } else if (newStatus === "CHECKED_IN") {
        setSuccessMessage("Check-in realizado correctamente");
      }
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => adminCancelReservation(id!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      Alert.alert(
        "Reserva cancelada",
        res.awaitingClientChoice
          ? `Notificamos al dueño para que elija cómo recibir su reembolso de $${res.refundAmount.toLocaleString("es-MX")}.`
          : "La reserva fue cancelada. No había monto pagado por reembolsar."
      );
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      registerManualPayment({
        reservationId: id!,
        amount: parseFloat(paymentAmount),
        method: paymentMethod,
        notes: paymentNotes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      setPaymentModalVisible(false);
      setPaymentAmount("");
      setPaymentNotes("");
      Alert.alert("Pago registrado", "El pago se registró correctamente y se notificó al dueño.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Lista de staff activos — solo se carga cuando se abre el modal.
  const { data: staffList } = useQuery({
    queryKey: ["admin", "users", "staff"],
    queryFn: getUsers,
    enabled: staffModalVisible,
    select: (users) =>
      users.filter((u) => u.role === "STAFF" && u.isActive),
  });

  const assignStaffMutation = useMutation({
    mutationFn: (staffId: string) => adminAssignStaff(id!, staffId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      setStaffModalVisible(false);
      Alert.alert("Staff asignado", "Se notificó al staff por la app.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Cuartos del tamaño de la mascota — solo se cargan al abrir el modal.
  const { data: roomList } = useQuery({
    queryKey: ["admin", "rooms", reservation?.pet?.size],
    queryFn: () => getRooms(reservation!.pet.size),
    enabled: roomModalVisible && !!reservation?.pet?.size,
  });

  const assignRoomMutation = useMutation({
    mutationFn: (roomId: string) => adminAssignRoom(id!, roomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      setRoomModalVisible(false);
      Alert.alert("Cuarto asignado", "El cuarto se asignó correctamente.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

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

  if (isLoading || !reservation) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const config = STATUS_CONFIG[reservation.status] || STATUS_CONFIG.CONFIRMED;
  const actions = getActions(reservation.status);
  const isBath = reservation.reservationType === "BATH";
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

  // Staff que completó el baño: tomamos del StayUpdate más reciente con
  // caption del baño (lo registra el endpoint POST /staff/baths/:id/complete).
  const bathCompletedUpdate = isBath
    ? reservation.updates.find(
        (u) =>
          u.staff &&
          (u.caption?.toLowerCase().includes("baño") ?? false),
      ) ??
      // Fallback: si no hay caption, usar el update más reciente con foto.
      reservation.updates.find((u) => u.staff)
    : null;
  const bathStaff = bathCompletedUpdate?.staff ?? null;

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
            : "Detalle de reservación",
      }}
    />
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
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
        </View>
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
            <View style={styles.bathHero}>
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
                    {new Date(reservation.appointmentAt).toLocaleTimeString(
                      "es-MX",
                      {
                        timeZone: "America/Hermosillo",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </Text>
                </View>
              )}
            </View>

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

            {bathStaff && (
              <View style={styles.bathStaffStrip}>
                <Ionicons
                  name="ribbon-outline"
                  size={14}
                  color={COLORS.primary}
                />
                <Text style={styles.bathStaffText}>
                  Bañó:{" "}
                  <Text style={styles.bathStaffName}>
                    {formatName(bathStaff.firstName)}{" "}
                    {formatName(bathStaff.lastName)}
                  </Text>
                </Text>
                {bathCompletedUpdate?.createdAt && (
                  <Text style={styles.bathStaffDate}>
                    {" · "}
                    {formatDateTime(bathCompletedUpdate.createdAt)}
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

        {/* Date hero — entrada → salida con noches al centro */}
        {!isBath && reservation.checkIn && reservation.checkOut && (
          <View style={styles.dateHero}>
            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>ENTRADA</Text>
              <Text style={styles.datePillDay}>
                {formatDayShort(reservation.checkIn)}
              </Text>
              <Text style={styles.datePillSub}>
                {formatWeekday(reservation.checkIn)}
              </Text>
            </View>

            <View style={styles.dateConnector}>
              <View style={styles.connectorLine} />
              <View style={styles.nightsBadge}>
                <Ionicons name="moon" size={12} color={COLORS.primary} />
                <Text style={styles.nightsBadgeText}>
                  {reservation.totalDays}{" "}
                  {reservation.totalDays === 1 ? "noche" : "noches"}
                </Text>
              </View>
              <View style={styles.connectorLine} />
            </View>

            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>SALIDA</Text>
              <Text style={styles.datePillDay}>
                {formatDayShort(reservation.checkOut)}
              </Text>
              <Text style={styles.datePillSub}>
                {formatWeekday(reservation.checkOut)}
              </Text>
            </View>
          </View>
        )}

        {/* Cuarto + Staff lado a lado (sólo hospedajes) */}
        {!isBath && (
        <View style={styles.metaRow}>
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

        {/* Total */}
        <View style={styles.totalFooter}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>
            ${displayedTotal.toLocaleString("es-MX")}
          </Text>
        </View>

        {reservation.notes && (
          <View style={styles.notesBox}>
            <Ionicons
              name="document-text-outline"
              size={14}
              color={COLORS.notesText}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.notesLabel}>Notas</Text>
              <Text style={styles.notesText}>{reservation.notes}</Text>
            </View>
          </View>
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

              <ImageView
                images={photos.map((u) => ({
                  uri: cloudinaryResized(u.mediaUrl, 1200, "limit"),
                }))}
                imageIndex={photoViewerIndex}
                visible={photoViewerVisible}
                onRequestClose={() => setPhotoViewerVisible(false)}
                swipeToCloseEnabled
                doubleTapToZoomEnabled
              />
            </View>
          );
        })()}

      {/* Servicios contratados — sólo hospedajes (en baños el servicio es la
          reserva misma y ya aparece en el hero). */}
      {!isBath && reservation.addons && reservation.addons.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>Servicios contratados</Text>
            <View style={styles.countChip}>
              <Text style={styles.countChipText}>
                {reservation.addons.length}
              </Text>
            </View>
          </View>
          {reservation.addons.map((addon, idx) => {
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
              <View
                key={addon.id}
                style={[styles.addonRow, isLastAddon && styles.lastRow]}
              >
                <View style={styles.addonIconWrap}>
                  <Ionicons name={icon} size={18} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addonLabel}>{label}</Text>
                  <View style={styles.addonMetaRow}>
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
                    <Text style={styles.addonDate}>
                      {formatDateTime(addon.createdAt)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.addonPrice}>
                  ${Number(addon.unitPrice).toLocaleString("es-MX")}
                </Text>
              </View>
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
                            ${row.price.toLocaleString("es-MX")}
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentAmount}>
                    {isBath ? "Anticipo · " : ""}
                    <Text style={isBath ? styles.extraPriceInline : undefined}>
                      ${Number(p.amount).toLocaleString("es-MX")}
                    </Text>
                  </Text>
                  <Text style={styles.paymentMeta}>
                    {p.method} ·{" "}
                    {p.paidAt ? formatDateTime(p.paidAt) : "Pendiente"}
                  </Text>
                </View>
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

      {/* Marcar baño como completado — sólo si el baño no está completado/cancelado */}
      {isBath &&
        !bathStaff &&
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

    </ScrollView>

    {/* Payment Modal */}
    <Modal
      visible={paymentModalVisible}
      transparent
      animationType="slide"
      onRequestClose={closePaymentModal}
    >
      <Pressable style={styles.modalOverlay} onPress={closePaymentModal}>
        <Pressable style={styles.modalContent} onPress={() => {}}>
          <Text style={styles.modalTitle}>Registrar pago manual</Text>

          <Text style={styles.inputLabel}>Monto</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="0.00"
            placeholderTextColor={COLORS.textDisabled}
            value={paymentAmount}
            onChangeText={setPaymentAmount}
            keyboardType="decimal-pad"
          />

          <Text style={styles.inputLabel}>Método</Text>
          <View style={styles.methodRow}>
            {(["CASH", "TRANSFER"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[
                  styles.methodChip,
                  paymentMethod === m && styles.methodChipActive,
                ]}
                onPress={() => setPaymentMethod(m)}
              >
                <Ionicons
                  name={m === "CASH" ? "cash-outline" : "swap-horizontal-outline"}
                  size={16}
                  color={paymentMethod === m ? COLORS.white : COLORS.textTertiary}
                />
                <Text
                  style={[
                    styles.methodChipText,
                    paymentMethod === m && { color: COLORS.white },
                  ]}
                >
                  {m === "CASH" ? "Efectivo" : "Transferencia"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.inputLabel}>Notas (opcional)</Text>
          <TextInput
            style={[styles.modalInput, { minHeight: 60 }]}
            placeholder="Referencia, número de operación, etc."
            placeholderTextColor={COLORS.textDisabled}
            value={paymentNotes}
            onChangeText={setPaymentNotes}
            multiline
          />

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.modalBtnCancel}
              onPress={closePaymentModal}
            >
              <Text style={styles.modalBtnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalBtnConfirm,
                (!paymentAmount || parseFloat(paymentAmount) <= 0) && { opacity: 0.5 },
              ]}
              onPress={() => paymentMutation.mutate()}
              disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || paymentMutation.isPending}
            >
              <Text style={styles.modalBtnConfirmText}>
                {paymentMutation.isPending ? "Registrando..." : "Registrar"}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    {/* Staff Picker Modal */}
    <Modal
      visible={staffModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setStaffModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.staffModalHeader}>
            <Text style={styles.modalTitle}>Asignar staff</Text>
            <TouchableOpacity
              onPress={() => setStaffModalVisible(false)}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={COLORS.textTertiary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.staffModalSubtitle}>
            Se notificará al staff por la app cuando sea asignado.
          </Text>

          {!staffList ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : staffList.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={styles.staffEmptyText}>
                No hay staff activo registrado.
              </Text>
            </View>
          ) : (
            <View style={styles.staffList}>
              {staffList.map((s) => {
                const isCurrent = reservation.staff?.id === s.id;
                const isPending =
                  assignStaffMutation.isPending &&
                  assignStaffMutation.variables === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.staffRow,
                      isCurrent && styles.staffRowCurrent,
                    ]}
                    onPress={() => assignStaffMutation.mutate(s.id)}
                    disabled={
                      isCurrent || assignStaffMutation.isPending
                    }
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
                );
              })}
            </View>
          )}
        </View>
      </View>
    </Modal>

    {/* Room Picker Modal */}
    <Modal
      visible={roomModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setRoomModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.staffModalHeader}>
            <Text style={styles.modalTitle}>Asignar cuarto</Text>
            <TouchableOpacity
              onPress={() => setRoomModalVisible(false)}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={COLORS.textTertiary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.staffModalSubtitle}>
            Solo se muestran cuartos para el tamaño de {formatName(reservation.pet.name)}.
          </Text>

          {!roomList ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : roomList.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={styles.staffEmptyText}>
                No hay cuartos para el tamaño de esta mascota.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ maxHeight: ROOM_LIST_MAX_HEIGHT }}
              contentContainerStyle={styles.staffList}
              showsVerticalScrollIndicator={false}
            >
              {roomList.map((r) => {
                const isCurrent = reservation.room?.id === r.id;
                const isPending =
                  assignRoomMutation.isPending &&
                  assignRoomMutation.variables === r.id;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[
                      styles.staffRow,
                      isCurrent && styles.staffRowCurrent,
                    ]}
                    onPress={() => assignRoomMutation.mutate(r.id)}
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
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>

    {/* Toast de éxito al hacer check-in / check-out. */}
    <Modal
      visible={!!successMessage}
      transparent
      animationType="fade"
      onRequestClose={() => setSuccessMessage(null)}
    >
      <View style={styles.toastOverlay} pointerEvents="none">
        <View style={styles.toastCard}>
          <View style={styles.toastIconWrap}>
            <Ionicons
              name="checkmark-circle"
              size={48}
              color={COLORS.successText}
            />
          </View>
          <Text style={styles.toastText}>{successMessage}</Text>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  toastOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  toastCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 28,
    alignItems: "center",
    gap: 10,
    minWidth: 220,
    maxWidth: 320,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  toastIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  toastText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 16,
  },
  backText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  petAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.bgSection,
  },
  petAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryLight,
  },
  petName: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  ownerName: {
    fontSize: 15,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "700",
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  // Date hero
  dateHero: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  bathHeroWrap: {
    gap: 10,
  },
  bathHero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 12,
  },
  bathChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  bathExtraChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  bathExtraChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },
  petMetaStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 2,
  },
  petMetaText: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontWeight: "600",
    flex: 1,
  },
  bathStaffStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 2,
  },
  bathStaffText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  bathStaffName: {
    color: COLORS.primary,
    fontWeight: "800",
  },
  bathStaffDate: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "500",
  },
  petNotesBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.notesBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warningText,
    borderRadius: 10,
    padding: 10,
  },
  petNotesLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.notesText,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  petNotesText: {
    fontSize: 13,
    color: COLORS.notesText,
    lineHeight: 18,
  },
  bathBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  bathBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },
  bathInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bathDay: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  bathTime: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  datePill: {
    flex: 1,
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  datePillLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: COLORS.textTertiary,
    marginBottom: 4,
  },
  datePillDay: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  datePillSub: {
    fontSize: 11,
    color: COLORS.textTertiary,
    textTransform: "capitalize",
    marginTop: 2,
  },
  dateConnector: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  connectorLine: {
    flex: 1,
    width: 1,
    backgroundColor: COLORS.borderLight,
    minHeight: 8,
  },
  nightsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginVertical: 4,
  },
  nightsBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },
  // Meta row (cuarto + staff)
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 12,
  },
  metaItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
  },
  metaIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  metaDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: COLORS.borderLight,
    marginVertical: 4,
  },
  unassigned: {
    color: COLORS.textDisabled,
    fontStyle: "italic",
    fontWeight: "500",
  },
  metaValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  // Staff picker modal
  staffModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  staffModalSubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  staffList: {
    gap: 8,
    marginBottom: 8,
  },
  staffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 12,
  },
  staffRowCurrent: {
    backgroundColor: COLORS.primaryLight,
  },
  staffAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  staffAvatarText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "800",
  },
  staffName: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  staffEmail: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  staffEmptyText: {
    fontSize: 14,
    color: COLORS.textTertiary,
  },
  currentPill: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  currentPillText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  // Total footer
  totalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 12,
    marginTop: 12,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
  },
  // Notes
  notesBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: COLORS.notesBg,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  notesLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: COLORS.notesText,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  notesText: {
    fontSize: 13,
    color: COLORS.notesBorder,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 10,
  },
  actionText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.errorText,
    backgroundColor: COLORS.white,
    marginBottom: 24,
  },
  completeBathBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  completeBathBtnDisabled: { opacity: 0.7 },
  completeBathBtnText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "800",
  },
  cancelButtonText: {
    color: COLORS.errorText,
    fontSize: 14,
    fontWeight: "700",
  },
  // Section card (servicios + pagos)
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionCardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  countChip: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    minWidth: 22,
    alignItems: "center",
  },
  countChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textDisabled,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  // Shared icon wrap (addon + payment)
  addonIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  // Addon row
  addonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  lastRow: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  addonLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  addonMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  metaPillSuccess: {
    backgroundColor: COLORS.successBg,
  },
  metaPillInfo: {
    backgroundColor: COLORS.infoBg,
  },
  metaPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  addonDate: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  addonPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.primary,
  },
  // Bath photos
  photosRow: {
    gap: 10,
    paddingVertical: 4,
  },
  photoTile: {
    width: 140,
    position: "relative",
  },
  photoImage: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: COLORS.bgSection,
  },
  photoDeleteBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(220, 38, 38, 0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoCaption: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  photoHint: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 8,
    fontStyle: "italic",
  },
  // Payment row
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  extrasGroup: {
    marginBottom: 4,
  },
  extrasGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
    paddingBottom: 4,
  },
  extrasGroupTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  extraRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  extraPriceInline: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.primary,
  },
  extrasGroupDivider: {
    height: 6,
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  paymentMeta: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  paymentBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  checklistsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  checklistsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  checklistsTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  checklistsSubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  registerPaymentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    backgroundColor: COLORS.primaryLight,
  },
  registerPaymentText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 6,
    marginTop: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlignVertical: "top",
  },
  methodRow: {
    flexDirection: "row",
    gap: 10,
  },
  methodChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  methodChipActive: {
    backgroundColor: COLORS.primary,
  },
  methodChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalBtnCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  modalBtnCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  modalBtnConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  modalBtnConfirmText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.white,
  },
});
