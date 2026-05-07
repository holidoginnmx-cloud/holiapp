import { COLORS } from "@/constants/colors";
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
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
import { formatName, formatPhoneInput } from "@/lib/format";

const STATUS_TABS: { key: CartillaStatusValue; label: string }[] = [
  { key: "PENDING", label: "Pendientes" },
  { key: "APPROVED", label: "Aprobadas" },
  { key: "REJECTED", label: "Rechazadas" },
  { key: "EXPIRED", label: "Vencidas" },
];

type VaccineRow = {
  catalogId: string | null;
  appliedAt: Date;
  expiresAt: Date;
};

const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 86_400_000);

const formatShort = (d: Date) =>
  d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function AdminCartillas() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CartillaStatusValue>("PENDING");
  const [selectedPet, setSelectedPet] = useState<PetWithCartilla | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Captura de vacunas al aprobar.
  const [capturing, setCapturing] = useState(false);
  const [vaccineRows, setVaccineRows] = useState<VaccineRow[]>([]);
  const [catalogPickerForRow, setCatalogPickerForRow] = useState<number | null>(null);
  const [appliedPickerForRow, setAppliedPickerForRow] = useState<number | null>(null);
  const [expiresPickerForRow, setExpiresPickerForRow] = useState<number | null>(null);

  // Edición de vacuna existente.
  const [editingVaccineId, setEditingVaccineId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<VaccineRow | null>(null);
  const [editCatalogOpen, setEditCatalogOpen] = useState(false);
  const [editAppliedOpen, setEditAppliedOpen] = useState(false);
  const [editExpiresOpen, setEditExpiresOpen] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "cartillas"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "alerts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      closeModal();
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
    setAppliedPickerForRow(null);
    setExpiresPickerForRow(null);
    cancelEdit();
  };

  const startCapture = () => {
    setCapturing(true);
    setVaccineRows([]);
  };

  const addRow = () => {
    const today = new Date();
    setVaccineRows((rows) => [
      ...rows,
      { catalogId: null, appliedAt: today, expiresAt: addDays(today, 365) },
    ]);
  };

  const removeRow = (index: number) =>
    setVaccineRows((rows) => rows.filter((_, i) => i !== index));

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

  const updateRowApplied = (index: number, appliedAt: Date) => {
    setVaccineRows((rows) =>
      rows.map((r, i) => {
        if (i !== index) return r;
        const cat = r.catalogId ? catalogById.get(r.catalogId) : undefined;
        const expires = cat ? addDays(appliedAt, cat.defaultDurationDays) : r.expiresAt;
        return { ...r, appliedAt, expiresAt: expires };
      })
    );
  };

  const updateRowExpires = (index: number, expiresAt: Date) => {
    setVaccineRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, expiresAt } : r))
    );
  };

  const submitApprove = (withVaccines: boolean) => {
    if (!selectedPet) return;

    if (withVaccines) {
      const incomplete = vaccineRows.find((r) => !r.catalogId);
      if (incomplete) {
        Alert.alert("Datos incompletos", "Selecciona el tipo de vacuna en cada renglón.");
        return;
      }
      reviewMutation.mutate({
        petId: selectedPet.id,
        payload: {
          action: "APPROVE",
          vaccines: vaccineRows.map((r) => ({
            catalogId: r.catalogId!,
            appliedAt: r.appliedAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
          })),
        },
      });
    } else {
      reviewMutation.mutate({
        petId: selectedPet.id,
        payload: { action: "APPROVE" },
      });
    }
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

      {isLoading ? (
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
                {pet.cartillaUrl ? (
                  <Image
                    source={{ uri: pet.cartillaUrl }}
                    style={styles.thumb}
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Ionicons
                      name="document-outline"
                      size={28}
                      color={COLORS.border}
                    />
                  </View>
                )}
                <View style={styles.cardInfo}>
                  <Text style={styles.petName}>{formatName(pet.name)}</Text>
                  <Text style={styles.ownerName}>
                    {formatName(pet.owner.firstName)} {formatName(pet.owner.lastName)}
                  </Text>
                  {pet.cartillaReviewedAt ? (
                    <Text style={styles.metaText}>
                      Revisada{" "}
                      {new Date(pet.cartillaReviewedAt).toLocaleDateString(
                        "es-MX",
                        { day: "numeric", month: "short" }
                      )}
                    </Text>
                  ) : (
                    <Text style={styles.metaText}>Esperando revisión</Text>
                  )}
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
                  {formatName(selectedPet.owner.firstName)} {formatName(selectedPet.owner.lastName)}
                  {selectedPet.owner.phone ? ` · ${formatPhoneInput(selectedPet.owner.phone)}` : ""}
                </Text>

                {selectedPet.cartillaUrl && (
                  <Image
                    source={{ uri: selectedPet.cartillaUrl }}
                    style={styles.fullImage}
                    resizeMode="contain"
                  />
                )}

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

                      {editAppliedOpen && (
                        <DateTimePicker
                          value={editRow.appliedAt}
                          mode="date"
                          display={Platform.OS === "ios" ? "spinner" : "default"}
                          maximumDate={new Date()}
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
                      )}
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
                          value={editRow.expiresAt}
                          mode="date"
                          display={Platform.OS === "ios" ? "spinner" : "default"}
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
                    <Text style={styles.captureTitle}>Capturar vacunas</Text>
                    <Text style={styles.captureHint}>
                      Agrega las vacunas visibles en la cartilla. La fecha de vencimiento
                      se calcula automáticamente, pero la puedes editar si la cartilla
                      muestra otra.
                    </Text>

                    {vaccineRows.map((row, idx) => {
                      const cat = row.catalogId ? catalogById.get(row.catalogId) : null;
                      return (
                        <View key={idx} style={styles.vaccineRow}>
                          <View style={styles.vaccineRowHeader}>
                            <Text style={styles.vaccineRowTitle}>Vacuna {idx + 1}</Text>
                            <TouchableOpacity onPress={() => removeRow(idx)}>
                              <Ionicons
                                name="trash-outline"
                                size={18}
                                color={COLORS.errorText}
                              />
                            </TouchableOpacity>
                          </View>

                          <Text style={styles.label}>Tipo</Text>
                          <TouchableOpacity
                            style={styles.selectRow}
                            onPress={() => setCatalogPickerForRow(idx)}
                          >
                            <Text
                              style={[
                                styles.selectText,
                                !cat && { color: COLORS.textDisabled },
                              ]}
                            >
                              {cat?.displayName ?? "Selecciona el tipo"}
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
                            onPress={() => setAppliedPickerForRow(idx)}
                          >
                            <Ionicons
                              name="calendar-outline"
                              size={18}
                              color={COLORS.primary}
                            />
                            <Text style={styles.selectText}>
                              {formatShort(row.appliedAt)}
                            </Text>
                          </TouchableOpacity>

                          <Text style={styles.label}>
                            Vence{" "}
                            {cat && (
                              <Text style={styles.labelHint}>
                                · sugerido +{cat.defaultDurationDays} días
                              </Text>
                            )}
                          </Text>
                          <TouchableOpacity
                            style={styles.selectRow}
                            onPress={() => setExpiresPickerForRow(idx)}
                          >
                            <Ionicons
                              name="alarm-outline"
                              size={18}
                              color={COLORS.warningText}
                            />
                            <Text style={styles.selectText}>
                              {formatShort(row.expiresAt)}
                            </Text>
                          </TouchableOpacity>

                          {/* DatePicker aplicada */}
                          {appliedPickerForRow === idx && (
                            <DateTimePicker
                              value={row.appliedAt}
                              mode="date"
                              display={Platform.OS === "ios" ? "spinner" : "default"}
                              maximumDate={new Date()}
                              onChange={(_, d) => {
                                setAppliedPickerForRow(
                                  Platform.OS === "ios" ? idx : null
                                );
                                if (d) updateRowApplied(idx, d);
                              }}
                            />
                          )}
                          {Platform.OS === "ios" && appliedPickerForRow === idx && (
                            <TouchableOpacity
                              style={styles.pickerDone}
                              onPress={() => setAppliedPickerForRow(null)}
                            >
                              <Text style={styles.pickerDoneText}>Listo</Text>
                            </TouchableOpacity>
                          )}

                          {/* DatePicker vence */}
                          {expiresPickerForRow === idx && (
                            <DateTimePicker
                              value={row.expiresAt}
                              mode="date"
                              display={Platform.OS === "ios" ? "spinner" : "default"}
                              minimumDate={row.appliedAt}
                              onChange={(_, d) => {
                                setExpiresPickerForRow(
                                  Platform.OS === "ios" ? idx : null
                                );
                                if (d) updateRowExpires(idx, d);
                              }}
                            />
                          )}
                          {Platform.OS === "ios" && expiresPickerForRow === idx && (
                            <TouchableOpacity
                              style={styles.pickerDone}
                              onPress={() => setExpiresPickerForRow(null)}
                            >
                              <Text style={styles.pickerDoneText}>Listo</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}

                    <TouchableOpacity style={styles.addRowBtn} onPress={addRow}>
                      <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                      <Text style={styles.addRowText}>Agregar vacuna</Text>
                    </TouchableOpacity>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                        onPress={() => {
                          setCapturing(false);
                          setVaccineRows([]);
                        }}
                      >
                        <Text style={[styles.btnText, { color: COLORS.textSecondary }]}>
                          Cancelar
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                        onPress={() => submitApprove(vaccineRows.length > 0)}
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
                            : vaccineRows.length === 0
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
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 14, fontWeight: "600", color: COLORS.textTertiary },
  tabTextActive: { color: COLORS.primary },
  list: { padding: 16, gap: 10 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyBox: { alignItems: "center", padding: 40, gap: 10 },
  emptyText: { fontSize: 14, color: COLORS.textDisabled, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: COLORS.bgSection,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1, gap: 2 },
  petName: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  ownerName: { fontSize: 13, color: COLORS.textSecondary },
  metaText: { fontSize: 12, color: COLORS.textTertiary },
  rejectionReason: { fontSize: 12, color: COLORS.errorText, marginTop: 2 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    maxHeight: "92%",
  },
  modalClose: { position: "absolute", top: 12, right: 12, zIndex: 2, padding: 6 },
  modalTitle: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  modalSubtitle: { fontSize: 14, color: COLORS.textTertiary, marginTop: 4 },
  fullImage: {
    width: "100%",
    height: 360,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    marginTop: 14,
  },
  prevReasonBox: {
    backgroundColor: COLORS.errorBg,
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  prevReasonLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.errorText,
    marginBottom: 2,
  },
  prevReasonText: { fontSize: 13, color: COLORS.errorText },
  label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginTop: 8 },
  labelHint: { fontWeight: "400", color: COLORS.textTertiary, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    minHeight: 80,
    textAlignVertical: "top",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 10,
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnDanger: { backgroundColor: COLORS.errorText },
  btnGhost: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  btnText: { fontSize: 14, fontWeight: "700" },
  // Captura de vacunas
  captureTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  captureHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
    marginBottom: 8,
  },
  vaccineRow: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    gap: 4,
  },
  vaccineRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  vaccineRowTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  selectText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  pickerDone: {
    alignSelf: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  pickerDoneText: { color: COLORS.primary, fontWeight: "700" },
  addRowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    marginTop: 12,
  },
  addRowText: { color: COLORS.primary, fontWeight: "700", fontSize: 14 },
  // Catalog picker overlay (absoluto, dentro del Modal principal)
  pickerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    zIndex: 10,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  pickerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    width: "100%",
    maxHeight: 420,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  pickerOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  pickerOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  pickerOptionMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  pickerSep: {
    height: 1,
    backgroundColor: COLORS.bgSection,
  },
  // Vacunas registradas
  vaccinesSection: {
    marginTop: 16,
  },
  vaccinesSectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  vaccineCard: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  vaccineCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  vaccineCardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  vaccineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  vaccineBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  vaccineCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vaccineCardMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  vaccineCardEditHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  vaccineCardEditHintText: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontStyle: "italic",
  },
  btnGhostDanger: {
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorText,
  },
});
