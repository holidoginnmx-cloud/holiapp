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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCartillas,
  reviewCartilla,
  type CartillaStatusValue,
  type PetWithCartilla,
} from "@/lib/api";

const STATUS_TABS: { key: CartillaStatusValue; label: string }[] = [
  { key: "PENDING", label: "Pendientes" },
  { key: "APPROVED", label: "Aprobadas" },
  { key: "REJECTED", label: "Rechazadas" },
];

export default function AdminCartillas() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CartillaStatusValue>("PENDING");
  const [selectedPet, setSelectedPet] = useState<PetWithCartilla | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "cartillas", activeTab],
    queryFn: () => getCartillas(activeTab),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      petId,
      action,
      reason,
    }: {
      petId: string;
      action: "APPROVE" | "REJECT";
      reason?: string;
    }) => reviewCartilla(petId, { action, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "cartillas"] });
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      setSelectedPet(null);
      setRejecting(false);
      setRejectReason("");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const closeModal = () => {
    setSelectedPet(null);
    setRejecting(false);
    setRejectReason("");
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
                  : "Sin cartillas rechazadas"}
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
                  <Text style={styles.petName}>{pet.name}</Text>
                  <Text style={styles.ownerName}>
                    {pet.owner.firstName} {pet.owner.lastName}
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
                  Cartilla de {selectedPet.name}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {selectedPet.owner.firstName} {selectedPet.owner.lastName}
                  {selectedPet.owner.phone ? ` · ${selectedPet.owner.phone}` : ""}
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

                {rejecting ? (
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
                            action: "REJECT",
                            reason: rejectReason.trim() || undefined,
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
                ) : (
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
                        onPress={() =>
                          reviewMutation.mutate({
                            petId: selectedPet.id,
                            action: "APPROVE",
                          })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={18}
                          color={COLORS.white}
                        />
                        <Text style={[styles.btnText, { color: COLORS.white }]}>
                          {reviewMutation.isPending ? "..." : "Aprobar"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )
                )}
              </ScrollView>
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
  label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary },
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
});
