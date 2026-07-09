import { COLORS } from "@/constants/colors";
import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Dimensions,
} from "react-native";

const ROOM_LIST_MAX_HEIGHT = Dimensions.get("window").height * 0.45;
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useAuthStore } from "@/store/authStore";
import {
  getStaffStayById,
  assignStay,
  staffCheckin,
  staffCheckout,
  createStaffAlert,
  createStaffUpdate,
  addBehaviorTag,
  deleteBehaviorTag,
  resolveStaffAlert,
  completeAddon,
  staffConfirmChangeRequestPickupPaid,
  registerStayManualPayment,
  getRooms,
  adminAssignRoom,
} from "@/lib/api";
import { uploadToCloudinary, cloudinaryResized } from "@/lib/cloudinary";
import { BehaviorTagPill } from "@/components/BehaviorTagPill";
import { ErrorState } from "@/components/ErrorState";
import { SelectionListModal } from "@/components/SelectionListModal";
import { useSuccessBanner } from "@/components/SuccessBanner";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import {
  PaymentManualModal,
  type ManualPaymentValues,
} from "@/components/PaymentManualModal";
import { formatName, utcDayKey, localDayKey, formatPhoneInput, displayEmail, NO_EMAIL_LABEL, formatCurrency, formatDayShortYear, formatDayShort, formatDateTimeShort, formatTimeHHmm } from "@/lib/format";
import type { AlertType, BehaviorTagValue } from "@holidoginn/shared";
import { styles } from "@/styles/stayDetailStyles";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";

const ALERT_TYPES: { key: AlertType; label: string; icon: string }[] = [
  { key: "NOT_EATING", label: "No está comiendo", icon: "restaurant-outline" },
  { key: "LETHARGIC", label: "Está decaído", icon: "sad-outline" },
  { key: "BEHAVIOR_ISSUE", label: "Problema de comportamiento", icon: "warning-outline" },
  { key: "HEALTH_CONCERN", label: "Preocupación de salud", icon: "medkit-outline" },
  { key: "INCIDENT", label: "Incidente", icon: "alert-circle-outline" },
];

const BEHAVIOR_TAGS: { key: BehaviorTagValue; label: string }[] = [
  { key: "CALM", label: "Tranquilo" },
  { key: "ANXIOUS", label: "Ansioso" },
  { key: "DOMINANT", label: "Dominante" },
  { key: "SOCIABLE", label: "Sociable" },
  { key: "SHY", label: "Tímido" },
  { key: "AGGRESSIVE", label: "Agresivo" },
];

