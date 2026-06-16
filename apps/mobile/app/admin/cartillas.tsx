import { COLORS } from "@/constants/colors";
import { ErrorState } from "@/components/ErrorState";
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  FlatList,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import ImageView from "react-native-image-viewing";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCartillas,
  reviewCartilla,
  getVaccineCatalog,
  updateAdminVaccine,
  deleteAdminVaccine,
  type CartillaStatusValue,
  type PetWithCartilla,
  type VaccineCatalogEntry,
  type ReviewCartillaPayload,
  type CartillaVaccine,
} from "@/lib/api";
import {
  formatName,
  formatPhoneInput,
  formatDayShort,
} from "@/lib/format";
import { styles } from "@/styles/cartillasStyles";
import { cloudinaryResized } from "@/lib/cloudinary";
import { VaccineCapture } from "@/components/cartilla/VaccineCapture";
import { DewormingCapture } from "@/components/cartilla/DewormingCapture";
import {
  addDays,
  clampDate,
  endOfToday,
  formatShort,
  DEWORMING_TYPES,
  type VaccineRow,
  type DewormingRow,
} from "@/components/cartilla/helpers";

const STATUS_TABS: { key: CartillaStatusValue; label: string }[] = [
  { key: "PENDING", label: "Pendientes" },
  { key: "APPROVED", label: "Aprobadas" },
  { key: "REJECTED", label: "Rechazadas" },
  { key: "EXPIRED", label: "Vencidas" },
];

