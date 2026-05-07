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
  adminCancelReservation,
  adminAssignStaff,
  getUsers,
} from "@/lib/api";
import { formatName } from "@/lib/format";

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
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [staffModalVisible, setStaffModalVisible] = useState(false);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
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

  const config = STATUS_CONFIG[reservation.status] || STATUS_CONFIG.PENDING;
  const actions = getActions(reservation.status);

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {reservation.pet.photoUrl ? (
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
              {formatName(reservation.pet.name)}
            </Text>
            <Text style={styles.ownerName} numberOfLines={1}>
              {formatName(reservation.owner.firstName)} {formatName(reservation.owner.lastName)}
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
        {/* Date hero — entrada → salida con noches al centro */}
        {reservation.checkIn && reservation.checkOut && (
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

        {/* Cuarto + Staff lado a lado */}
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <View style={styles.metaIconWrap}>
              <Ionicons
                name="bed-outline"
                size={16}
                color={COLORS.primary}
              />
            </View>
            <Text style={styles.metaLabel}>Cuarto</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {reservation.room?.name ?? "Por asignar"}
            </Text>
          </View>

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

        {/* Total */}
        <View style={styles.totalFooter}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>
            ${Number(reservation.totalAmount).toLocaleString()}
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

      {/* Servicios contratados */}
      {reservation.addons && reservation.addons.length > 0 && (
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
            if (addon.variant.deslanado) extras.push("Deslanado");
            if (addon.variant.corte) extras.push("Corte");
            const label =
              extras.length > 0
                ? `${addon.variant.serviceType.name} · ${extras.join(" + ")}`
                : addon.variant.serviceType.name;
            const code = addon.variant.serviceType.code;
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
        <View style={styles.sectionCardHeader}>
          <Text style={styles.sectionCardTitle}>Pagos</Text>
          <View style={styles.countChip}>
            <Text style={styles.countChipText}>
              {reservation.payments.length}
            </Text>
          </View>
        </View>
        {reservation.payments.length === 0 ? (
          <Text style={styles.emptyText}>Sin pagos registrados</Text>
        ) : (
          reservation.payments.map((p, idx) => {
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
              idx === reservation.payments.length - 1 && !willHaveCTA;
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
                    ${Number(p.amount).toLocaleString("es-MX")}
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
          })
        )}
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

      {/* Reportes diarios — botón a pantalla dedicada */}
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

      {/* Incidentes — botón a pantalla dedicada */}
      <TouchableOpacity
        style={styles.checklistsCard}
        onPress={() =>
          router.push(`/pet/incidents/${reservation.pet.id}` as any)
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
            Historial de alertas del staff de {formatName(reservation.pet.name)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
      </TouchableOpacity>

      {/* Acciones primarias (Confirmar / Check-in / Check-out) */}
      {actions.filter((a) => a.status !== "CANCELLED").length > 0 && (
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
  // Payment row
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
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