export default function StayDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isTablet } = useResponsive();
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.userId);

  const [alertModalVisible, setAlertModalVisible] = useState(false);
  const [alertType, setAlertType] = useState<AlertType>("NOT_EATING");
  const [alertDescription, setAlertDescription] = useState("");
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [selectedTagKey, setSelectedTagKey] = useState<BehaviorTagValue | null>(null);
  const [tagNotes, setTagNotes] = useState("");
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentInitialAmount, setPaymentInitialAmount] = useState("");
  const [roomModalVisible, setRoomModalVisible] = useState(false);

  const { banner, showSuccess } = useSuccessBanner();

  const { data: stay, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff", "stay", id],
    queryFn: () => getStaffStayById(id!),
    enabled: !!id,
  });

  // Al volver a la pantalla: invalidar SIN bloquear — el cache se muestra al
  // instante y el refetch corre en background (antes: staleTime 0 + refetch
  // forzado = espera de red garantizada en cada regreso).
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      queryClient.invalidateQueries({ queryKey: ["staff", "stay", id] });
    }, [id])
  );

  // Invalidación dirigida: detalle + listas de estancias. Antes se invalidaba
  // ["staff"] completo (stats, checklists, todo) tras cada acción.
  const invalidateStay = () => {
    queryClient.invalidateQueries({ queryKey: ["staff", "stay", id] });
    queryClient.invalidateQueries({ queryKey: ["staff", "stays"] });
  };

  const assignMutation = useMutation({
    mutationFn: () => assignStay(id!),
    onSuccess: () => {
      invalidateStay();
      showSuccess("Te has asignado como responsable");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Cuartos del tamaño de la mascota — solo se cargan al abrir el modal.
  const { data: roomList } = useQuery({
    queryKey: ["rooms", stay?.pet?.size],
    queryFn: () => getRooms(stay!.pet!.size),
    enabled: roomModalVisible && !!stay?.pet?.size,
  });

  // Optimista: el cuarto seleccionado aparece al instante en el detalle.
  const assignRoomMutation = useOptimisticMutation({
    mutationFn: (roomId: string) => adminAssignRoom(id!, roomId),
    patches: [
      {
        queryKey: ["staff", "stay", id],
        updater: (old, roomId) => {
          const selected = roomList?.find((r) => r.id === roomId);
          if (!old || !selected) return old;
          return { ...(old as object), room: selected };
        },
      },
    ],
    invalidateKeys: [["staff", "stay", id], ["staff", "stays"]],
    onSuccess: () => showSuccess("Cuarto asignado"),
    errorTitle: "No se pudo asignar el cuarto",
  });

  const checkinMutation = useMutation({
    mutationFn: () => staffCheckin(id!),
    onSuccess: () => {
      invalidateStay();
      queryClient.invalidateQueries({ queryKey: ["staff", "me", "stats"] });
      showSuccess("Check-in realizado — se notificó al dueño");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const confirmPickupPaidMutation = useMutation({
    mutationFn: (crId: string) => staffConfirmChangeRequestPickupPaid(crId),
    onSuccess: () => {
      invalidateStay();
      showSuccess("Pago registrado — se notificó al dueño");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const manualPaymentMutation = useMutation({
    mutationFn: (values: ManualPaymentValues) =>
      registerStayManualPayment(id!, {
        amount: values.amount,
        method: values.method,
        notes: values.notes,
      }),
    onSuccess: (res) => {
      invalidateStay();
      setPaymentModalVisible(false);
      showSuccess(`Pago de ${formatCurrency(res.amount)} registrado`);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  function closePaymentModal() {
    setPaymentModalVisible(false);
  }

  const checkoutMutation = useMutation({
    mutationFn: () => staffCheckout(id!),
    onSuccess: (data) => {
      invalidateStay();
      queryClient.invalidateQueries({ queryKey: ["staff", "me", "stats"] });
      if (data.warnings.length > 0) {
        // Las advertencias sí bloquean: el staff debe leerlas.
        Alert.alert(
          "Check-out con advertencias",
          data.warnings.join("\n")
        );
      } else {
        showSuccess("Check-out realizado — se notificó al dueño");
      }
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const alertMutation = useMutation({
    mutationFn: () =>
      createStaffAlert({
        type: alertType,
        description: alertDescription,
        reservationId: id!,
        petId: stay!.petId,
      }),
    onSuccess: () => {
      invalidateStay();
      setAlertModalVisible(false);
      setAlertDescription("");
      showSuccess("Alerta enviada a los administradores");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const tagMutation = useMutation({
    mutationFn: ({ tag, notes }: { tag: BehaviorTagValue; notes: string | null }) =>
      addBehaviorTag({
        tag,
        notes,
        stayId: id!,
        petId: stay!.petId,
      }),
    onSuccess: () => {
      invalidateStay();
      setTagModalVisible(false);
      setSelectedTagKey(null);
      setTagNotes("");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Optimista: la etiqueta desaparece al confirmar; si falla, reaparece.
  const deleteTagMutation = useOptimisticMutation({
    mutationFn: (tagId: string) => deleteBehaviorTag(tagId),
    patches: [
      {
        queryKey: ["staff", "stay", id],
        updater: (old, tagId) => {
          const s = old as { pet?: { behaviorTags?: { id: string }[] } };
          if (!s?.pet?.behaviorTags) return old;
          return {
            ...s,
            pet: {
              ...s.pet,
              behaviorTags: s.pet.behaviorTags.filter((t) => t.id !== tagId),
            },
          };
        },
      },
    ],
    invalidateKeys: [["staff", "stay", id]],
    errorTitle: "No se pudo quitar la etiqueta",
  });

  const handleDeleteTag = (tagId: string, tagLabel: string) => {
    Alert.alert(
      "Quitar etiqueta",
      `¿Eliminar la etiqueta "${tagLabel}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteTagMutation.mutate(tagId),
        },
      ]
    );
  };

  // Optimista: la alerta se marca resuelta en el mismo frame del tap.
  const resolveAlertMutation = useOptimisticMutation({
    mutationFn: (alertId: string) => resolveStaffAlert(alertId),
    patches: [
      {
        queryKey: ["staff", "stay", id],
        updater: (old, alertId) => {
          const s = old as { alerts?: { id: string; isResolved: boolean }[] };
          if (!s?.alerts) return old;
          return {
            ...s,
            alerts: s.alerts.map((a) =>
              a.id === alertId ? { ...a, isResolved: true } : a
            ),
          };
        },
      },
    ],
    invalidateKeys: [["staff", "stay", id]],
    onSuccess: () => showSuccess("Alerta marcada como resuelta"),
    errorTitle: "No se pudo resolver la alerta",
  });

  const completeAddonMutation = useMutation({
    mutationFn: ({ addonId, mediaUrl }: { addonId: string; mediaUrl: string }) =>
      completeAddon(addonId, mediaUrl),
    onSuccess: () => {
      invalidateStay();
      showSuccess("Baño marcado como completado");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const [completingBathId, setCompletingBathId] = useState<string | null>(null);

  async function pickBathPhoto(source: "camera" | "library"): Promise<string | null> {
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

  async function handleCompleteBathAddon(addonId: string, source: "camera" | "library") {
    const uri = await pickBathPhoto(source);
    if (!uri) return;
    setCompletingBathId(addonId);
    try {
      const cloud = await uploadToCloudinary(uri, "baths");
      await completeAddonMutation.mutateAsync({ addonId, mediaUrl: cloud.secure_url });
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "No se pudo completar el baño",
      );
    } finally {
      setCompletingBathId(null);
    }
  }

  const handleUploadEvidence = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tus fotos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled || !stay) return;

    setUploadingEvidence(true);
    try {
      const cloudResult = await uploadToCloudinary(result.assets[0].uri, "stays");
      await createStaffUpdate({
        mediaUrl: cloudResult.secure_url,
        mediaType: "image",
        caption: null,
        reservationId: stay.id,
        petId: stay.petId,
        staffId: currentUserId,
      });
      invalidateStay();
      showSuccess("Evidencia subida correctamente");
    } catch (error: any) {
      Alert.alert("Error", error.message || "No se pudo subir la evidencia");
    } finally {
      setUploadingEvidence(false);
    }
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !stay) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const isAssignedToMe = stay.staffId === currentUserId;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayKey = localDayKey();
  const todayChecklist = stay.checklists.find(
    (c) => utcDayKey(c.date) === todayKey
  );
  const todayUpdates = stay.updates.filter(
    (u) => new Date(u.createdAt) >= todayStart
  );
  const todayPhotos = todayUpdates.filter((u) => u.mediaType === "image");
  const todayVideos = todayUpdates.filter((u) => u.mediaType === "video");

  const petAge = stay.pet?.birthDate
    ? Math.floor(
        (Date.now() - new Date(stay.pet.birthDate).getTime()) /
          (365.25 * 86_400_000)
      )
    : null;

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={
        isTablet && { maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", width: "100%" }
      }
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refetch} tintColor={COLORS.primary} />
      }
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerInfo}>
          <Text style={styles.petName}>{formatName(stay.pet?.name ?? "—")}</Text>
          <Text style={styles.ownerName}>
            {formatName(stay.owner?.firstName ?? "")} {formatName(stay.owner?.lastName ?? "")}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                stay.status === "CHECKED_IN"
                  ? COLORS.successBg
                  : stay.status === "CONFIRMED"
                  ? COLORS.infoBg
                  : COLORS.bgSection,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color:
                  stay.status === "CHECKED_IN"
                    ? COLORS.successText
                    : stay.status === "CONFIRMED"
                    ? COLORS.infoText
                    : COLORS.textTertiary,
              },
            ]}
          >
            {stay.status === "CHECKED_IN"
              ? "Hospedado"
              : stay.status === "CONFIRMED"
              ? "Confirmada"
              : "Finalizada"}
          </Text>
        </View>
      </View>

      {/* Pet + Owner — un solo card */}
      <View style={styles.card}>
        {/* Owner strip (compacto) */}
        <View style={styles.ownerStrip}>
          <Ionicons
            name="person-circle-outline"
            size={20}
            color={COLORS.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.ownerStripName}>
              {formatName(stay.owner?.firstName ?? "")} {formatName(stay.owner?.lastName ?? "")}
            </Text>
            <Text style={styles.ownerStripContact} numberOfLines={1}>
              {[
                displayEmail(stay.owner?.email) || NO_EMAIL_LABEL,
                stay.owner?.phone ? formatPhoneInput(stay.owner.phone) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
        </View>

        {stay.medicationNotes && (
          <View style={styles.medicationBanner}>
            <Ionicons name="medkit" size={16} color={COLORS.errorText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.medicationTitle}>Medicamento</Text>
              <Text style={styles.medicationNotes}>{stay.medicationNotes}</Text>
            </View>
          </View>
        )}

        <View style={styles.cardDivider} />

        <View style={styles.petProfileRow}>
          {stay.pet?.photoUrl ? (
            <Image
              source={{ uri: cloudinaryResized(stay.pet.photoUrl, 210, "fill") }}
              style={styles.petPhoto}
            />
          ) : (
            <View style={[styles.petPhoto, styles.petPhotoPlaceholder]}>
              <Ionicons name="paw" size={28} color={COLORS.border} />
            </View>
          )}
          <View style={styles.petDetails}>
            <Text style={styles.petBreed}>
              {stay.pet?.breed || "Sin raza"} — {stay.pet?.size ?? "—"}
            </Text>
            {stay.pet?.weight && (
              <Text style={styles.petDetail}>{stay.pet.weight} kg</Text>
            )}
            {petAge !== null && (
              <Text style={styles.petDetail}>
                {petAge} {petAge === 1 ? "año" : "años"}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.editPetButton}
            onPress={() =>
              router.push({
                pathname: "/pet/create",
                params: { editId: stay.pet?.id },
              } as any)
            }
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={16} color={COLORS.primary} />
            <Text style={styles.editPetButtonText}>Editar</Text>
          </TouchableOpacity>
        </View>
        {stay.pet?.notes && (
          <View style={styles.notesBox}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textTertiary} />
            <Text style={styles.notesText}>{stay.pet?.notes}</Text>
          </View>
        )}

        {/* Vaccines */}
        {(stay.pet?.vaccines?.length ?? 0) > 0 && (
          <View style={styles.vaccinesSection}>
            <Text style={styles.subsectionTitle}>Vacunas</Text>
            {(stay.pet?.vaccines ?? []).map((v) => {
              const isExpired = v.expiresAt && new Date(v.expiresAt) < new Date();
              const isExpiring =
                v.expiresAt &&
                !isExpired &&
                new Date(v.expiresAt).getTime() - Date.now() < 30 * 86_400_000;
              return (
                <View key={v.id} style={styles.vaccineRow}>
                  <Ionicons
                    name="shield-checkmark"
                    size={16}
                    color={isExpired ? COLORS.errorText : isExpiring ? COLORS.warningText : COLORS.successText}
                  />
                  <Text style={styles.vaccineName}>{v.name}</Text>
                  {v.expiresAt && (
                    <Text
                      style={[
                        styles.vaccineDate,
                        { color: isExpired ? COLORS.errorText : isExpiring ? COLORS.warningText : COLORS.textTertiary },
                      ]}
                    >
                      {formatDayShortYear(v.expiresAt)}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Stay info */}
        <View style={styles.stayInfoRow}>
          <View style={styles.stayInfoItem}>
            <Text style={styles.stayInfoLabel}>Entrada</Text>
            <Text style={styles.stayInfoValue}>
              {stay.checkIn
                ? formatDayShort(stay.checkIn)
                : "—"}
            </Text>
            {stay.checkInTime && (
              <Text style={styles.stayInfoTime}>
                {formatTimeHHmm(stay.checkInTime)}
              </Text>
            )}
          </View>
          <View style={styles.stayInfoItem}>
            <Text style={styles.stayInfoLabel}>Salida</Text>
            <Text style={styles.stayInfoValue}>
              {stay.checkOut
                ? formatDayShort(stay.checkOut)
                : "—"}
            </Text>
            {stay.checkOutTime && (
              <Text style={styles.stayInfoTime}>
                {formatTimeHHmm(stay.checkOutTime)}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.stayInfoItem}
            onPress={() => setRoomModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.stayInfoLabel}>Cuarto</Text>
            <View style={styles.roomValueRow}>
              <Text style={styles.stayInfoValue}>
                {stay.room?.name ?? "Asignar"}
              </Text>
              <Ionicons
                name={stay.room ? "pencil" : "add-circle"}
                size={12}
                color={COLORS.primary}
              />
            </View>
          </TouchableOpacity>
        </View>

        {/* Baño contratado */}
        {(() => {
          const bath = stay.addons?.find(
            (a) => a.variant?.serviceType?.code === "BATH"
          );
          if (!bath) return null;
          const extras: string[] = [];
          if (bath.variant?.deslanado) extras.push("Deslanado");
          if (bath.variant?.corte) extras.push("Corte");
          const label = extras.length > 0 ? extras.join(" + ") : "Estándar";
          const isCompleted = !!bath.completedAt;
          return (
            <View style={styles.bathSection}>
              <View style={styles.bathRow}>
                <Ionicons
                  name="water"
                  size={16}
                  color={isCompleted ? COLORS.successText : COLORS.primary}
                />
                <Text style={styles.bathLabel}>
                  {isCompleted ? "Baño completado" : "Baño al check-out"}
                </Text>
                <Text style={styles.bathDetail}>{label}</Text>
                <Text style={styles.bathPrice}>
                  {formatCurrency(bath.unitPrice)}
                </Text>
              </View>
              {!isCompleted && stay.status === "CHECKED_IN" && (
                <TouchableOpacity
                  style={styles.completeBathButton}
                  onPress={() =>
                    Alert.alert(
                      "Foto del baño",
                      `Sube una foto de ${formatName(stay.pet?.name ?? "—")} bañado para completar.`,
                      [
                        { text: "Cancelar", style: "cancel" },
                        { text: "Tomar foto", onPress: () => handleCompleteBathAddon(bath.id, "camera") },
                        { text: "Elegir foto", onPress: () => handleCompleteBathAddon(bath.id, "library") },
                      ],
                    )
                  }
                  disabled={completingBathId === bath.id || completeAddonMutation.isPending}
                >
                  {completingBathId === bath.id ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color={COLORS.white} />
                      <Text style={styles.completeBathText}>Marcar completado</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {isCompleted && (
                <Text style={styles.bathCompletedDate}>
                  Completado el {formatDateTimeShort(bath.completedAt!)}
                </Text>
              )}
            </View>
          );
        })()}
      </View>

      {/* Saldo pendiente — card propia con desglose de anticipo */}
      {(() => {
        if (stay.status === "CANCELLED") return null;
        const payments = stay.payments ?? [];
        const depositPaid = payments
          .filter((p) => p.status === "PARTIAL")
          .reduce((sum, p) => sum + Number(p.amount), 0);
        const otherPaid = payments
          .filter((p) => p.status === "PAID")
          .reduce((sum, p) => sum + Number(p.amount), 0);
        const totalPaid = depositPaid + otherPaid;
        const total = Number(stay.totalAmount);
        const balance = Math.max(0, total - totalPaid);
        if (balance <= 0.01) return null;
        return (
          <View style={styles.payCard}>
            <View style={styles.payHeader}>
              <Ionicons name="cash" size={18} color={COLORS.warningText} />
              <Text style={styles.payTitle}>Saldo pendiente</Text>
              <Text style={styles.payTotal}>
                {formatCurrency(balance)}
              </Text>
            </View>

            <View style={styles.payBreakdown}>
              <View style={styles.payRow}>
                <Text style={styles.payRowLabel}>Total estancia</Text>
                <Text style={styles.payRowValue}>
                  {formatCurrency(total)}
                </Text>
              </View>
              {depositPaid > 0 && (
                <View style={styles.payRow}>
                  <Text style={styles.payRowLabel}>Anticipo pagado</Text>
                  <Text style={styles.payRowValueDiscount}>
                    −{formatCurrency(depositPaid)}
                  </Text>
                </View>
              )}
              {otherPaid > 0 && (
                <View style={styles.payRow}>
                  <Text style={styles.payRowLabel}>Pagos posteriores</Text>
                  <Text style={styles.payRowValueDiscount}>
                    −{formatCurrency(otherPaid)}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.registerPaymentBtn}
              onPress={() => {
                setPaymentInitialAmount(balance.toFixed(2));
                setPaymentModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="add-circle-outline"
                size={16}
                color={COLORS.primary}
              />
              <Text style={styles.registerPaymentText}>
                Registrar pago manual
              </Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Action Buttons */}
      {(stay.status === "CONFIRMED" || stay.status === "CHECKED_IN") &&
        !stay.staffId && (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: COLORS.primary }]}
          onPress={() =>
            Alert.alert("Asignarte", "¿Quieres ser responsable de esta estancia?", [
              { text: "Cancelar", style: "cancel" },
              { text: "Sí, asignarme", onPress: () => assignMutation.mutate() },
            ])
          }
          disabled={assignMutation.isPending}
        >
          <Ionicons name="person-add" size={20} color={COLORS.white} />
          <Text style={styles.actionButtonText}>Asignarme como responsable</Text>
        </TouchableOpacity>
      )}

      {stay.status === "CONFIRMED" && isAssignedToMe && (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: COLORS.successText }]}
          onPress={() =>
            Alert.alert("Check-in", "¿Confirmar el ingreso de la mascota?", [
              { text: "Cancelar", style: "cancel" },
              { text: "Confirmar", onPress: () => checkinMutation.mutate() },
            ])
          }
          disabled={checkinMutation.isPending}
        >
          <Ionicons name="log-in-outline" size={20} color={COLORS.white} />
          <Text style={styles.actionButtonText}>Hacer check-in</Text>
        </TouchableOpacity>
      )}

      {/* Comportamiento + Alertas — lado a lado */}
      <View style={styles.sideBySideRow}>
        <View style={[styles.section, styles.sideCol]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Comportamiento</Text>
            {stay.status === "CHECKED_IN" && (
              <TouchableOpacity onPress={() => setTagModalVisible(true)}>
                <Ionicons name="add-circle" size={24} color={COLORS.primary} />
              </TouchableOpacity>
            )}
          </View>
          {(stay.pet?.behaviorTags?.length ?? 0) === 0 ? (
            <Text style={styles.emptyText}>Sin etiquetas</Text>
          ) : (
            <View style={styles.tagsRow}>
              {(stay.pet?.behaviorTags ?? []).map((bt) => (
                <BehaviorTagPill
                  key={bt.id}
                  tag={bt.tag}
                  notes={bt.notes}
                  onDelete={
                    stay.status === "CHECKED_IN"
                      ? () => handleDeleteTag(bt.id, bt.tag)
                      : undefined
                  }
                />
              ))}
            </View>
          )}
        </View>

        {stay.status === "CHECKED_IN" && (
          <View style={[styles.section, styles.sideCol]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Alertas</Text>
              <TouchableOpacity onPress={() => setAlertModalVisible(true)}>
                <Ionicons name="warning" size={22} color={COLORS.warningText} />
              </TouchableOpacity>
            </View>
            {stay.alerts.length === 0 ? (
              <Text style={styles.emptyText}>Sin alertas</Text>
            ) : (
              stay.alerts.map((a) => (
                <View
                  key={a.id}
                  style={[
                    styles.alertRow,
                    {
                      backgroundColor: a.isResolved ? COLORS.bgSection : COLORS.warningBg,
                    },
                  ]}
                >
                  <Ionicons
                    name={a.isResolved ? "checkmark-circle" : "alert-circle"}
                    size={18}
                    color={a.isResolved ? COLORS.successText : COLORS.warningText}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertType}>
                      {ALERT_TYPES.find((t) => t.key === a.type)?.label ?? a.type}
                    </Text>
                    <Text style={styles.alertDesc}>{a.description}</Text>
                  </View>
                  {!a.isResolved && (
                    <TouchableOpacity
                      style={styles.resolveButton}
                      onPress={() =>
                        Alert.alert("Resolver alerta", "¿Marcar como resuelta?", [
                          { text: "Cancelar", style: "cancel" },
                          { text: "Resolver", onPress: () => resolveAlertMutation.mutate(a.id) },
                        ])
                      }
                      disabled={resolveAlertMutation.isPending}
                    >
                      <Ionicons name="checkmark" size={16} color={COLORS.successText} />
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}

            {/* Aviso si aún no hay reporte de hoy */}
            {!todayChecklist && (
              <View style={styles.missingReportBanner}>
                <Ionicons name="document-text-outline" size={18} color={COLORS.warningText} />
                <Text style={styles.missingReportText}>
                  Aún no se ha completado el reporte de hoy
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Historial de reportes — botón a pantalla dedicada */}
      {stay.checklists.length > 0 && (
        <TouchableOpacity
          style={styles.checklistsCard}
          onPress={() =>
            router.push(`/reservation/checklists/${stay.id}` as any)
          }
          activeOpacity={0.85}
          testID="staff-stay-checklists-link"
        >
          <View style={styles.checklistsIcon}>
            <Ionicons name="document-text" size={22} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checklistsTitle}>Historial de reportes</Text>
            <Text style={styles.checklistsSubtitle}>
              {stay.checklists.length}{" "}
              {stay.checklists.length === 1 ? "reporte" : "reportes"} de la estancia
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
        </TouchableOpacity>
      )}

      {/* Incidentes — botón a pantalla dedicada */}
      <TouchableOpacity
        style={styles.checklistsCard}
        onPress={() =>
          router.push(`/pet/incidents/${stay.pet?.id}` as any)
        }
        activeOpacity={0.85}
        testID="staff-stay-incidents-link"
      >
        <View style={styles.checklistsIcon}>
          <Ionicons name="alert-circle" size={22} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.checklistsTitle}>Incidentes</Text>
          <Text style={styles.checklistsSubtitle}>
            Historial de alertas de {formatName(stay.pet?.name ?? "—")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
      </TouchableOpacity>

      {/* Cobros pendientes al recoger (extensiones aprobadas) */}
      {stay.status === "CHECKED_IN" &&
        (stay.changeRequests ?? [])
          .filter(
            (cr) =>
              cr.status === "APPROVED" &&
              Number(cr.deltaAmount) > 0 &&
              cr.payOnPickup &&
              !cr.paidAt,
          )
          .map((cr) => (
            <TouchableOpacity
              key={cr.id}
              style={styles.pickupChargeBtn}
              onPress={() =>
                Alert.alert(
                  "Confirmar pago",
                  `¿Recibiste ${formatCurrency(cr.deltaAmount)} de ${formatName(stay.pet?.name ?? "—")} por la extensión?`,
                  [
                    { text: "Cancelar", style: "cancel" },
                    {
                      text: "Sí, recibido",
                      onPress: () => confirmPickupPaidMutation.mutate(cr.id),
                    },
                  ],
                )
              }
              disabled={confirmPickupPaidMutation.isPending}
            >
              <Ionicons name="cash-outline" size={18} color={COLORS.warningText} />
              <Text style={styles.pickupChargeBtnText}>
                Cobrar {formatCurrency(cr.deltaAmount)} al recoger (extensión)
              </Text>
            </TouchableOpacity>
          ))}

      {/* Acciones — última opción de la pantalla */}
      {stay.status === "CHECKED_IN" && (
        <>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButtonSmall, { backgroundColor: COLORS.primary }]}
              onPress={() =>
                router.push(`/(staff)/checklist/${stay.id}` as any)
              }
            >
              <Ionicons name="document-text-outline" size={18} color={COLORS.white} />
              <Text style={styles.actionButtonSmallText}>
                {todayChecklist ? "Ver reporte" : "Llenar reporte"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButtonSmall, { backgroundColor: COLORS.warningText }]}
              onPress={() => {
                const warnings: string[] = [];
                if (!todayChecklist) warnings.push("No hay reporte diario de hoy");
                if (todayUpdates.length === 0) warnings.push("No hay evidencias de hoy");
                const unresolvedAlerts = stay.alerts.filter((a) => !a.isResolved);
                if (unresolvedAlerts.length > 0)
                  warnings.push(`${unresolvedAlerts.length} alerta(s) sin resolver`);

                if (warnings.length > 0) {
                  Alert.alert(
                    "Check-out con pendientes",
                    `Antes de finalizar:\n\n• ${warnings.join("\n• ")}\n\n¿Deseas continuar de todos modos?`,
                    [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Continuar",
                        style: "destructive",
                        onPress: () => checkoutMutation.mutate(),
                      },
                    ]
                  );
                } else {
                  Alert.alert("Check-out", "¿Finalizar la estancia?", [
                    { text: "Cancelar", style: "cancel" },
                    {
                      text: "Finalizar",
                      style: "destructive",
                      onPress: () => checkoutMutation.mutate(),
                    },
                  ]);
                }
              }}
              disabled={checkoutMutation.isPending}
            >
              <Ionicons name="log-out-outline" size={18} color={COLORS.white} />
              <Text style={styles.actionButtonSmallText}>Check-out</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: COLORS.primary, marginTop: 12 },
            ]}
            onPress={handleUploadEvidence}
            disabled={uploadingEvidence}
          >
            {uploadingEvidence ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={20} color={COLORS.white} />
                <Text style={styles.actionButtonText}>Subir evidencia</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}

      <View style={{ height: 40 }} />

      {/* Alert Modal */}
      <Modal
        visible={alertModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setAlertModalVisible(false);
          setAlertDescription("");
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            setAlertModalVisible(false);
            setAlertDescription("");
          }}
        >
          <KeyboardAvoidingView
            style={styles.modalKav}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <Pressable
              style={[styles.modalContent, { maxHeight: "85%" }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Reportar alerta</Text>
                <TouchableOpacity
                  onPress={() => {
                    setAlertModalVisible(false);
                    setAlertDescription("");
                  }}
                  hitSlop={12}
                  testID="alert-modal-close"
                >
                  <Ionicons name="close" size={24} color={COLORS.textTertiary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalDescription}>
                Reporta cualquier incidente, conducta inusual o problema de salud durante la estancia. El admin recibe la alerta y queda registrada en el historial de la mascota.
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 12, flexGrow: 0 }}
              >
                {ALERT_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[
                      styles.alertTypeChip,
                      alertType === t.key && styles.alertTypeChipActive,
                    ]}
                    onPress={() => setAlertType(t.key)}
                  >
                    <Ionicons
                      name={t.icon as any}
                      size={16}
                      color={alertType === t.key ? COLORS.white : COLORS.textTertiary}
                    />
                    <Text
                      style={[
                        styles.alertTypeChipText,
                        alertType === t.key && { color: COLORS.white },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TextInput
                style={styles.textArea}
                placeholder="Describe la situación..."
                placeholderTextColor={COLORS.textDisabled}
                value={alertDescription}
                onChangeText={setAlertDescription}
                multiline
                numberOfLines={4}
                testID="alert-description-input"
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalButtonCancel}
                  onPress={() => {
                    setAlertModalVisible(false);
                    setAlertDescription("");
                  }}
                >
                  <Text style={styles.modalButtonCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButtonConfirm,
                    !alertDescription.trim() && { opacity: 0.5 },
                  ]}
                  onPress={() => alertMutation.mutate()}
                  disabled={!alertDescription.trim() || alertMutation.isPending}
                >
                  <Text style={styles.modalButtonConfirmText}>Enviar alerta</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Tag Modal */}
      <Modal
        visible={tagModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setTagModalVisible(false);
          setSelectedTagKey(null);
          setTagNotes("");
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            setTagModalVisible(false);
            setSelectedTagKey(null);
            setTagNotes("");
          }}
        >
          <KeyboardAvoidingView
            style={styles.modalKav}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <Pressable
              style={[styles.modalContent, { maxHeight: "85%" }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Agregar etiqueta</Text>
                <TouchableOpacity
                  onPress={() => {
                    setTagModalVisible(false);
                    setSelectedTagKey(null);
                    setTagNotes("");
                  }}
                  hitSlop={12}
                  testID="tag-modal-close"
                >
                  <Ionicons name="close" size={24} color={COLORS.textTertiary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalDescription}>
                Las etiquetas describen la personalidad y conducta del peludito según lo que observas durante la estancia. Sirven al equipo en visitas futuras y se acumulan en su historial.
              </Text>
              <View style={styles.tagsGrid}>
                {BEHAVIOR_TAGS.map((bt) => {
                  const isSelected = selectedTagKey === bt.key;
                  return (
                    <TouchableOpacity
                      key={bt.key}
                      style={[
                        styles.tagOption,
                        isSelected && styles.tagOptionSelected,
                      ]}
                      onPress={() => setSelectedTagKey(bt.key)}
                      disabled={tagMutation.isPending}
                    >
                      <BehaviorTagPill tag={bt.key} />
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selectedTagKey && (
                <>
                  <Text style={styles.tagNotesLabel}>
                    Comentario (opcional)
                  </Text>
                  <TextInput
                    style={styles.textArea}
                    placeholder="Ej: Solo es agresivo si le vas a dar la comida"
                    placeholderTextColor={COLORS.textDisabled}
                    value={tagNotes}
                    onChangeText={setTagNotes}
                    multiline
                    numberOfLines={3}
                  />
                </>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalButtonCancel}
                  onPress={() => {
                    setTagModalVisible(false);
                    setSelectedTagKey(null);
                    setTagNotes("");
                  }}
                >
                  <Text style={styles.modalButtonCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButtonConfirm,
                    !selectedTagKey && { opacity: 0.5 },
                  ]}
                  onPress={() =>
                    selectedTagKey &&
                    tagMutation.mutate({
                      tag: selectedTagKey,
                      notes: tagNotes.trim() || null,
                    })
                  }
                  disabled={!selectedTagKey || tagMutation.isPending}
                >
                  <Text style={styles.modalButtonConfirmText}>Guardar</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Modal de pago manual (estilo admin/baño) */}
      <PaymentManualModal
        visible={paymentModalVisible}
        onClose={closePaymentModal}
        submitting={manualPaymentMutation.isPending}
        initialAmount={paymentInitialAmount}
        onSubmit={(values) => manualPaymentMutation.mutate(values)}
      />

      {/* Room Picker Modal */}
      <SelectionListModal
        variant="pressable"
        visible={roomModalVisible}
        onClose={() => setRoomModalVisible(false)}
        title="Asignar cuarto"
        subtitle={`Solo se muestran cuartos para el tamaño de ${formatName(stay.pet?.name ?? "la mascota")}.`}
        data={roomList}
        emptyText="No hay cuartos para el tamaño de esta mascota."
        keyExtractor={(r) => r.id}
        isItemSelected={(r) => stay.room?.id === r.id}
        isItemPending={(r) =>
          assignRoomMutation.isPending && assignRoomMutation.variables === r.id
        }
        styles={{
          overlay: styles.modalOverlay,
          content: styles.modalContent,
          header: styles.modalHeader,
          title: styles.modalTitle,
          subtitle: styles.modalDescription,
          listMaxHeight: ROOM_LIST_MAX_HEIGHT,
          empty: styles.modalDescription,
        }}
        renderItem={(r, { selected: isCurrent, pending: isPending }) => (
          <TouchableOpacity
            style={styles.roomRow}
            onPress={() => {
              assignRoomMutation.mutate(r.id);
              setRoomModalVisible(false);
            }}
            disabled={isCurrent || assignRoomMutation.isPending}
            activeOpacity={0.7}
          >
            <Ionicons name="bed-outline" size={18} color={COLORS.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.roomRowName} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={styles.roomRowSub} numberOfLines={1}>
                Capacidad {r.capacity}
              </Text>
            </View>
            {isPending ? (
              <ActivityIndicator color={COLORS.primary} size="small" />
            ) : isCurrent ? (
              <Text style={styles.roomRowCurrent}>Asignado</Text>
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

    </ScrollView>
    {/* Confirmación de éxito no bloqueante. */}
    {banner}
    </>
  );
}
