import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getStaffDaycares,
  checkInStaffDaycare,
  checkOutStaffDaycare,
  registerDaycareManualPayment,
  type StaffDaycare,
} from "@/lib/api";
import {
  formatName,
  formatCurrency,
  formatWeekdayDayShort,
  formatTimeHHmm,
} from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

const STATUS_LABEL: Record<string, { label: string; bg: string; text: string }> = {
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, text: COLORS.infoText },
  CHECKED_IN: { label: "En guardería", bg: COLORS.successBg, text: COLORS.successText },
  CHECKED_OUT: { label: "Concluida", bg: COLORS.bgSection, text: COLORS.textTertiary },
  CANCELLED: { label: "Cancelada", bg: COLORS.errorBg, text: COLORS.errorText },
};

function balanceOf(d: StaffDaycare): number {
  const paid = d.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return Math.max(0, Number(d.totalAmount) - paid);
}

// Add-on de horas extra (EXTRA_HOURS): unitPrice = monto total, quantity = horas.
function extraHoursAddon(d: StaffDaycare) {
  return d.addons.find((a) => a.variant?.serviceType?.code === "EXTRA_HOURS");
}

export default function StaffDaycareDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [payMethod, setPayMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [payAmount, setPayAmount] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff-daycares", "upcoming"],
    queryFn: () => getStaffDaycares(),
  });

  const daycare = useMemo(
    () => data?.daycares.find((d) => d.id === id) ?? null,
    [data, id],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["staff-daycares"] });
  };

  const checkInMutation = useMutation({
    mutationFn: () => checkInStaffDaycare(id),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const checkOutMutation = useMutation({
    mutationFn: () => checkOutStaffDaycare(id),
    onSuccess: (res) => {
      invalidate();
      if (res.concluded) {
        Alert.alert("Guardería concluida", "¡Listo! El cliente ya puede irse.");
      } else if (res.extraHours > 0) {
        Alert.alert(
          "Horas extra",
          `Se agregaron ${res.extraHours} ${res.extraHours === 1 ? "hora" : "horas"} extra (${formatCurrency(res.extraAmount)}). Falta cobrar ${formatCurrency(res.balance)} al recoger.`,
        );
      } else {
        Alert.alert(
          "Saldo pendiente",
          `Falta cobrar ${formatCurrency(res.balance)} para concluir.`,
        );
      }
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const payMutation = useMutation({
    mutationFn: (amount: number) =>
      registerDaycareManualPayment(id, { amount, method: payMethod }),
    onSuccess: (res) => {
      invalidate();
      setPayAmount("");
      Alert.alert(
        res.concluded ? "Guardería concluida" : "Pago registrado",
        res.concluded
          ? "Saldo cubierto. ¡Listo!"
          : `Se registró ${formatCurrency(res.amount)}.`,
      );
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  if (!daycare) {
    return (
      <View style={styles.center}>
        <Ionicons name="sunny-outline" size={40} color={COLORS.border} />
        <Text style={styles.emptyText}>Guardería no encontrada</Text>
      </View>
    );
  }

  const status = STATUS_LABEL[daycare.status] ?? STATUS_LABEL.CONFIRMED;
  const balance = balanceOf(daycare);
  const paid = daycare.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const extra = extraHoursAddon(daycare);
  const phone = daycare.owner?.phone;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Encabezado */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.petIconWrap}>
            <Ionicons name="sunny" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.petName}>{formatName(daycare.pet?.name ?? "—")}</Text>
            <Text style={styles.petMeta}>
              {daycare.pet?.weight ? `${daycare.pet.weight} kg · ` : ""}
              {daycare.pet?.breed || "Sin raza"}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: status.bg }]}>
            <Text style={[styles.badgeText, { color: status.text }]}>
              {status.label}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Día + horas */}
        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <Text style={styles.infoText}>
            {daycare.appointmentAt
              ? formatWeekdayDayShort(daycare.appointmentAt)
              : "—"}
          </Text>
        </View>
        {daycare.checkInTime && daycare.checkOutTime && (
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={16} color={COLORS.primary} />
            <Text style={styles.infoText}>
              {formatTimeHHmm(daycare.checkInTime)} –{" "}
              {formatTimeHHmm(daycare.checkOutTime)} (estimado)
            </Text>
          </View>
        )}
        {daycare.notes ? (
          <View style={styles.infoRow}>
            <Ionicons name="document-text-outline" size={16} color={COLORS.warningText} />
            <Text style={styles.infoText}>{daycare.notes}</Text>
          </View>
        ) : null}
      </View>

      {/* Dueño */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Dueño</Text>
        <Text style={styles.ownerName}>
          {`${daycare.owner?.firstName ?? ""} ${daycare.owner?.lastName ?? ""}`.trim() ||
            "Sin dueño"}
        </Text>
        {phone ? (
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => Linking.openURL(`tel:${phone}`)}
          >
            <Ionicons name="call-outline" size={16} color={COLORS.primary} />
            <Text style={styles.callBtnText}>{phone}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Pagos */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Cobro</Text>
        <View style={styles.payRow}>
          <Text style={styles.payLabel}>Total</Text>
          <Text style={styles.payValue}>{formatCurrency(Number(daycare.totalAmount))}</Text>
        </View>
        {extra && (
          <View style={styles.payRow}>
            <Text style={styles.payLabelSub}>
              Incluye {extra.quantity ?? 1}{" "}
              {(extra.quantity ?? 1) === 1 ? "hora extra" : "horas extra"}
            </Text>
            <Text style={styles.payValueSub}>
              {formatCurrency(Number(extra.unitPrice))}
            </Text>
          </View>
        )}
        <View style={styles.payRow}>
          <Text style={styles.payLabel}>Pagado</Text>
          <Text style={[styles.payValue, { color: COLORS.successText }]}>
            {formatCurrency(paid)}
          </Text>
        </View>
        <View style={[styles.payRow, styles.payRowTotal]}>
          <Text style={styles.payLabelBold}>Saldo</Text>
          <Text
            style={[
              styles.payValueBold,
              { color: balance > 0 ? COLORS.warningText : COLORS.successText },
            ]}
          >
            {formatCurrency(balance)}
          </Text>
        </View>
      </View>

      {/* Acciones */}
      {daycare.status === "CONFIRMED" && (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => checkInMutation.mutate()}
          disabled={checkInMutation.isPending}
        >
          {checkInMutation.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="log-in-outline" size={18} color={COLORS.white} />
              <Text style={styles.primaryBtnText}>Registrar entrada (check-in)</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {daycare.status === "CHECKED_IN" && (
        <>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              Alert.alert(
                "Check-out",
                "Se calcularán las horas extra si el cliente recoge más tarde de lo estimado. ¿Continuar?",
                [
                  { text: "Cancelar", style: "cancel" },
                  { text: "Check-out", onPress: () => checkOutMutation.mutate() },
                ],
              )
            }
            disabled={checkOutMutation.isPending}
          >
            {checkOutMutation.isPending ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={18} color={COLORS.white} />
                <Text style={styles.primaryBtnText}>Registrar salida (check-out)</Text>
              </>
            )}
          </TouchableOpacity>

          {balance > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Registrar pago</Text>
              <Text style={styles.paySub}>
                Cobra el saldo pendiente ({formatCurrency(balance)}) al entregar.
              </Text>
              <View style={styles.methodRow}>
                {(["CASH", "TRANSFER"] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.methodChip,
                      payMethod === m && styles.methodChipActive,
                    ]}
                    onPress={() => setPayMethod(m)}
                  >
                    <Text
                      style={[
                        styles.methodChipText,
                        payMethod === m && styles.methodChipTextActive,
                      ]}
                    >
                      {m === "CASH" ? "Efectivo" : "Transferencia"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.inputWrap}>
                <Text style={styles.currency}>$</Text>
                <TextInput
                  style={styles.input}
                  value={payAmount}
                  onChangeText={setPayAmount}
                  keyboardType="decimal-pad"
                  placeholder={String(balance)}
                  placeholderTextColor={COLORS.textDisabled}
                />
              </View>
              <TouchableOpacity
                style={[
                  styles.payBtn,
                  payMutation.isPending && { opacity: 0.6 },
                ]}
                onPress={() => {
                  const amount = parseFloat(payAmount) || balance;
                  if (amount <= 0) return;
                  payMutation.mutate(amount);
                }}
                disabled={payMutation.isPending}
              >
                {payMutation.isPending ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.payBtnText}>
                    Registrar {formatCurrency(parseFloat(payAmount) || balance)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
    gap: 10,
  },
  emptyText: { fontSize: 14, color: COLORS.textTertiary },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  petIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary },
  petMeta: { fontSize: 13, color: COLORS.textTertiary, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "800" },
  divider: { height: 1, backgroundColor: COLORS.bgSection, marginVertical: 12 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  infoText: { flex: 1, fontSize: 14, color: COLORS.textSecondary, fontWeight: "600" },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  ownerName: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  callBtnText: { color: COLORS.primary, fontSize: 14, fontWeight: "700" },
  payRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  payRowTotal: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 8,
    marginTop: 4,
  },
  payLabel: { fontSize: 14, color: COLORS.textTertiary, fontWeight: "600" },
  payLabelSub: { fontSize: 12, color: COLORS.textTertiary, fontWeight: "600" },
  payLabelBold: { fontSize: 15, color: COLORS.textPrimary, fontWeight: "800" },
  payValue: { fontSize: 15, color: COLORS.textPrimary, fontWeight: "700" },
  payValueSub: { fontSize: 12, color: COLORS.textTertiary, fontWeight: "600" },
  payValueBold: { fontSize: 18, fontWeight: "800" },
  paySub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "600",
    marginBottom: 10,
  },
  methodRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  methodChipActive: { backgroundColor: COLORS.primaryLight },
  methodChipText: { fontSize: 13, fontWeight: "700", color: COLORS.textTertiary },
  methodChipTextActive: { color: COLORS.primary },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  currency: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textTertiary,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    paddingVertical: 12,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  primaryBtnText: { color: COLORS.white, fontSize: 15, fontWeight: "800" },
  payBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 14,
  },
  payBtnText: { color: COLORS.white, fontSize: 15, fontWeight: "800" },
});
