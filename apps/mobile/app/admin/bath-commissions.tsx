import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  Share,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getBathCommissions,
  updateBathCommissionRates,
  type BathCommissionReport,
  type CommissionBathRow,
  type CommissionFlag,
} from "@/lib/api";
import {
  formatName,
  formatCurrency,
  formatStayDay,
  formatWeekdayDayShort,
  formatTime,
  HMO_TZ,
} from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";
import { alertaDeError } from "@/lib/errorAlert";

// Comisión semanal de la estilista por baño: 15% del precio normal del baño +
// corte + deslanado, sin domicilio (regla de José). La semana va de lunes a
// domingo en hora del hotel, se paga el domingo, y un baño cuenta en la semana
// en que se HIZO (no en la que se cobró). El cálculo vive en la API
// (lib/bathCommissions.ts); aquí solo se pinta y se ajusta el %. Hoy baña solo
// Nancy, así que es un solo total, sin separar por persona.

const DAY_MS = 86_400_000;

function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  return new Date(d.getTime() + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

const weekLabel = (r: Pick<BathCommissionReport, "weekStart" | "weekEnd">) =>
  `${formatStayDay(`${r.weekStart}T00:00:00Z`)} – ${formatStayDay(`${r.weekEnd}T00:00:00Z`)}`;

const pctLabel = (f: number) => `${Math.round(f * 1000) / 10}%`;

/** "15% de baño + corte + deslanado", o los dos % si son distintos. */
const ratesLabel = (r: BathCommissionReport["rates"]) =>
  r.basePct === r.extrasPct
    ? `${pctLabel(r.basePct)} de baño + corte + deslanado`
    : `${pctLabel(r.basePct)} del baño · ${pctLabel(r.extrasPct)} de corte/deslanado`;

const FLAG_LABEL: Record<CommissionFlag, { text: string; tone: "warn" | "info" }> = {
  EXTRAS_SIN_PRECIO: { text: "Falta precio de corte/deslanado", tone: "warn" },
  EXTRAS_EN_TOTAL: { text: "Corte/deslanado venía en el precio", tone: "info" },
  CORTESIA: { text: "Cortesía · se paga normal", tone: "info" },
  DESCUENTO: { text: "Con descuento · se paga normal", tone: "info" },
  POR_COBRAR: { text: "Por cobrar", tone: "info" },
};

/** Resumen en texto para mandarlo por WhatsApp. */
function buildShareText(r: BathCommissionReport): string {
  const lines = [
    `Comisión de baños · ${weekLabel(r)}`,
    `Total: ${formatCurrency(r.commission)} (${r.count} baño${r.count === 1 ? "" : "s"})`,
    "",
  ];
  for (const b of r.baths) {
    const extras = b.corte + b.deslanado + b.extrasIncluded;
    lines.push(
      `• ${formatWeekdayDayShort(b.completedAt, { timeZone: HMO_TZ })} ${formatName(b.petName)}: ` +
        `${formatCurrency(b.base)}${extras > 0 ? ` + ${formatCurrency(extras)}` : ""} → ${formatCurrency(b.commission)}`,
    );
  }
  lines.push("", ratesLabel(r.rates));
  return lines.join("\n");
}

export default function BathCommissions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // undefined = la semana en curso (la decide la API en hora del hotel).
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const [ratesOpen, setRatesOpen] = useState(false);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "bath-commissions", weekStart ?? "current"],
    queryFn: () => getBathCommissions(weekStart),
  });

  const ratesMutation = useMutation({
    mutationFn: updateBathCommissionRates,
    onSuccess: () => {
      setRatesOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "bath-commissions"] });
    },
    onError: (e) => alertaDeError(e, { respaldo: "No se pudo guardar el porcentaje" }),
  });

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const isCurrentWeek = new Date(data.to).getTime() > Date.now();
  const ratesUnset = data.rates.basePct === 0 && data.rates.extrasPct === 0;
  const totalBaths = data.count;

  async function share() {
    try {
      await Share.share({ message: buildShareText(data!) });
    } catch {
      // Compartir cancelado.
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
        }
      >
        {/* Semana */}
        <View style={styles.weekNav}>
          <TouchableOpacity
            style={styles.weekArrow}
            onPress={() => setWeekStart(shiftWeek(data.weekStart, -1))}
            accessibilityLabel="Semana anterior"
          >
            <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
          </TouchableOpacity>
          <View style={styles.weekCenter}>
            <Text style={styles.weekLabel}>{weekLabel(data)}</Text>
            <Text style={styles.weekSub}>
              {isCurrentWeek ? "Semana en curso · se paga el domingo" : "Lunes a domingo"}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.weekArrow, isCurrentWeek && styles.weekArrowDisabled]}
            onPress={() => setWeekStart(shiftWeek(data.weekStart, 1))}
            disabled={isCurrentWeek}
            accessibilityLabel="Semana siguiente"
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={isCurrentWeek ? COLORS.textTertiary : COLORS.primary}
            />
          </TouchableOpacity>
        </View>

        {/* Porcentajes */}
        <TouchableOpacity
          style={[styles.ratesCard, ratesUnset && styles.ratesCardWarn]}
          onPress={() => setRatesOpen(true)}
        >
          <Ionicons
            name={ratesUnset ? "alert-circle-outline" : "options-outline"}
            size={20}
            color={ratesUnset ? COLORS.warningText : COLORS.primary}
          />
          <Text style={styles.ratesText}>
            {ratesUnset
              ? "Define el % de comisión para ver el monto"
              : ratesLabel(data.rates)}
          </Text>
          <Text style={styles.ratesEdit}>Editar</Text>
        </TouchableOpacity>

        {totalBaths === 0 && (
          <View style={styles.empty}>
            <Ionicons name="water-outline" size={32} color={COLORS.textTertiary} />
            <Text style={styles.emptyText}>No hay baños marcados como listos esta semana.</Text>
          </View>
        )}

        {totalBaths > 0 && (
          <WeekSection
            report={data}
            onPressBath={(b) => router.push(`/admin/reservation/${b.reservationId}` as any)}
          />
        )}

        {/* Citas que ya pasaron y nadie marcó como listas: si no se marcan, no
            entran a la comisión. */}
        {data.pending.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sin marcar como listos ({data.pending.length})</Text>
            <View style={styles.card}>
              <Text style={styles.pendingHint}>
                Estos baños no cuentan hasta que alguien los marque como listos.
              </Text>
              {data.pending.map((p) => (
                <TouchableOpacity
                  key={`${p.reservationId}-${p.scheduledAt}`}
                  style={styles.pendingRow}
                  onPress={() => router.push(`/admin/reservation/${p.reservationId}` as any)}
                >
                  <Ionicons name="time-outline" size={16} color={COLORS.warningText} />
                  <Text style={styles.pendingText}>
                    {formatName(p.petName)} · {formatWeekdayDayShort(p.scheduledAt, { timeZone: HMO_TZ })}{" "}
                    {formatTime(p.scheduledAt)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {totalBaths > 0 && (
          <TouchableOpacity style={styles.shareBtn} onPress={share}>
            <Ionicons name="share-outline" size={18} color={COLORS.white} />
            <Text style={styles.shareText}>Compartir resumen</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <RatesModal
        visible={ratesOpen}
        initial={data.rates}
        saving={ratesMutation.isPending}
        onClose={() => setRatesOpen(false)}
        onSave={(basePct, extrasPct) =>
          ratesMutation.mutate({ groomerCommissionPct: basePct, groomerExtrasCommissionPct: extrasPct })
        }
      />
    </View>
  );
}

function WeekSection({
  report: group,
  onPressBath,
}: {
  report: BathCommissionReport;
  onPressBath: (b: CommissionBathRow) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>COMISIÓN DE LA SEMANA</Text>
        <Text style={styles.totalValue}>{formatCurrency(group.commission)}</Text>
        <Text style={styles.totalMeta}>
          {group.count} baño{group.count === 1 ? "" : "s"} · baños {formatCurrency(group.baseTotal)} · corte/deslanado{" "}
          {formatCurrency(group.extrasTotal)}
        </Text>
      </View>
      <View style={styles.card}>
        {group.baths.map((b, i) => (
          <TouchableOpacity
            key={b.addonId}
            style={[styles.bathRow, i > 0 && styles.bathRowBorder]}
            onPress={() => onPressBath(b)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.bathPet}>
                {formatName(b.petName)}
                <Text style={styles.bathOwner}> · {formatName(b.ownerName)}</Text>
              </Text>
              <Text style={styles.bathMeta}>
                {formatWeekdayDayShort(b.completedAt, { timeZone: HMO_TZ })}
                {b.reservationType === "STAY" ? " · hospedado" : ""} · baño {formatCurrency(b.base)}
                {b.corte > 0 ? ` · corte ${formatCurrency(b.corte)}` : ""}
                {b.deslanado > 0 ? ` · deslanado ${formatCurrency(b.deslanado)}` : ""}
                {b.extrasIncluded > 0 ? ` · corte/deslanado ${formatCurrency(b.extrasIncluded)}` : ""}
              </Text>
              {b.flags.length > 0 && (
                <View style={styles.flags}>
                  {b.flags.map((f) => (
                    <View
                      key={f}
                      style={[styles.flag, FLAG_LABEL[f]?.tone === "warn" ? styles.flagWarn : styles.flagInfo]}
                    >
                      <Text
                        style={[
                          styles.flagText,
                          { color: FLAG_LABEL[f]?.tone === "warn" ? COLORS.warningText : COLORS.textTertiary },
                        ]}
                      >
                        {FLAG_LABEL[f]?.text ?? f}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <Text style={styles.bathCommission}>{formatCurrency(b.commission)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function RatesModal({
  visible,
  initial,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: { basePct: number; extrasPct: number };
  saving: boolean;
  onClose: () => void;
  onSave: (basePct: number, extrasPct: number) => void;
}) {
  const toText = (f: number) => (f > 0 ? String(Math.round(f * 1000) / 10) : "");
  const [base, setBase] = useState(toText(initial.basePct));
  const [extras, setExtras] = useState(toText(initial.extrasPct));
  const [lastInitial, setLastInitial] = useState(initial);
  // Al reabrir con otros valores guardados, el formulario arranca de ésos.
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setBase(toText(initial.basePct));
    setExtras(toText(initial.extrasPct));
  }

  const parse = (t: string) => {
    if (t.trim() === "") return 0;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
  };
  const baseF = parse(base);
  const extrasF = parse(extras);
  const valid = baseF !== null && extrasF !== null;

  const preview = useMemo(() => {
    if (!valid) return null;
    return `Ejemplo: baño de $350 con corte de $150 → ${formatCurrency(
      Math.round((350 * baseF! + 150 * extrasF!) * 100) / 100,
    )} de comisión`;
  }, [valid, baseF, extrasF]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet}>
            <Text style={styles.sheetTitle}>Porcentaje de comisión</Text>
            <Text style={styles.inputLabel}>Sobre el precio normal del baño (sin domicilio)</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={base}
                onChangeText={setBase}
                keyboardType="decimal-pad"
                placeholder="0"
                returnKeyType="done"
              />
              <Text style={styles.inputSuffix}>%</Text>
            </View>
            <Text style={styles.inputLabel}>Sobre corte y deslanado</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={extras}
                onChangeText={setExtras}
                keyboardType="decimal-pad"
                placeholder="0"
                returnKeyType="done"
              />
              <Text style={styles.inputSuffix}>%</Text>
            </View>
            {!valid && <Text style={styles.inputError}>Escribe un número entre 0 y 100.</Text>}
            {preview && <Text style={styles.preview}>{preview}</Text>}
            <TouchableOpacity
              style={[styles.shareBtn, (!valid || saving) && { opacity: 0.6 }]}
              disabled={!valid || saving}
              onPress={() => onSave(baseF!, extrasF!)}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.shareText}>Guardar</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgPage },
  weekNav: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 8,
    marginBottom: 12,
  },
  weekArrow: { padding: 8 },
  weekArrowDisabled: { opacity: 0.4 },
  weekCenter: { flex: 1, alignItems: "center" },
  weekLabel: { fontSize: 17, fontFamily: "Outfit_600SemiBold", color: COLORS.textPrimary },
  weekSub: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary, marginTop: 2 },
  ratesCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  ratesCardWarn: { backgroundColor: COLORS.warningBg },
  ratesText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textSecondary },
  ratesEdit: { fontSize: 13, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary, textAlign: "center" },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  totalCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  totalLabel: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    letterSpacing: 0.6,
  },
  totalValue: { fontSize: 34, fontFamily: "Outfit_600SemiBold", color: COLORS.primary, marginTop: 6 },
  totalMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 4,
    fontFamily: "PlusJakartaSans_600SemiBold",
    textAlign: "center",
  },
  card: { backgroundColor: COLORS.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  bathRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 10 },
  bathRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  bathPet: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  bathOwner: { fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary },
  bathMeta: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary, marginTop: 2 },
  bathCommission: { fontSize: 15, fontFamily: "Outfit_600SemiBold", color: COLORS.textPrimary },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  flag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  flagWarn: { backgroundColor: COLORS.warningBg },
  flagInfo: { backgroundColor: COLORS.bgSection },
  flagText: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold" },
  pendingHint: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary, paddingVertical: 8 },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  pendingText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textSecondary },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  shareText: { color: COLORS.white, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Outfit_600SemiBold", color: COLORS.textPrimary, marginBottom: 12 },
  inputLabel: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textSecondary, marginTop: 8 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  inputSuffix: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textSecondary },
  inputError: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.dangerText, marginTop: 8 },
  preview: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.textTertiary, marginTop: 10 },
});