export default function AdminCartillas() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CartillaStatusValue>("PENDING");
  const [selectedPet, setSelectedPet] = useState<PetWithCartilla | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [zoomImages, setZoomImages] = useState<string[]>([]);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [zoomVisible, setZoomVisible] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(null), 2000);
    return () => clearTimeout(t);
  }, [successMessage]);
  const openZoom = (photos: string[], index: number) => {
    setZoomImages(photos);
    setZoomIndex(index);
    setZoomVisible(true);
  };

  // Captura de vacunas al aprobar.
  const [capturing, setCapturing] = useState(false);
  const [vaccineRows, setVaccineRows] = useState<VaccineRow[]>([]);
  const [catalogPickerForRow, setCatalogPickerForRow] = useState<number | null>(null);

  // Captura de desparasitaciones al aprobar.
  const [dewormingRows, setDewormingRows] = useState<DewormingRow[]>([]);

  // Edición de vacuna existente.
  const [editingVaccineId, setEditingVaccineId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<VaccineRow | null>(null);
  const [editCatalogOpen, setEditCatalogOpen] = useState(false);
  const [editAppliedOpen, setEditAppliedOpen] = useState(false);
  const [editExpiresOpen, setEditExpiresOpen] = useState(false);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "cartillas", activeTab],
    queryFn: () => getCartillas(activeTab),
  });

  const { data: catalog } = useQuery({
    queryKey: ["vaccine-catalog"],
    queryFn: getVaccineCatalog,
  });
  const catalogById = new Map((catalog ?? []).map((c) => [c.id, c]));

  const reviewMutation = useMutation({
    mutationFn: ({
      petId,
      payload,
    }: {
      petId: string;
      payload: ReviewCartillaPayload;
    }) => reviewCartilla(petId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "cartillas"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      closeModal();
      if (variables.payload.action === "APPROVE") {
        const vCount = variables.payload.vaccines?.length ?? 0;
        const dCount = variables.payload.dewormings?.length ?? 0;
        const parts: string[] = [];
        if (vCount > 0) {
          parts.push(vCount === 1 ? "1 vacuna" : `${vCount} vacunas`);
        }
        if (dCount > 0) {
          parts.push(
            dCount === 1 ? "1 desparasitación" : `${dCount} desparasitaciones`
          );
        }
        setSuccessMessage(
          parts.length > 0
            ? `${parts.join(" y ")} agregada${
                vCount + dCount === 1 ? "" : "s"
              } correctamente`
            : "Cartilla aprobada"
        );
      }
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const invalidateAfterVaccineChange = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "cartillas"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "alerts"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    queryClient.invalidateQueries({ queryKey: ["pets"] });
  };

  const updateVaccineMutation = useMutation({
    mutationFn: ({
      vaccineId,
      payload,
    }: {
      vaccineId: string;
      payload: { catalogId?: string; appliedAt?: string; expiresAt?: string };
    }) => updateAdminVaccine(vaccineId, payload),
    onSuccess: async () => {
      invalidateAfterVaccineChange();
      // Refrescar el modal con la cartilla actualizada
      const fresh = await queryClient.fetchQuery({
        queryKey: ["admin", "cartillas", activeTab],
        queryFn: () => getCartillas(activeTab),
      });
      const refreshed = fresh?.find((p) => p.id === selectedPet?.id);
      if (refreshed) setSelectedPet(refreshed);
      cancelEdit();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const deleteVaccineMutation = useMutation({
    mutationFn: (vaccineId: string) => deleteAdminVaccine(vaccineId),
    onSuccess: async () => {
      invalidateAfterVaccineChange();
      const fresh = await queryClient.fetchQuery({
        queryKey: ["admin", "cartillas", activeTab],
        queryFn: () => getCartillas(activeTab),
      });
      const refreshed = fresh?.find((p) => p.id === selectedPet?.id);
      if (refreshed) setSelectedPet(refreshed);
      cancelEdit();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const cancelEdit = () => {
    setEditingVaccineId(null);
    setEditRow(null);
    setEditCatalogOpen(false);
    setEditAppliedOpen(false);
    setEditExpiresOpen(false);
  };

  const startEdit = (v: CartillaVaccine) => {
    setEditingVaccineId(v.id);
    setEditRow({
      catalogId: v.catalogId ?? null,
      appliedAt: new Date(v.appliedAt),
      expiresAt: v.expiresAt ? new Date(v.expiresAt) : new Date(),
    });
  };

  const saveEdit = () => {
    if (!editingVaccineId || !editRow) return;
    if (!editRow.catalogId) {
      Alert.alert("Selecciona un tipo", "Debes elegir el tipo de vacuna.");
      return;
    }
    updateVaccineMutation.mutate({
      vaccineId: editingVaccineId,
      payload: {
        catalogId: editRow.catalogId,
        appliedAt: editRow.appliedAt.toISOString(),
        expiresAt: editRow.expiresAt.toISOString(),
      },
    });
  };

  const confirmDelete = () => {
    if (!editingVaccineId) return;
    Alert.alert(
      "Eliminar vacuna",
      "¿Seguro que quieres eliminar esta vacuna? No se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteVaccineMutation.mutate(editingVaccineId),
        },
      ]
    );
  };

  const closeModal = () => {
    setSelectedPet(null);
    setRejecting(false);
    setRejectReason("");
    setCapturing(false);
    setVaccineRows([]);
    setCatalogPickerForRow(null);
    setDewormingRows([]);
    cancelEdit();
  };

  const startCapture = () => {
    setCapturing(true);
    setVaccineRows([]);
    setDewormingRows([]);
  };

  const updateRowCatalog = (index: number, catalogId: string) => {
    setVaccineRows((rows) =>
      rows.map((r, i) => {
        if (i !== index) return r;
        const cat = catalogById.get(catalogId);
        const expires = cat ? addDays(r.appliedAt, cat.defaultDurationDays) : r.expiresAt;
        return { ...r, catalogId, expiresAt: expires };
      })
    );
  };

  const submitApprove = () => {
    if (!selectedPet) return;

    const incompleteVaccine = vaccineRows.find((r) => !r.catalogId);
    if (incompleteVaccine) {
      Alert.alert("Datos incompletos", "Selecciona el tipo de vacuna en cada renglón.");
      return;
    }

    const payload: ReviewCartillaPayload = { action: "APPROVE" };
    if (vaccineRows.length > 0) {
      payload.vaccines = vaccineRows.map((r) => ({
        catalogId: r.catalogId!,
        appliedAt: r.appliedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      }));
    }
    if (dewormingRows.length > 0) {
      payload.dewormings = dewormingRows.map((r) => ({
        type: r.type,
        productName: r.productName.trim() || null,
        appliedAt: r.appliedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        notes: r.notes.trim() || null,
      }));
    }

    reviewMutation.mutate({ petId: selectedPet.id, payload });
  };

  return (
    <View style={styles.screen}>
      {/* Tabs */}
      <View style={styles.tabsRow}>
        {STATUS_TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === t.key && styles.tabTextActive,
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
        >
          {(data ?? []).length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons
                name="shield-checkmark-outline"
                size={40}
                color={COLORS.textDisabled}
              />
              <Text style={styles.emptyText}>
                {activeTab === "PENDING"
                  ? "No hay cartillas pendientes"
                  : activeTab === "APPROVED"
                  ? "Sin cartillas aprobadas aún"
                  : activeTab === "REJECTED"
                  ? "Sin cartillas rechazadas"
                  : "Sin cartillas vencidas"}
              </Text>
            </View>
          ) : (
            (data ?? []).map((pet) => (
              <TouchableOpacity
                key={pet.id}
                style={styles.card}
                onPress={() => setSelectedPet(pet)}
                activeOpacity={0.7}
              >
                {(() => {
                  const firstPhoto =
                    pet.cartillaPhotos?.[0] ?? pet.cartillaUrl ?? null;
                  const totalPhotos =
                    pet.cartillaPhotos && pet.cartillaPhotos.length > 0
                      ? pet.cartillaPhotos.length
                      : pet.cartillaUrl
                        ? 1
                        : 0;
                  if (!firstPhoto) {
                    return (
                      <View style={[styles.thumb, styles.thumbPlaceholder]}>
                        <Ionicons
                          name="document-outline"
                          size={28}
                          color={COLORS.border}
                        />
                      </View>
                    );
                  }
                  return (
                    <View>
                      <Image
                        source={{ uri: cloudinaryResized(firstPhoto, 192, "fill") }}
                        style={styles.thumb}
                      />
                      {totalPhotos > 1 && (
                        <View style={styles.thumbPhotoCount}>
                          <Ionicons name="copy-outline" size={10} color={COLORS.white} />
                          <Text style={styles.thumbPhotoCountText}>
                            {totalPhotos}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}
                <View style={styles.cardInfo}>
                  <Text style={styles.petName}>{formatName(pet.name)}</Text>
                  <Text style={styles.ownerName}>
                    {formatName(pet.owner?.firstName ?? "")} {formatName(pet.owner?.lastName ?? "")}
                  </Text>
                  {(() => {
                    const reviewedDate = pet.cartillaReviewedAt
                      ? formatDayShort(pet.cartillaReviewedAt)
                      : null;
                    let label: string;
                    switch (pet.cartillaStatus) {
                      case "APPROVED":
                        label = reviewedDate
                          ? `Aprobada ${reviewedDate}`
                          : "Aprobada";
                        break;
                      case "REJECTED":
                        label = reviewedDate
                          ? `Rechazada ${reviewedDate}`
                          : "Rechazada";
                        break;
                      case "EXPIRED":
                        label = "Vencida";
                        break;
                      default:
                        label = "Esperando revisión";
                    }
                    return <Text style={styles.metaText}>{label}</Text>;
                  })()}
                  {pet.cartillaRejectionReason && (
                    <Text style={styles.rejectionReason} numberOfLines={2}>
                      Motivo: {pet.cartillaRejectionReason}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={COLORS.textDisabled}
                />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* Review modal */}
      <Modal
        visible={!!selectedPet}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity style={styles.modalClose} onPress={closeModal}>
              <Ionicons name="close" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {selectedPet && (
              <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                <Text style={styles.modalTitle}>
                  Cartilla de {formatName(selectedPet.name)}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {formatName(selectedPet.owner?.firstName ?? "")} {formatName(selectedPet.owner?.lastName ?? "")}
                  {selectedPet.owner.phone ? ` · ${formatPhoneInput(selectedPet.owner.phone)}` : ""}
                </Text>

                {(() => {
                  const photos =
                    selectedPet.cartillaPhotos &&
                    selectedPet.cartillaPhotos.length > 0
                      ? selectedPet.cartillaPhotos
                      : selectedPet.cartillaUrl
                        ? [selectedPet.cartillaUrl]
                        : [];
                  if (photos.length === 0) return null;
                  if (photos.length === 1) {
                    return (
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => openZoom(photos, 0)}
                      >
                        <Image
                          source={{ uri: cloudinaryResized(photos[0], 1080, "fill") }}
                          style={styles.fullImage}
                          resizeMode="contain"
                        />
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      pagingEnabled
                      style={{ marginVertical: 8 }}
                    >
                      {photos.map((url, idx) => (
                        <View key={`${url}-${idx}`} style={styles.galleryPage}>
                          <TouchableOpacity
                            activeOpacity={0.9}
                            onPress={() => openZoom(photos, idx)}
                          >
                            <Image
                              source={{ uri: cloudinaryResized(url, 1080, "fill") }}
                              style={styles.galleryImage}
                              resizeMode="contain"
                            />
                          </TouchableOpacity>
                          <View style={styles.galleryIndex}>
                            <Text style={styles.galleryIndexText}>
                              {idx + 1} / {photos.length}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  );
                })()}

                {selectedPet.cartillaStatus === "REJECTED" &&
                  selectedPet.cartillaRejectionReason && (
                    <View style={styles.prevReasonBox}>
                      <Text style={styles.prevReasonLabel}>Motivo previo</Text>
                      <Text style={styles.prevReasonText}>
                        {selectedPet.cartillaRejectionReason}
                      </Text>
                    </View>
                  )}

                {/* Vacunas registradas */}
                {!capturing &&
                  !rejecting &&
                  !editingVaccineId &&
                  selectedPet.vaccines &&
                  selectedPet.vaccines.length > 0 && (
                    <View style={styles.vaccinesSection}>
                      <Text style={styles.vaccinesSectionTitle}>
                        Vacunas registradas ({selectedPet.vaccines.length})
                      </Text>
                      {selectedPet.vaccines.map((v) => {
                        const expires = v.expiresAt ? new Date(v.expiresAt) : null;
                        const now = new Date();
                        const daysToExpire = expires
                          ? Math.ceil(
                              (expires.getTime() - now.getTime()) / 86_400_000
                            )
                          : null;
                        const isExpired = daysToExpire !== null && daysToExpire < 0;
                        const isExpiringSoon =
                          daysToExpire !== null && daysToExpire >= 0 && daysToExpire <= 30;
                        const badgeColor = isExpired
                          ? COLORS.errorText
                          : isExpiringSoon
                          ? COLORS.warningText
                          : COLORS.successText;
                        const badgeBg = isExpired
                          ? COLORS.errorBg
                          : isExpiringSoon
                          ? COLORS.warningBg
                          : COLORS.successBg;
                        const badgeText = isExpired
                          ? `Vencida hace ${Math.abs(daysToExpire!)}d`
                          : isExpiringSoon
                          ? `Vence en ${daysToExpire}d`
                          : expires
                          ? `Vigente`
                          : `Sin vencimiento`;
                        return (
                          <TouchableOpacity
                            key={v.id}
                            style={styles.vaccineCard}
                            activeOpacity={0.7}
                            onPress={() => startEdit(v)}
                          >
                            <View style={styles.vaccineCardHeader}>
                              <Text style={styles.vaccineCardName}>
                                {v.catalog?.displayName ?? v.name}
                              </Text>
                              <View
                                style={[
                                  styles.vaccineBadge,
                                  { backgroundColor: badgeBg },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.vaccineBadgeText,
                                    { color: badgeColor },
                                  ]}
                                >
                                  {badgeText}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.vaccineCardRow}>
                              <Ionicons
                                name="calendar-outline"
                                size={14}
                                color={COLORS.textTertiary}
                              />
                              <Text style={styles.vaccineCardMeta}>
                                Aplicada {formatShort(new Date(v.appliedAt))}
                              </Text>
                            </View>
                            {expires && (
                              <View style={styles.vaccineCardRow}>
                                <Ionicons
                                  name="alarm-outline"
                                  size={14}
                                  color={COLORS.textTertiary}
                                />
                                <Text style={styles.vaccineCardMeta}>
                                  Vence {formatShort(expires)}
                                </Text>
                              </View>
                            )}
                            <View style={styles.vaccineCardEditHint}>
                              <Ionicons
                                name="create-outline"
                                size={12}
                                color={COLORS.textTertiary}
                              />
                              <Text style={styles.vaccineCardEditHintText}>
                                Toca para editar
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                {/* Desparasitaciones registradas */}
                {!capturing &&
                  !rejecting &&
                  !editingVaccineId &&
                  selectedPet.dewormings &&
                  selectedPet.dewormings.length > 0 && (
                    <View style={styles.vaccinesSection}>
                      <Text style={styles.vaccinesSectionTitle}>
                        Desparasitaciones registradas ({selectedPet.dewormings.length})
                      </Text>
                      {selectedPet.dewormings.map((d) => {
                        const expires = d.expiresAt ? new Date(d.expiresAt) : null;
                        const now = new Date();
                        const daysToExpire = expires
                          ? Math.ceil(
                              (expires.getTime() - now.getTime()) / 86_400_000
                            )
                          : null;
                        const isExpired = daysToExpire !== null && daysToExpire < 0;
                        const isExpiringSoon =
                          daysToExpire !== null && daysToExpire >= 0 && daysToExpire <= 30;
                        const badgeColor = isExpired
                          ? COLORS.errorText
                          : isExpiringSoon
                          ? COLORS.warningText
                          : COLORS.successText;
                        const badgeBg = isExpired
                          ? COLORS.errorBg
                          : isExpiringSoon
                          ? COLORS.warningBg
                          : COLORS.successBg;
                        const badgeText = isExpired
                          ? `Vencida hace ${Math.abs(daysToExpire!)}d`
                          : isExpiringSoon
                          ? `Vence en ${daysToExpire}d`
                          : expires
                          ? `Vigente`
                          : `Sin vencimiento`;
                        const typeLabel =
                          DEWORMING_TYPES.find((t) => t.key === d.type)?.label ?? d.type;
                        return (
                          <View key={d.id} style={styles.vaccineCard}>
                            <View style={styles.vaccineCardHeader}>
                              <Text style={styles.vaccineCardName}>
                                {typeLabel}
                                {d.productName ? ` · ${d.productName}` : ""}
                              </Text>
                              <View
                                style={[
                                  styles.vaccineBadge,
                                  { backgroundColor: badgeBg },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.vaccineBadgeText,
                                    { color: badgeColor },
                                  ]}
                                >
                                  {badgeText}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.vaccineCardRow}>
                              <Ionicons
                                name="calendar-outline"
                                size={14}
                                color={COLORS.textTertiary}
                              />
                              <Text style={styles.vaccineCardMeta}>
                                Aplicada {formatShort(new Date(d.appliedAt))}
                              </Text>
                            </View>
                            {expires && (
                              <View style={styles.vaccineCardRow}>
                                <Ionicons
                                  name="alarm-outline"
                                  size={14}
                                  color={COLORS.textTertiary}
                                />
                                <Text style={styles.vaccineCardMeta}>
                                  Próxima dosis {formatShort(expires)}
                                </Text>
                              </View>
                            )}
                            {d.notes ? (
                              <View style={styles.vaccineCardRow}>
                                <Ionicons
                                  name="document-text-outline"
                                  size={14}
                                  color={COLORS.textTertiary}
                                />
                                <Text style={styles.vaccineCardMeta} numberOfLines={2}>
                                  {d.notes}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  )}

                {/* Modo: editando una vacuna existente */}
                {editingVaccineId && editRow && (
                  <View style={{ marginTop: 14 }}>
                    <Text style={styles.captureTitle}>Editar vacuna</Text>
                    <Text style={styles.captureHint}>
                      Si cambias la fecha de vencimiento, los recordatorios push
                      se reinician para la nueva fecha.
                    </Text>

                    <View style={styles.vaccineRow}>
                      <Text style={styles.label}>Tipo</Text>
                      <TouchableOpacity
                        style={styles.selectRow}
                        onPress={() => setEditCatalogOpen(true)}
                      >
                        <Text
                          style={[
                            styles.selectText,
                            !editRow.catalogId && { color: COLORS.textDisabled },
                          ]}
                        >
                          {editRow.catalogId
                            ? catalogById.get(editRow.catalogId)?.displayName ??
                              "Tipo desconocido"
                            : "Selecciona el tipo"}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={COLORS.textTertiary}
                        />
                      </TouchableOpacity>

                      <Text style={styles.label}>Fecha aplicada</Text>
                      <TouchableOpacity
                        style={styles.selectRow}
                        onPress={() => setEditAppliedOpen(true)}
                      >
                        <Ionicons
                          name="calendar-outline"
                          size={18}
                          color={COLORS.primary}
                        />
                        <Text style={styles.selectText}>
                          {formatShort(editRow.appliedAt)}
                        </Text>
                      </TouchableOpacity>

                      <Text style={styles.label}>Fecha de vencimiento</Text>
                      <TouchableOpacity
                        style={styles.selectRow}
                        onPress={() => setEditExpiresOpen(true)}
                      >
                        <Ionicons
                          name="alarm-outline"
                          size={18}
                          color={COLORS.warningText}
                        />
                        <Text style={styles.selectText}>
                          {formatShort(editRow.expiresAt)}
                        </Text>
                      </TouchableOpacity>

                      {editAppliedOpen && (() => {
                        const max = endOfToday();
                        return (
                        <DateTimePicker
                          value={clampDate(editRow.appliedAt, undefined, max)}
                          mode="date"
                          display={Platform.OS === "ios" ? "spinner" : "default"}
                          themeVariant="light"
                          textColor={COLORS.textPrimary}
                          maximumDate={max}
                          onChange={(_, d) => {
                            setEditAppliedOpen(Platform.OS === "ios");
                            if (d && editRow) {
                              const cat = editRow.catalogId
                                ? catalogById.get(editRow.catalogId)
                                : undefined;
                              setEditRow({
                                ...editRow,
                                appliedAt: d,
                                expiresAt: cat
                                  ? addDays(d, cat.defaultDurationDays)
                                  : editRow.expiresAt,
                              });
                            }
                          }}
                        />
                        );
                      })()}
                      {Platform.OS === "ios" && editAppliedOpen && (
                        <TouchableOpacity
                          style={styles.pickerDone}
                          onPress={() => setEditAppliedOpen(false)}
                        >
                          <Text style={styles.pickerDoneText}>Listo</Text>
                        </TouchableOpacity>
                      )}

                      {editExpiresOpen && (
                        <DateTimePicker
                          value={clampDate(editRow.expiresAt, editRow.appliedAt)}
                          mode="date"
                          display={Platform.OS === "ios" ? "spinner" : "default"}
                          themeVariant="light"
                          textColor={COLORS.textPrimary}
                          minimumDate={editRow.appliedAt}
                          onChange={(_, d) => {
                            setEditExpiresOpen(Platform.OS === "ios");
                            if (d && editRow) {
                              setEditRow({ ...editRow, expiresAt: d });
                            }
                          }}
                        />
                      )}
                      {Platform.OS === "ios" && editExpiresOpen && (
                        <TouchableOpacity
                          style={styles.pickerDone}
                          onPress={() => setEditExpiresOpen(false)}
                        >
                          <Text style={styles.pickerDoneText}>Listo</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[styles.btn, styles.btnGhostDanger, { marginTop: 12 }]}
                      onPress={confirmDelete}
                      disabled={deleteVaccineMutation.isPending}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={COLORS.errorText}
                      />
                      <Text style={[styles.btnText, { color: COLORS.errorText }]}>
                        {deleteVaccineMutation.isPending
                          ? "Eliminando..."
                          : "Eliminar vacuna"}
                      </Text>
                    </TouchableOpacity>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={cancelEdit}
                      >
                        <Text style={[styles.btnText, { color: COLORS.textSecondary }]}>
                          Cancelar
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                        onPress={saveEdit}
                        disabled={updateVaccineMutation.isPending}
                      >
                        <Ionicons
                          name="save-outline"
                          size={18}
                          color={COLORS.white}
                        />
                        <Text style={[styles.btnText, { color: COLORS.white }]}>
                          {updateVaccineMutation.isPending ? "..." : "Guardar"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Modo: capturando vacunas */}
                {capturing && (
                  <View style={{ marginTop: 14 }}>
                    <VaccineCapture
                      key={`vc-${selectedPet?.id ?? "none"}`}
                      rows={vaccineRows}
                      onChange={setVaccineRows}
                      catalog={catalog ?? []}
                      onRequestCatalogPicker={setCatalogPickerForRow}
                    />

                    <DewormingCapture
                      key={`dc-${selectedPet?.id ?? "none"}`}
                      rows={dewormingRows}
                      onChange={setDewormingRows}
                    />

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={() => {
                          setCapturing(false);
                          setVaccineRows([]);
                          setDewormingRows([]);
                        }}
                      >
                        <Text style={[styles.btnText, { color: COLORS.textSecondary }]}>
                          Cancelar
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                        onPress={submitApprove}
                        disabled={reviewMutation.isPending}
                      >
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={18}
                          color={COLORS.white}
                        />
                        <Text style={[styles.btnText, { color: COLORS.white }]}>
                          {reviewMutation.isPending
                            ? "..."
                            : vaccineRows.length === 0 && dewormingRows.length === 0
                            ? "Aprobar sin capturar"
                            : "Aprobar y guardar"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Modo: rechazando */}
                {!capturing && rejecting && (
                  <View style={{ marginTop: 12, gap: 10 }}>
                    <Text style={styles.label}>Motivo (opcional)</Text>
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder="Ej: foto borrosa, vacunas vencidas..."
                      placeholderTextColor={COLORS.textDisabled}
                      multiline
                      numberOfLines={3}
                      style={styles.input}
                    />
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={() => {
                          setRejecting(false);
                          setRejectReason("");
                        }}
                      >
                        <Text style={[styles.btnText, { color: COLORS.textSecondary }]}>
                          Cancelar
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnDanger, { flex: 1 }]}
                        onPress={() =>
                          reviewMutation.mutate({
                            petId: selectedPet.id,
                            payload: {
                              action: "REJECT",
                              reason: rejectReason.trim() || undefined,
                            },
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        <Text style={[styles.btnText, { color: COLORS.white }]}>
                          {reviewMutation.isPending ? "..." : "Confirmar rechazo"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Modo: estado inicial (acciones disponibles) */}
                {!capturing &&
                  !rejecting &&
                  !editingVaccineId &&
                  selectedPet.cartillaStatus === "PENDING" && (
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={() => setRejecting(true)}
                      >
                        <Ionicons
                          name="close-circle-outline"
                          size={18}
                          color={COLORS.errorText}
                        />
                        <Text style={[styles.btnText, { color: COLORS.errorText }]}>
                          Rechazar
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                        onPress={startCapture}
                      >
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={18}
                          color={COLORS.white}
                        />
                        <Text style={[styles.btnText, { color: COLORS.white }]}>
                          Aprobar
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
              </ScrollView>
            )}

            {/* Picker del catálogo: overlay absoluto dentro del Modal */}
            {(catalogPickerForRow !== null || editCatalogOpen) && (
              <TouchableOpacity
                style={styles.pickerOverlay}
                activeOpacity={1}
                onPress={() => {
                  setCatalogPickerForRow(null);
                  setEditCatalogOpen(false);
                }}
              >
                <TouchableOpacity
                  style={styles.pickerCard}
                  activeOpacity={1}
                  onPress={() => {}}
                >
                  <Text style={styles.pickerTitle}>Tipo de vacuna</Text>
                  <FlatList
                    data={catalog ?? []}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }: { item: VaccineCatalogEntry }) => (
                      <TouchableOpacity
                        style={styles.pickerOption}
                        onPress={() => {
                          if (catalogPickerForRow !== null) {
                            updateRowCatalog(catalogPickerForRow, item.id);
                            setCatalogPickerForRow(null);
                          } else if (editCatalogOpen && editRow) {
                            const expires = addDays(
                              editRow.appliedAt,
                              item.defaultDurationDays
                            );
                            setEditRow({
                              ...editRow,
                              catalogId: item.id,
                              expiresAt: expires,
                            });
                            setEditCatalogOpen(false);
                          }
                        }}
                      >
                        <Text style={styles.pickerOptionText}>{item.displayName}</Text>
                        <Text style={styles.pickerOptionMeta}>
                          +{item.defaultDurationDays} días
                        </Text>
                      </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => <View style={styles.pickerSep} />}
                  />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          </View>

          {/* Visor fullscreen con pinch-zoom y swipe entre páginas. */}
          {/* Va dentro del Modal de cartilla para que ImageView (que usa Modal interno) */}
          {/* se monte en el contexto correcto en iOS (modales hermanos no se apilan). */}
          <ImageView
            images={zoomImages.map((uri) => ({ uri }))}
            imageIndex={zoomIndex}
            visible={zoomVisible}
            onRequestClose={() => setZoomVisible(false)}
            swipeToCloseEnabled
            doubleTapToZoomEnabled
          />
        </View>
      </Modal>

      {/* Toast de éxito al aprobar cartilla / agregar vacunas. */}
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
    </View>
  );
}
