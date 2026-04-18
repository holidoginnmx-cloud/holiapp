import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  RefreshControl,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAdminServices,
  updateServiceVariant,
  updateAdminService,
} from "@/lib/api";
import type { AdminServiceType } from "@/lib/api";

const SIZE_LABELS: Record<string, string> = {
  S: "Chico",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

function describeVariant(v: { deslanado: boolean; corte: boolean }): string {
  const parts: string[] = ["Baño"];
  if (v.deslanado) parts.push("Deslanado");
  if (v.corte) parts.push("Corte");
  return parts.join(" + ");
}

export default function AdminServices() {
  const qc = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "services"],
    queryFn: getAdminServices,
  });

  // Price edit modal
  const [editModal, setEditModal] = useState<{
    variantId: string;
    currentPrice: number;
    label: string;
  } | null>(null);
  const [newPrice, setNewPrice] = useState("");

  const updatePriceMutation = useMutation({
    mutationFn: () =>
      updateServiceVariant(editModal!.variantId, {
        price: parseFloat(newPrice),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "services"] });
      setEditModal(null);
      setNewPrice("");
      Alert.alert("Precio actualizado");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const toggleVariantMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateServiceVariant(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "services"] }),
  });

  const toggleServiceMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateAdminService(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "services"] }),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {(data ?? []).map((service) => (
        <View key={service.id} style={styles.serviceCard}>
          {/* Service header */}
          <View style={styles.serviceHeader}>
            <View style={styles.serviceNameRow}>
              <Ionicons
                name={service.code === "BATH" ? "water" : "construct"}
                size={20}
                color={COLORS.primary}
              />
              <Text style={styles.serviceName}>{service.name}</Text>
              <Text style={styles.serviceCode}>{service.code}</Text>
            </View>
            <Switch
              value={service.isActive}
              onValueChange={(val) =>
                toggleServiceMutation.mutate({ id: service.id, isActive: val })
              }
              trackColor={{ false: COLORS.borderLight, true: COLORS.reviewToggle }}
              thumbColor={service.isActive ? COLORS.primary : COLORS.white}
            />
          </View>

          {/* Variants grouped by size */}
          {["S", "M", "L", "XL"].map((size) => {
            const sizeVariants = service.variants.filter((v) => v.petSize === size);
            if (sizeVariants.length === 0) return null;

            return (
              <View key={size} style={styles.sizeGroup}>
                <Text style={styles.sizeLabel}>
                  {SIZE_LABELS[size] ?? size} ({size})
                </Text>
                {sizeVariants.map((v) => (
                  <View key={v.id} style={styles.variantRow}>
                    <View style={styles.variantInfo}>
                      <Text
                        style={[
                          styles.variantName,
                          !v.isActive && styles.variantInactive,
                        ]}
                      >
                        {describeVariant(v)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.priceBtn}
                      onPress={() => {
                        setEditModal({
                          variantId: v.id,
                          currentPrice: v.price,
                          label: `${describeVariant(v)} — ${SIZE_LABELS[size] ?? size}`,
                        });
                        setNewPrice(String(v.price));
                      }}
                    >
                      <Text style={styles.priceText}>
                        ${v.price.toLocaleString("es-MX")}
                      </Text>
                      <Ionicons name="pencil" size={12} color={COLORS.primary} />
                    </TouchableOpacity>
                    <Switch
                      value={v.isActive}
                      onValueChange={(val) =>
                        toggleVariantMutation.mutate({ id: v.id, isActive: val })
                      }
                      trackColor={{ false: COLORS.borderLight, true: COLORS.reviewToggle }}
                      thumbColor={v.isActive ? COLORS.successText : COLORS.white}
                      style={{ transform: [{ scale: 0.8 }] }}
                    />
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ))}

      {(!data || data.length === 0) && (
        <View style={styles.center}>
          <Ionicons name="construct-outline" size={48} color={COLORS.border} />
          <Text style={styles.emptyText}>No hay servicios configurados</Text>
        </View>
      )}

      <View style={{ height: 40 }} />

      {/* Price Edit Modal */}
      <Modal visible={!!editModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Editar precio</Text>
            <Text style={styles.modalLabel}>{editModal?.label}</Text>
            <Text style={styles.inputLabel}>Nuevo precio (MXN)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="0.00"
              placeholderTextColor={COLORS.textDisabled}
              value={newPrice}
              onChangeText={setNewPrice}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => {
                  setEditModal(null);
                  setNewPrice("");
                }}
              >
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtnConfirm,
                  (!newPrice || parseFloat(newPrice) <= 0) && { opacity: 0.5 },
                ]}
                onPress={() => updatePriceMutation.mutate()}
                disabled={
                  !newPrice || parseFloat(newPrice) <= 0 || updatePriceMutation.isPending
                }
              >
                <Text style={styles.modalBtnConfirmText}>
                  {updatePriceMutation.isPending ? "Guardando..." : "Guardar"}
                </Text>
              </TouchableOpacity>
            </View>
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
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
  serviceCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  serviceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  serviceNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  serviceName: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  serviceCode: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textDisabled,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sizeGroup: {
    marginTop: 10,
  },
  sizeLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  variantInfo: {
    flex: 1,
  },
  variantName: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  variantInactive: {
    color: COLORS.textDisabled,
    textDecorationLine: "line-through",
  },
  priceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 8,
  },
  priceText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.primary,
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
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  modalLabel: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
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
