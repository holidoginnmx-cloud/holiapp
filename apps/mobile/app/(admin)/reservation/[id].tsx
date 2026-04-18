import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
} from "react-native";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  getReservationById,
  updateReservationStatus,
  getOwnerChecklists,
  registerManualPayment,
} from "@/lib/api";
import { ChecklistSummaryCard } from "@/components/ChecklistSummaryCard";

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  CHECKED_IN: { label: "Hospedado", bg: COLORS.successBg, text: COLORS.successText },
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, text: COLORS.infoText },
  PENDING: { label: "Pendiente", bg: COLORS.warningBg, text: COLORS.warningText },
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
    case "PENDING":
      return [
        {
          label: "Confirmar",
          status: "CONFIRMED",
          color: COLORS.infoText,
          icon: "checkmark-circle",
        },
        {
          label: "Cancelar",
          status: "CANCELLED",
          color: COLORS.errorText,
          icon: "close-circle",
        },
      ];
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
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [paymentNotes, setPaymentNotes] = useState("");

  const { data: reservation, isLoading } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const { data: checklists } = useQuery({
    queryKey: ["reservation", id, "checklists"],
    queryFn: () => getOwnerChecklists(id!),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: ({ newStatus }: { newStatus: string }) =>
      updateReservationStatus(id!, newStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
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

  const handleStatusChange = (action: StatusAction) => {
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

  const config = STATUS_CONFIG[reservation.status] || STATUS_CONFIG.PENDING;
  const actions = getActions(reservation.status);

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.petName}>{reservation.pet.name}</Text>
          <Text style={styles.ownerName}>
            {reservation.owner.firstName} {reservation.owner.lastName}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <Text style={[styles.badgeText, { color: config.text }]}>
            {config.label}
          </Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.infoLabel}>Entrada:</Text>
          <Text style={styles.infoValue}>{formatDate(reservation.checkIn)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.infoLabel}>Salida:</Text>
          <Text style={styles.infoValue}>
            {formatDate(reservation.checkOut)}
          </Text>
        </View>
        {reservation.room && (
          <View style={styles.infoRow}>
            <Ionicons name="bed-outline" size={18} color={COLORS.textTertiary} />
            <Text style={styles.infoLabel}>Cuarto:</Text>
            <Text style={styles.infoValue}>{reservation.room.name}</Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.infoLabel}>Staff:</Text>
          {reservation.staff ? (
            <Text style={styles.infoValue}>
              {reservation.staff.firstName} {reservation.staff.lastName}
            </Text>
          ) : (
            <Text style={[styles.infoValue, styles.unassigned]}>Sin asignar</Text>
          )}
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.infoLabel}>Noches:</Text>
          <Text style={styles.infoValue}>{reservation.totalDays}</Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="cash-outline" size={18} color={COLORS.textTertiary} />
          <Text style={styles.infoLabel}>Total:</Text>
          <Text style={[styles.infoValue, styles.amount]}>
            ${Number(reservation.totalAmount).toLocaleString()}
          </Text>
        </View>
        {reservation.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notas:</Text>
            <Text style={styles.notesText}>{reservation.notes}</Text>
          </View>
        )}
      </View>

      {/* Actions */}
      {actions.length > 0 && (
        <View style={styles.actionsRow}>
          {actions.map((action) => (
            <TouchableOpacity
              key={action.status}
              style={[styles.actionButton, { backgroundColor: action.color }]}
              onPress={() => handleStatusChange(action)}
              disabled={statusMutation.isPending}
              activeOpacity={0.8}
            >
              <Ionicons name={action.icon} size={20} color={COLORS.white} />
              <Text style={styles.actionText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Servicios contratados */}
      {reservation.addons && reservation.addons.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Servicios contratados ({reservation.addons.length})
          </Text>
          {reservation.addons.map((addon) => {
            const extras: string[] = [];
            if (addon.variant.deslanado) extras.push("Deslanado");
            if (addon.variant.corte) extras.push("Corte");
            const label = extras.length > 0
              ? `${addon.variant.serviceType.name} + ${extras.join(" + ")}`
              : addon.variant.serviceType.name;
            return (
              <View key={addon.id} style={styles.addonItem}>
                <View style={styles.addonLeft}>
                  <Ionicons name="water-outline" size={18} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addonLabel}>{label}</Text>
                    <Text style={styles.addonMeta}>
                      {addon.paidWith === "BOOKING" ? "Pagado en reserva" : "Pagado después"}
                      {" · "}
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
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Pagos ({reservation.payments.length})
        </Text>
        {reservation.payments.length === 0 ? (
          <Text style={styles.emptyText}>Sin pagos registrados</Text>
        ) : (
          reservation.payments.map((p) => (
            <View key={p.id} style={styles.paymentItem}>
              <View style={styles.paymentLeft}>
                <Text style={styles.paymentAmount}>
                  ${Number(p.amount).toLocaleString()}
                </Text>
                <Text style={styles.paymentMeta}>
                  {p.method} · {p.paidAt ? formatDateTime(p.paidAt) : "Pendiente"}
                </Text>
              </View>
              <View
                style={[
                  styles.paymentBadge,
                  {
                    backgroundColor:
                      p.status === "PAID" ? COLORS.successBg : COLORS.warningBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.paymentBadgeText,
                    {
                      color:
                        p.status === "PAID" ? COLORS.successText : COLORS.warningText,
                    },
                  ]}
                >
                  {p.status === "PAID" ? "Pagado" : p.status}
                </Text>
              </View>
            </View>
          ))
        )}
        {reservation.status !== "CANCELLED" && reservation.status !== "CHECKED_OUT" && (
          <TouchableOpacity
            style={styles.registerPaymentBtn}
            onPress={() => setPaymentModalVisible(true)}
          >
            <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
            <Text style={styles.registerPaymentText}>Registrar pago manual</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Reportes diarios del staff */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Reportes diarios ({checklists?.length ?? 0})
        </Text>
        {!checklists || checklists.length === 0 ? (
          <Text style={styles.emptyText}>Sin reportes registrados</Text>
        ) : (
          (() => {
            const activeId = selectedChecklistId ?? checklists[0].id;
            const active = checklists.find((c) => c.id === activeId) ?? checklists[0];
            return (
              <>
                {checklists.length > 1 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.dateSelector}
                  >
                    {checklists.map((c) => {
                      const isActive = c.id === active.id;
                      return (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => setSelectedChecklistId(c.id)}
                          style={[
                            styles.dateChip,
                            isActive && styles.dateChipActive,
                          ]}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.dateChipText,
                              isActive && styles.dateChipTextActive,
                            ]}
                          >
                            {new Date(c.date).toLocaleDateString("es-MX", {
                              day: "numeric",
                              month: "short",
                            })}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
                <View style={styles.reportHeader}>
                  <Text style={styles.reportDate}>
                    {new Date(active.date).toLocaleDateString("es-MX", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </Text>
                  <Text style={styles.reportStaff}>
                    {active.staff.firstName} {active.staff.lastName}
                  </Text>
                </View>
                <ChecklistSummaryCard checklist={active} />
              </>
            );
          })()
        )}
      </View>

      {/* Stay Updates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Evidencias ({reservation.updates.length})
        </Text>
        {reservation.updates.length === 0 ? (
          <Text style={styles.emptyText}>Sin evidencias subidas</Text>
        ) : (
          reservation.updates.map((u) => (
            <View key={u.id} style={styles.updateItem}>
              <Image
                source={{ uri: u.mediaUrl }}
                style={styles.updateImage}
              />
              <View style={styles.updateInfo}>
                {u.caption && (
                  <Text style={styles.updateCaption} numberOfLines={2}>
                    {u.caption}
                  </Text>
                )}
                <Text style={styles.updateDate}>
                  {formatDateTime(u.createdAt)}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>

    {/* Payment Modal */}
    <Modal visible={paymentModalVisible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
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
              onPress={() => {
                setPaymentModalVisible(false);
                setPaymentAmount("");
                setPaymentNotes("");
              }}
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
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
    alignItems: "flex-start",
    marginBottom: 16,
  },
  petName: {
    fontSize: 24,
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
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.textTertiary,
    width: 60,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
    flex: 1,
  },
  amount: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  unassigned: {
    color: COLORS.textDisabled,
    fontStyle: "italic",
    fontWeight: "500",
  },
  notesBox: {
    backgroundColor: COLORS.notesBg,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.notesText,
    marginBottom: 4,
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textDisabled,
    fontStyle: "italic",
  },
  paymentItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  paymentLeft: {
    gap: 2,
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  paymentMeta: {
    fontSize: 12,
    color: COLORS.textDisabled,
  },
  paymentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  paymentBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  addonItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  addonLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  addonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  addonMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  addonPrice: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.primary,
  },
  updateItem: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 8,
  },
  updateImage: {
    width: 80,
    height: 80,
    backgroundColor: COLORS.borderLight,
  },
  updateInfo: {
    flex: 1,
    padding: 10,
    justifyContent: "center",
    gap: 4,
  },
  updateCaption: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  updateDate: {
    fontSize: 12,
    color: COLORS.textDisabled,
  },
  dateSelector: {
    gap: 8,
    paddingVertical: 4,
    marginBottom: 10,
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.bgSection,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  dateChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "capitalize",
  },
  dateChipTextActive: {
    color: COLORS.white,
  },
  reportItem: {
    marginBottom: 8,
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  reportDate: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "capitalize",
  },
  reportStaff: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontStyle: "italic",
  },
  registerPaymentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
  },
  registerPaymentText: {
    fontSize: 13,
    fontWeight: "600",
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
