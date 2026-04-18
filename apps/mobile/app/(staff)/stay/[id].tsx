import { COLORS } from "@/constants/colors";
import { useState } from "react";
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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  resolveStaffAlert,
  completeAddon,
} from "@/lib/api";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { ChecklistSummaryCard } from "@/components/ChecklistSummaryCard";
import { BehaviorTagPill } from "@/components/BehaviorTagPill";
import type { AlertType, BehaviorTagValue } from "@holidoginn/shared";

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.userId);

  const [alertModalVisible, setAlertModalVisible] = useState(false);
  const [alertType, setAlertType] = useState<AlertType>("NOT_EATING");
  const [alertDescription, setAlertDescription] = useState("");
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const { data: stay, isLoading, refetch } = useQuery({
    queryKey: ["staff", "stay", id],
    queryFn: () => getStaffStayById(id!),
    enabled: !!id,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["staff"] });
  };

  const assignMutation = useMutation({
    mutationFn: () => assignStay(id!),
    onSuccess: () => {
      invalidateAll();
      Alert.alert("Listo", "Te has asignado como responsable");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const checkinMutation = useMutation({
    mutationFn: () => staffCheckin(id!),
    onSuccess: () => {
      invalidateAll();
      Alert.alert("Check-in realizado", "Se notificó al dueño");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: () => staffCheckout(id!),
    onSuccess: (data) => {
      invalidateAll();
      if (data.warnings.length > 0) {
        Alert.alert(
          "Check-out con advertencias",
          data.warnings.join("\n")
        );
      } else {
        Alert.alert("Check-out realizado", "Se notificó al dueño");
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
      invalidateAll();
      setAlertModalVisible(false);
      setAlertDescription("");
      Alert.alert("Alerta enviada", "Se notificó a los administradores");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const tagMutation = useMutation({
    mutationFn: (tag: BehaviorTagValue) =>
      addBehaviorTag({
        tag,
        notes: null,
        stayId: id!,
        petId: stay!.petId,
      }),
    onSuccess: () => {
      invalidateAll();
      setTagModalVisible(false);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const resolveAlertMutation = useMutation({
    mutationFn: (alertId: string) => resolveStaffAlert(alertId),
    onSuccess: () => {
      invalidateAll();
      Alert.alert("Listo", "Alerta marcada como resuelta");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const completeAddonMutation = useMutation({
    mutationFn: (addonId: string) => completeAddon(addonId),
    onSuccess: () => {
      invalidateAll();
      Alert.alert("Listo", "Baño marcado como completado");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

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
      invalidateAll();
      Alert.alert("Listo", "Evidencia subida correctamente");
    } catch (error: any) {
      Alert.alert("Error", error.message || "No se pudo subir la evidencia");
    } finally {
      setUploadingEvidence(false);
    }
  };

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
  const todayChecklist = stay.checklists.find(
    (c) => new Date(c.date).toDateString() === todayStart.toDateString()
  );
  const todayUpdates = stay.updates.filter(
    (u) => new Date(u.createdAt) >= todayStart
  );
  const todayPhotos = todayUpdates.filter((u) => u.mediaType === "image");
  const todayVideos = todayUpdates.filter((u) => u.mediaType === "video");

  const petAge = stay.pet.birthDate
    ? Math.floor(
        (Date.now() - new Date(stay.pet.birthDate).getTime()) /
          (365.25 * 86_400_000)
      )
    : null;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refetch} tintColor={COLORS.primary} />
      }
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerInfo}>
          <Text style={styles.petName}>{stay.pet.name}</Text>
          <Text style={styles.ownerName}>
            {stay.owner.firstName} {stay.owner.lastName}
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

      {/* Owner Contact / Emergency Info */}
      <View style={styles.ownerCard}>
        <View style={styles.ownerCardHeader}>
          <Ionicons name="person-circle-outline" size={20} color={COLORS.primary} />
          <Text style={styles.ownerCardTitle}>Datos del dueño</Text>
        </View>
        <View style={styles.ownerRow}>
          <Ionicons name="person-outline" size={14} color={COLORS.textTertiary} />
          <Text style={styles.ownerDetail}>
            {stay.owner.firstName} {stay.owner.lastName}
          </Text>
        </View>
        <View style={styles.ownerRow}>
          <Ionicons name="mail-outline" size={14} color={COLORS.textTertiary} />
          <Text style={styles.ownerDetail}>{stay.owner.email}</Text>
        </View>
        {stay.owner.phone && (
          <View style={styles.ownerRow}>
            <Ionicons name="call-outline" size={14} color={COLORS.textTertiary} />
            <Text style={styles.ownerDetail}>{stay.owner.phone}</Text>
          </View>
        )}
        {stay.medicationNotes && (
          <View style={styles.medicationBanner}>
            <Ionicons name="medkit" size={16} color={COLORS.errorText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.medicationTitle}>Medicamento</Text>
              <Text style={styles.medicationNotes}>{stay.medicationNotes}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Pet Profile */}
      <View style={styles.card}>
        <View style={styles.petProfileRow}>
          {stay.pet.photoUrl ? (
            <Image
              source={{ uri: stay.pet.photoUrl }}
              style={styles.petPhoto}
            />
          ) : (
            <View style={[styles.petPhoto, styles.petPhotoPlaceholder]}>
              <Ionicons name="paw" size={28} color={COLORS.border} />
            </View>
          )}
          <View style={styles.petDetails}>
            <Text style={styles.petBreed}>
              {stay.pet.breed || "Sin raza"} — {stay.pet.size}
            </Text>
            {stay.pet.weight && (
              <Text style={styles.petDetail}>{stay.pet.weight} kg</Text>
            )}
            {petAge !== null && (
              <Text style={styles.petDetail}>
                {petAge} {petAge === 1 ? "año" : "años"}
              </Text>
            )}
          </View>
        </View>
        {stay.pet.notes && (
          <View style={styles.notesBox}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textTertiary} />
            <Text style={styles.notesText}>{stay.pet.notes}</Text>
          </View>
        )}

        {/* Vaccines */}
        {stay.pet.vaccines.length > 0 && (
          <View style={styles.vaccinesSection}>
            <Text style={styles.subsectionTitle}>Vacunas</Text>
            {stay.pet.vaccines.map((v) => {
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
                      {new Date(v.expiresAt).toLocaleDateString("es-MX", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
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
              {new Date(stay.checkIn).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
              })}
            </Text>
          </View>
          <View style={styles.stayInfoItem}>
            <Text style={styles.stayInfoLabel}>Salida</Text>
            <Text style={styles.stayInfoValue}>
              {new Date(stay.checkOut).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
              })}
            </Text>
          </View>
          <View style={styles.stayInfoItem}>
            <Text style={styles.stayInfoLabel}>Cuarto</Text>
            <Text style={styles.stayInfoValue}>
              {stay.room?.name ?? "—"}
            </Text>
          </View>
        </View>

        {/* Baño contratado */}
        {(() => {
          const bath = stay.addons?.find(
            (a) => a.variant.serviceType.code === "BATH"
          );
          if (!bath) return null;
          const extras: string[] = [];
          if (bath.variant.deslanado) extras.push("Deslanado");
          if (bath.variant.corte) extras.push("Corte");
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
                  ${Number(bath.unitPrice).toLocaleString("es-MX")}
                </Text>
              </View>
              {!isCompleted && stay.status === "CHECKED_IN" && (
                <TouchableOpacity
                  style={styles.completeBathButton}
                  onPress={() =>
                    Alert.alert("Completar baño", "¿Marcar el baño como realizado?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Completar", onPress: () => completeAddonMutation.mutate(bath.id) },
                    ])
                  }
                  disabled={completeAddonMutation.isPending}
                >
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.white} />
                  <Text style={styles.completeBathText}>Marcar completado</Text>
                </TouchableOpacity>
              )}
              {isCompleted && (
                <Text style={styles.bathCompletedDate}>
                  Completado el {new Date(bath.completedAt!).toLocaleDateString("es-MX", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              )}
            </View>
          );
        })()}
      </View>

      {/* Action Buttons */}
      {stay.status === "CONFIRMED" && !stay.staffId && (
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

      {stay.status === "CHECKED_IN" && (
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
      )}

      {/* Today's Checklist */}
      {stay.status === "CHECKED_IN" && todayChecklist && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reporte de hoy</Text>
          <ChecklistSummaryCard checklist={todayChecklist} />
        </View>
      )}

      {/* Evidence — all days */}
      {(stay.status === "CHECKED_IN" || stay.status === "CHECKED_OUT") && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Evidencias ({stay.updates.length} total)
            </Text>
            {stay.status === "CHECKED_IN" && (
              <TouchableOpacity
                onPress={handleUploadEvidence}
                disabled={uploadingEvidence}
              >
                {uploadingEvidence ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="add-circle" size={24} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            )}
          </View>
          {stay.updates.length === 0 ? (
            <Text style={styles.emptyText}>Sin evidencias</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {stay.updates.map((u) => (
                <View key={u.id} style={styles.evidenceItem}>
                  {u.mediaType === "image" ? (
                    <Image
                      source={{ uri: u.mediaUrl }}
                      style={styles.evidenceImage}
                    />
                  ) : (
                    <View style={[styles.evidenceImage, styles.videoPlaceholder]}>
                      <Ionicons name="videocam" size={28} color={COLORS.primary} />
                    </View>
                  )}
                  <Text style={styles.evidenceDate}>
                    {new Date(u.createdAt).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                    })}
                  </Text>
                  {u.caption && (
                    <Text style={styles.evidenceCaption} numberOfLines={1}>
                      {u.caption}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Behavior Tags */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Comportamiento</Text>
          {stay.status === "CHECKED_IN" && (
            <TouchableOpacity onPress={() => setTagModalVisible(true)}>
              <Ionicons name="add-circle" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
        {stay.pet.behaviorTags.length === 0 ? (
          <Text style={styles.emptyText}>Sin etiquetas</Text>
        ) : (
          <View style={styles.tagsRow}>
            {stay.pet.behaviorTags.map((bt) => (
              <BehaviorTagPill key={bt.id} tag={bt.tag} />
            ))}
          </View>
        )}
      </View>

      {/* Alerts */}
      {stay.status === "CHECKED_IN" && (
        <View style={styles.section}>
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
        </View>
      )}

      {/* Checklist History */}
      {stay.checklists.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Historial de reportes</Text>
          {stay.checklists.map((c) => (
            <ChecklistSummaryCard key={c.id} checklist={c} compact />
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />

      {/* Alert Modal */}
      <Modal visible={alertModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reportar alerta</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
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
          </View>
        </View>
      </Modal>

      {/* Tag Modal */}
      <Modal visible={tagModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Agregar etiqueta</Text>
            <View style={styles.tagsGrid}>
              {BEHAVIOR_TAGS.map((bt) => (
                <TouchableOpacity
                  key={bt.key}
                  style={styles.tagOption}
                  onPress={() => tagMutation.mutate(bt.key)}
                  disabled={tagMutation.isPending}
                >
                  <BehaviorTagPill tag={bt.key} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.modalButtonCancel}
              onPress={() => setTagModalVisible(false)}
            >
              <Text style={styles.modalButtonCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  headerInfo: {
    flex: 1,
  },
  petName: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  ownerName: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  petProfileRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 12,
  },
  petPhoto: {
    width: 70,
    height: 70,
    borderRadius: 14,
  },
  petPhotoPlaceholder: {
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
  },
  petDetails: {
    flex: 1,
    justifyContent: "center",
  },
  petBreed: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  petDetail: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  notesBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: COLORS.bgPage,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  notesText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
  },
  bathRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  bathLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  bathDetail: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  bathPrice: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  vaccinesSection: {
    marginTop: 4,
    marginBottom: 12,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  vaccineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  vaccineName: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  vaccineDate: {
    fontSize: 12,
  },
  stayInfoRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  stayInfoItem: {
    alignItems: "center",
  },
  stayInfoLabel: {
    fontSize: 11,
    color: COLORS.textDisabled,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  stayInfoValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 16,
  },
  actionButtonSmall: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
    borderRadius: 12,
  },
  actionButtonSmallText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "700",
  },
  section: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingVertical: 12,
  },
  evidenceItem: {
    marginRight: 10,
  },
  evidenceImage: {
    width: 100,
    height: 100,
    borderRadius: 10,
  },
  videoPlaceholder: {
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  evidenceCaption: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 4,
    width: 100,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  alertType: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  alertDesc: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  // Modal
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
    maxHeight: "60%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  alertTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.bgSection,
    marginRight: 8,
  },
  alertTypeChipActive: {
    backgroundColor: COLORS.warningText,
  },
  alertTypeChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  modalButtonCancel: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  modalButtonCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  modalButtonConfirm: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.warningText,
    alignItems: "center",
  },
  modalButtonConfirmText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.white,
  },
  tagsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  tagOption: {
    padding: 4,
  },
  // Owner contact card
  ownerCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  ownerCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  ownerCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 3,
  },
  ownerDetail: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  medicationBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.errorBg,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  medicationTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.errorText,
  },
  medicationNotes: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  // Bath section
  bathSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  completeBathButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.successText,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  completeBathText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.white,
  },
  bathCompletedDate: {
    fontSize: 12,
    color: COLORS.successText,
    marginTop: 6,
    fontStyle: "italic",
  },
  // Resolve alert button
  resolveButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  // Evidence date
  evidenceDate: {
    fontSize: 10,
    color: COLORS.textDisabled,
    marginTop: 3,
  },
});
