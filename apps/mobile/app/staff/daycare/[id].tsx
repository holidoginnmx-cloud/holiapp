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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import {
  getStaffDaycares,
  getChecklists,
  createStaffUpdate,
  checkInStaffDaycare,
  checkOutStaffDaycare,
  registerDaycareManualPayment,
  type StaffDaycare,
} from "@/lib/api";
import { uploadToCloudinary, cloudinaryResized } from "@/lib/cloudinary";
import { usePetPhoto } from "@/hooks/usePetPhoto";
import { useAuthStore } from "@/store/authStore";
import {
  formatName,
  formatCurrency,
  formatWeekdayDayShort,
  formatTimeHHmm,
  utcDayKey,
  localDayKey,
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
  const router = useRouter();
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.userId);
  const [payMethod, setPayMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [payAmount, setPayAmount] = useState("");
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["staff-daycares", "upcoming"],
    queryFn: () => getStaffDaycares(),
  });

  const daycare = useMemo(
    () => data?.daycares.find((d) => d.id === id) ?? null,
    [data, id],
  );

  // Reportes del día. La guardería usa el MISMO reporte diario que el
  // hospedaje (mood, comió/paseó/sanitario, notas y evidencia): el endpoint
  // solo pide que la reservación esté CHECKED_IN, no que sea una estancia.
  const { data: checklists } = useQuery({
    queryKey: ["staff", "checklists", id],
    queryFn: () => getChecklists(id!),
    enabled: !!id,
  });

  const todayChecklist = (checklists ?? []).find(
    (c) => utcDayKey(c.date) === localDayKey(),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["staff-daycares"] });
    qc.invalidateQueries({ queryKey: ["staff", "daycares"] });
  };

  // Foto del perro: mismo hook que la estancia y el baño.
  const { changePhoto: changePetPhoto, busy: petPhotoBusy } = usePetPhoto({
    petId: daycare?.pet?.id,
    petName: daycare?.pet?.name,
    currentPhotoUrl: daycare?.pet?.photoUrl,
    onSaved: invalidate,
  });

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

  // Evidencia suelta (sin reporte): la foto del momento que el dueño ve en su
  // reservación. Mismo flujo que el hospedaje, con cámara además de galería
  // porque en guardería casi siempre se toma en el instante.
  async function pickEvidence(source: "camera" | "library") {
    if (!daycare) return;
    const perm =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Permiso requerido",
        source === "camera"
          ? "Necesitamos acceso a la cámara."
          : "Necesitamos acceso a tus fotos.",
      );
      return;
    }
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
          });
    if (result.canceled) return;

    setUploadingEvidence(true);
    try {
      const cloud = await uploadToCloudinary(result.assets[0].uri, "daycares");
      await createStaffUpdate({
        mediaUrl: cloud.secure_url,
        mediaType: "image",
        caption: null,
        reservationId: daycare.id,
        petId: daycare.pet.id,
        staffId: currentUserId,
      });
      invalidate();
      qc.invalidateQueries({ queryKey: ["stay-updates", id] });
      Alert.alert("Listo", "La foto ya está en la reservación del dueño.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "No se pudo subir la evidencia");
    } finally {
      setUploadingEvidence(false);
    }
  }

  function promptEvidence() {
    Alert.alert("Subir evidencia", "¿De dónde tomamos la foto?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Tomar foto", onPress: () => pickEvidence("camera") },
      { text: "Elegir de galería", onPress: () => pickEvidence("library") },
    ]);
  }

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  if (!daycare) {
    // El detalle se saca de la lista de guarderías (hoy + 30 días): si se movió
    // a un día fuera de ese rango, deja de aparecer aquí y hay que buscarla en
    // el tablero por su día.
    return (
      <View style={styles.center}>
        <Ionicons name="sunny-outline" size={40} color={COLORS.border} />
        <Text style={styles.emptyText}>
          Guardería no encontrada. Si le cambiaste el día, búscala en el tablero
          de guarderías.
        </Text>
      </View>
    );
  }

  const status = STATUS_LABEL[daycare.status] ?? STATUS_LABEL.CONFIRMED;
  const balance = balanceOf(daycare);
  const paid = daycare.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const extra = extraHoursAddon(daycare);
  const phone = daycare.owner?.phone;
  // Concluida ya cobró sus horas extra al recoger: moverle el horario después
  // descuadraría ese cobro.
  const canEditSchedule =
    daycare.status === "CONFIRMED" || daycare.status === "CHECKED_IN";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Encabezado */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          {/* La foto del perro, no el icono genérico de guardería: en el patio
              hay varios a la vez y el equipo necesita saber cuál es cuál sin
              agacharse a leerle la placa. Si no hay foto, el tap la captura. */}
          <TouchableOpacity
            onPress={changePetPhoto}
            disabled={petPhotoBusy}
            activeOpacity={0.8}
            testID="staff-daycare-pet-photo"
          >
            {daycare.pet?.photoUrl ? (
              <Image
                source={{ uri: cloudinaryResized(daycare.pet.photoUrl, 120, "fill") }}
                style={styles.petIconWrap}
              />
            ) : (
              <View style={styles.petIconWrap}>
                <Ionicons name="paw" size={20} color={COLORS.primary} />
              </View>
            )}
            {petPhotoBusy ? (
              <View style={styles.petPhotoOverlay}>
                <ActivityIndicator size="small" color={COLORS.white} />
              </View>
            ) : (
              <View style={styles.petPhotoBadge}>
                <Ionicons name="camera" size={10} color={COLORS.white} />
              </View>
            )}
          </TouchableOpacity>
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

        {/* Día + horas — tocable para moverlos mientras la guardería siga
            viva. Es la petición más común del cliente ("me lo recogen hasta
            las 7") y hasta ahora había que cancelar y volver a capturar. */}
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={!canEditSchedule}
          onPress={() =>
            router.push(`/staff/daycare/edit-schedule?id=${daycare.id}` as any)
          }
          testID="staff-daycare-edit-schedule"
        >
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
            <Text style={styles.infoText}>
              {daycare.appointmentAt
                ? formatWeekdayDayShort(daycare.appointmentAt)
                : "—"}
            </Text>
            {canEditSchedule && (
              <Ionicons name="pencil" size={12} color={COLORS.primary} />
            )}
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
        </TouchableOpacity>
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

      {/* Reporte del día — mismo reporte que el hospedaje. Solo mientras el
          perro está aquí: el endpoint exige la reservación CHECKED_IN. */}
      {daycare.status === "CHECKED_IN" && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Reporte del día</Text>
          {todayChecklist ? (
            <View style={styles.reportDoneRow}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={COLORS.successText}
              />
              <Text style={styles.reportDoneText}>
                Reporte de hoy enviado al dueño
              </Text>
            </View>
          ) : (
            <View style={styles.missingReportBanner}>
              <Ionicons
                name="document-text-outline"
                size={16}
                color={COLORS.warningText}
              />
              <Text style={styles.missingReportText}>
                Aún no se ha enviado el reporte de hoy
              </Text>
            </View>
          )}
          <View style={styles.reportRow}>
            <TouchableOpacity
              style={styles.reportBtn}
              onPress={() => router.push(`/staff/checklist/${daycare.id}` as any)}
              activeOpacity={0.85}
              testID="staff-daycare-checklist"
            >
              <Ionicons
                name="document-text-outline"
                size={16}
                color={COLORS.white}
              />
              <Text style={styles.reportBtnText}>
                {todayChecklist ? "Ver reporte" : "Llenar reporte"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reportBtnSecondary}
              onPress={promptEvidence}
              disabled={uploadingEvidence}
              activeOpacity={0.85}
              testID="staff-daycare-evidence"
            >
              {uploadingEvidence ? (
                <ActivityIndicator color={COLORS.primary} size="small" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.reportBtnSecondaryText}>Subir foto</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Agregar servicio — el caso de todos los días: el perro entra a
          guardería y en el mostrador piden el baño. Antes había que buscar a un
          admin; quien lo recibe es quien lo anota. La misma pantalla del admin,
          sin el toggle de cortesía (eso sigue siendo decisión de admin). */}
      {daycare.status !== "CANCELLED" && daycare.status !== "CHECKED_OUT" && (
        <TouchableOpacity
          style={styles.historyCard}
          onPress={() =>
            router.push(`/admin/reservation/add-addon?id=${daycare.id}` as any)
          }
          activeOpacity={0.85}
          testID="staff-daycare-add-addon"
        >
          <View style={styles.historyIcon}>
            <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.historyTitle}>Agregar servicio</Text>
            <Text style={styles.historySubtitle}>
              Súmale un baño o un desparasitante a esta guardería
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
        </TouchableOpacity>
      )}

      {/* Historial de reportes de esta guardería */}
      {(checklists?.length ?? 0) > 0 && (
        <TouchableOpacity
          style={styles.historyCard}
          onPress={() => router.push(`/reservation/checklists/${daycare.id}` as any)}
          activeOpacity={0.85}
          testID="staff-daycare-checklists-link"
        >
          <View style={styles.historyIcon}>
            <Ionicons name="images-outline" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.historyTitle}>Reportes y fotos</Text>
            <Text style={styles.historySubtitle}>
              {checklists!.length}{" "}
              {checklists!.length === 1 ? "reporte" : "reportes"} de{" "}
              {formatName(daycare.pet?.name ?? "—")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
        </TouchableOpacity>
      )}

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
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
  },
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
  petPhotoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  petPhotoBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: { fontSize: 17, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  petMeta: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 12, fontFamily: "PlusJakartaSans_700Bold" },
  divider: { height: 1, backgroundColor: COLORS.bgSection, marginVertical: 12 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  infoText: { flex: 1, fontSize: 14, color: COLORS.textSecondary, fontFamily: "PlusJakartaSans_600SemiBold" },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  ownerName: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
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
  callBtnText: { color: COLORS.primary, fontSize: 14, fontFamily: "PlusJakartaSans_700Bold" },
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
  payLabel: { fontSize: 14, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_600SemiBold" },
  payLabelSub: { fontSize: 12, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_600SemiBold" },
  payLabelBold: { fontSize: 15, color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_700Bold" },
  payValue: { fontSize: 15, color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_700Bold" },
  payValueSub: { fontSize: 12, color: COLORS.textTertiary, fontFamily: "PlusJakartaSans_600SemiBold" },
  payValueBold: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold" },
  paySub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
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
  methodChipText: { fontSize: 13, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textTertiary },
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    paddingVertical: 12,
  },
  reportRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  reportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  reportBtnText: { color: COLORS.white, fontSize: 14, fontFamily: "PlusJakartaSans_700Bold" },
  reportBtnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    paddingVertical: 12,
  },
  reportBtnSecondaryText: {
    color: COLORS.primary,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  missingReportBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.warningBg,
    borderRadius: 10,
    padding: 10,
  },
  missingReportText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.warningText,
  },
  reportDoneRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  reportDoneText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.successText,
  },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  historySubtitle: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
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
  primaryBtnText: { color: COLORS.white, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
  payBtn: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 14,
  },
  payBtnText: { color: COLORS.white, fontSize: 15, fontFamily: "PlusJakartaSans_700Bold" },
});
