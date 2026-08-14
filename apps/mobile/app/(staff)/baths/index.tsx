import { COLORS } from "@/constants/colors";
import { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import {
  getStaffBaths,
  completeStaffBath,
  setBathExtrasPrice,
  confirmExtrasPaidAtPickup,
  type StaffBath,
} from "@/lib/api";
import { uploadToCloudinary } from "@/lib/cloudinary";
import {
  getBathAddon,
  isBathPhysicallyDone,
  isBathConcluded,
  isBathReadyToCollect,
} from "@/lib/bathStatus";
import {
  formatName,
  formatCurrency,
  formatWeekdayDayShort,
  formatTime,
  hotelYMD,
} from "@/lib/format";
import { ReservationCard } from "@/components/ReservationCard";
import { FilterTabsUnderline } from "@/components/FilterTabsUnderline";
import { ErrorState } from "@/components/ErrorState";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";

type BathTypeFilter = "loose" | "stay";


function todayYMD(): string {
  return hotelYMD(new Date());
}

function formatDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const today = todayYMD();
  const diffDays = Math.round(
    (date.getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) /
      (24 * 3600 * 1000),
  );
  const label = formatWeekdayDayShort(date, { timeZone: "UTC" });
  if (diffDays === 0) return `Hoy · ${label}`;
  if (diffDays === 1) return `Mañana · ${label}`;
  return label;
}

function formatDurationMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/**
 * Ids de las citas que se pisan con otra del mismo día.
 *
 * Es lo que antes no se veía: con todos los baños contados como si duraran lo
 * mismo, dos citas separadas por una hora parecían caber aunque la primera se
 * llevara dos.
 */
function findOverlaps(baths: StaffBath[]): Set<string> {
  const conHora = baths
    // `groomingScheduled === false` = la "hora" es el check-out, no una cita:
    // si se cuentan, todos los baños de salida del día caen en el mismo
    // minuto y se marcan entre ellos como encimados sin estarlo.
    .filter((b) => b.appointmentAt && b.durationMinutes && b.groomingScheduled !== false)
    .map((b) => ({
      id: b.id,
      start: new Date(b.appointmentAt!).getTime(),
      end: new Date(b.appointmentAt!).getTime() + b.durationMinutes! * 60000,
    }))
    .sort((a, b) => a.start - b.start);

  const out = new Set<string>();
  for (let i = 0; i < conHora.length - 1; i++) {
    const a = conHora[i];
    const b = conHora[i + 1];
    if (b.start < a.end) {
      out.add(a.id);
      out.add(b.id);
    }
  }
  return out;
}

type Row =
  | { type: "header"; title: string; count: number }
  | { type: "item"; bath: StaffBath };

// Agrupa pendientes por día (Hermosillo) y concluidos al final.
function buildRows(baths: StaffBath[]): Row[] {
  const pending = baths.filter((b) => !isBathConcluded(b));
  const done = baths.filter((b) => isBathConcluded(b));
  const out: Row[] = [];
  const byDay = new Map<string, StaffBath[]>();
  for (const b of pending) {
    const ymd = b.appointmentAt ? hotelYMD(b.appointmentAt) : "—";
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd)!.push(b);
  }
  const sortedDays = Array.from(byDay.keys()).sort();
  for (const ymd of sortedDays) {
    const items = byDay.get(ymd)!;
    out.push({
      type: "header",
      title: formatDayHeader(ymd),
      count: items.length,
    });
    for (const b of items) out.push({ type: "item", bath: b });
  }
  if (done.length > 0) {
    out.push({ type: "header", title: "Completados", count: done.length });
    for (const b of done) out.push({ type: "item", bath: b });
  }
  return out;
}

export default function StaffBaths() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { isTablet } = useResponsive();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<BathTypeFilter>("loose");
  // Ref espejo del filtro: selectTab lo lee sin depender del render en curso.
  const typeFilterRef = useRef<BathTypeFilter>(typeFilter);
  typeFilterRef.current = typeFilter;

  // Animated.Value que controla la posición del underline (0..1).
  // 0 = Suelto, 1 = Hospedaje.
  //
  // Ya no hay swipe horizontal ni track deslizante: las dos listas vivían
  // anidadas dentro de él y, con el scroll a esa profundidad, iOS 26 no engancha
  // el minimize del tab bar (solo lo hace con el scroll que es primera subvista
  // del view controller). Se pinta solo la lista activa y se cambia tocando.
  const tabProgress = useRef(new Animated.Value(0)).current;

  // Alto real de la cabecera flotante (título + pestañas), para despejar el
  // contenido de la lista sin números mágicos.
  const [headerHeight, setHeaderHeight] = useState(0);

  function snapToTab(target: BathTypeFilter) {
    Animated.spring(tabProgress, {
      toValue: target === "loose" ? 0 : 1,
      // El underline solo anima translateX → sí va por el driver nativo.
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start();
  }

  function selectTab(target: BathTypeFilter) {
    if (target !== typeFilterRef.current) setTypeFilter(target);
    snapToTab(target);
  }
  // Modal de cotización abierto para un extra específico (deslanado/corte).
  const [extrasAddon, setExtrasAddon] = useState<{
    addonId: string;
    petName: string;
    kind: "deslanado" | "corte";
    currentPrice: number | null;
  } | null>(null);

  const confirmPickupMutation = useMutation({
    mutationFn: (vars: { addonId: string; method: "CASH" | "TRANSFER" }) =>
      confirmExtrasPaidAtPickup(vars.addonId, { method: vars.method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["staff-baths", "upcoming"],
    queryFn: () => getStaffBaths(),
    refetchInterval: 60_000,
  });

  // El intervalo de 60s ya la mantiene fresca, pero al volver a la pestaña se
  // quiere la agenda del día YA, no en el próximo tick.
  useRefetchOnFocus([["staff-baths"]]);

  const allBaths = data?.baths ?? [];

  // Citas que se pisan entre sí: hay que poder verlas antes de que pase.
  const overlapIds = useMemo(() => findOverlaps(allBaths), [allBaths]);

  const counts = useMemo(() => {
    return {
      loose: allBaths.filter((b) => b.reservationType === "BATH").length,
      stay: allBaths.filter((b) => b.reservationType === "STAY").length,
    };
  }, [allBaths]);

  // Baños por tipo: solo se pinta el del filtro activo.
  const looseBaths = useMemo(
    () => allBaths.filter((b) => b.reservationType === "BATH"),
    [allBaths],
  );
  const stayBaths = useMemo(
    () => allBaths.filter((b) => b.reservationType === "STAY"),
    [allBaths],
  );
  const activeBaths = typeFilter === "loose" ? looseBaths : stayBaths;

  const pending = useMemo(
    () => activeBaths.filter((b) => !isBathConcluded(b)),
    [activeBaths],
  );
  const revenue = useMemo(
    () => activeBaths.reduce((sum, b) => sum + Number(b.totalAmount), 0),
    [activeBaths],
  );

  async function pickPhoto(source: "camera" | "library"): Promise<string | null> {
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permiso requerido", "Necesitamos acceso a la cámara.");
        return null;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled) return null;
      return result.assets[0].uri;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tus fotos.");
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return null;
    return result.assets[0].uri;
  }

  async function uploadAndComplete(bath: StaffBath, source: "camera" | "library") {
    const uri = await pickPhoto(source);
    if (!uri) return;
    setCompletingId(bath.id);
    try {
      const cloud = await uploadToCloudinary(uri, "baths");
      await completeStaffBath(bath.id, cloud.secure_url);
      queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo completar";
      Alert.alert("Error", msg);
    } finally {
      setCompletingId(null);
    }
  }

  // Sin foto se pide confirmar: que siga siendo la excepción y no la costumbre.
  async function completeWithoutPhoto(bath: StaffBath) {
    setCompletingId(bath.id);
    try {
      await completeStaffBath(bath.id);
      queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo completar";
      Alert.alert("Error", msg);
    } finally {
      setCompletingId(null);
    }
  }

  function askCompleteWithoutPhoto(bath: StaffBath) {
    Alert.alert(
      "¿Completar sin foto?",
      "Al cliente le encanta recibir la foto de su perro recién bañado. ¿Seguro que quieres completar la cita sin foto?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Completar",
          style: "destructive",
          onPress: () => completeWithoutPhoto(bath),
        },
      ],
    );
  }

  async function handleComplete(bath: StaffBath) {
    Alert.alert(
      "Foto del baño",
      `Sube una foto de ${formatName(bath.pet?.name ?? "—")} bañado para completar la cita.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Tomar foto", onPress: () => uploadAndComplete(bath, "camera") },
        { text: "Elegir foto", onPress: () => uploadAndComplete(bath, "library") },
        { text: "Completar sin foto", onPress: () => askCompleteWithoutPhoto(bath) },
      ],
    );
  }

  const renderBath = ({ item }: { item: StaffBath }) => {
    const physicallyDone = isBathPhysicallyDone(item);
    const concluded = isBathConcluded(item);
    const bathAddon = getBathAddon(item);
    const hasDeslanado = bathAddon?.variant?.deslanado ?? false;
    const hasCorte = bathAddon?.variant?.corte ?? false;
    const seEncima = overlapIds.has(item.id);
    const sinHorario = item.groomingScheduled === false;

    return (
      <View testID={`bath-card-${item.id}`} style={styles.bathBlock}>
        {item.appointmentAt && item.durationMinutes != null && !concluded && (
          <View style={[styles.schedulePill, seEncima && styles.schedulePillWarn]}>
            <Ionicons
              name={seEncima ? "alert-circle-outline" : "time-outline"}
              size={13}
              color={seEncima ? COLORS.errorText : COLORS.textTertiary}
            />
            <Text style={[styles.scheduleText, seEncima && styles.scheduleTextWarn]}>
              {sinHorario ? (
                // Baño de hospedaje al que nadie le asignó hora de estética:
                // `appointmentAt` es el día de salida, no una cita. Pintarlo
                // como "5:00 a.m. – 6:00 a.m." era inventarse un horario.
                <>
                  Sin hora asignada · {formatDurationMin(item.durationMinutes)} ·
                  antes del checkout
                </>
              ) : (
                <>
                  {formatTime(new Date(item.appointmentAt))}
                  {item.appointmentEndAt
                    ? ` – ${formatTime(new Date(item.appointmentEndAt))}`
                    : ""}
                  {" · "}
                  {formatDurationMin(item.durationMinutes)}
                  {seEncima ? " · se encima" : ""}
                </>
              )}
            </Text>
          </View>
        )}
        <ReservationCard
          petName={item.pet?.name ?? "—"}
          roomName={null}
          status={item.status}
          checkIn={item.checkIn}
          checkOut={item.checkOut}
          reservationType={item.reservationType}
          appointmentAt={item.appointmentAt}
          totalAmount={Number(item.totalAmount)}
          ownerName={`${item.owner?.firstName ?? ""} ${item.owner?.lastName ?? ""}`.trim() || "Sin dueño"}
          paymentType={item.paymentType}
          hasBalance={false}
          hasDeslanado={hasDeslanado}
          hasCorte={hasCorte}
          bathReady={isBathReadyToCollect(item)}
          onPress={() =>
            router.push(
              item.reservationType === "BATH"
                ? (`/staff/bath/${item.id}` as any)
                : (`/staff/stay/${item.id}` as any),
            )
          }
        />

        {!physicallyDone && (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[
                styles.completeBtn,
                completingId === item.id && styles.completeBtnDisabled,
              ]}
              onPress={() => handleComplete(item)}
              disabled={completingId === item.id}
              testID={`bath-complete-${item.id}`}
            >
              {completingId === item.id ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <>
                  <Ionicons name="camera" size={16} color={COLORS.white} />
                  <Text style={styles.completeText}>Marcar listo</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Extras (deslanado/corte) — staff cotiza cada uno por separado.
            Una vez completos, fluye por extraPaymentStatus. */}
        {(() => {
          if (!bathAddon) return null;
          const hasExtras = bathAddon.variant?.deslanado || bathAddon.variant?.corte;
          if (!hasExtras) return null;

          if (bathAddon.extraPrice && bathAddon.extraPaymentStatus === "PAID") {
            return (
              <View style={styles.extrasStatusPaid}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
                <Text style={styles.extrasStatusPaidText}>
                  Extras cobrados · {formatCurrency(bathAddon.extraPrice)}
                </Text>
              </View>
            );
          }
          if (bathAddon.extraPrice && bathAddon.extraPaymentStatus === "PAY_ON_PICKUP") {
            return (
              <TouchableOpacity
                style={styles.extrasPickupBtn}
                onPress={() => {
                  Alert.alert(
                    "Confirmar pago",
                    `¿Cómo recibiste ${formatCurrency(bathAddon.extraPrice)} de ${formatName(item.pet?.name ?? "—")}?`,
                    [
                      { text: "Cancelar", style: "cancel" },
                      {
                        text: "Efectivo",
                        onPress: () =>
                          confirmPickupMutation.mutate({
                            addonId: bathAddon.id,
                            method: "CASH",
                          }),
                      },
                      {
                        text: "Transferencia",
                        onPress: () =>
                          confirmPickupMutation.mutate({
                            addonId: bathAddon.id,
                            method: "TRANSFER",
                          }),
                      },
                    ],
                  );
                }}
              >
                <Ionicons name="cash-outline" size={14} color={COLORS.warningText} />
                <Text style={styles.extrasPickupBtnText}>
                  Cobrar {formatCurrency(bathAddon.extraPrice)} al recoger
                </Text>
              </TouchableOpacity>
            );
          }
          if (bathAddon.extraPrice && bathAddon.extraPaymentStatus === "PENDING_PAYMENT") {
            return (
              <View style={styles.extrasPending}>
                <Ionicons name="time-outline" size={14} color={COLORS.infoText} />
                <Text style={styles.extrasPendingText}>
                  Owner debe elegir cómo pagar {formatCurrency(bathAddon.extraPrice)}
                </Text>
              </View>
            );
          }
          // Modo cotización por extra (solo cuando el baño ya está físicamente listo).
          if (!physicallyDone) return null;
          const open = (kind: "deslanado" | "corte") =>
            setExtrasAddon({
              addonId: bathAddon.id,
              petName: item.pet?.name ?? "—",
              kind,
              currentPrice:
                kind === "deslanado"
                  ? bathAddon.extraDeslanadoPrice
                    ? Number(bathAddon.extraDeslanadoPrice)
                    : null
                  : bathAddon.extraCortePrice
                    ? Number(bathAddon.extraCortePrice)
                    : null,
            });
          return (
            <View style={{ gap: 6 }}>
              {bathAddon.variant?.deslanado &&
                (bathAddon.extraDeslanadoPrice ? (
                  <View style={styles.extraSetChip}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
                    <Text style={styles.extraSetChipLabel}>Deslanado</Text>
                    <Text style={styles.extraSetChipPrice}>
                      {formatCurrency(bathAddon.extraDeslanadoPrice)}
                    </Text>
                    <TouchableOpacity onPress={() => open("deslanado")} hitSlop={8}>
                      <Ionicons name="pencil" size={13} color={COLORS.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.extrasSetBtn}
                    onPress={() => open("deslanado")}
                  >
                    <Ionicons name="pricetag-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.extrasSetBtnText}>Cobrar deslanado</Text>
                  </TouchableOpacity>
                ))}
              {bathAddon.variant?.corte &&
                (bathAddon.extraCortePrice ? (
                  <View style={styles.extraSetChip}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
                    <Text style={styles.extraSetChipLabel}>Corte</Text>
                    <Text style={styles.extraSetChipPrice}>
                      {formatCurrency(bathAddon.extraCortePrice)}
                    </Text>
                    <TouchableOpacity onPress={() => open("corte")} hitSlop={8}>
                      <Ionicons name="pencil" size={13} color={COLORS.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.extrasSetBtn}
                    onPress={() => open("corte")}
                  >
                    <Ionicons name="pricetag-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.extrasSetBtnText}>Cobrar corte</Text>
                  </TouchableOpacity>
                ))}
            </View>
          );
        })()}
      </View>
    );
  };

  const rowsLoose = useMemo(() => buildRows(looseBaths), [looseBaths]);
  const rowsStay = useMemo(() => buildRows(stayBaths), [stayBaths]);

  // Cabecera fija: va absoluta ENCIMA de la lista (fuera de su scroll) para que
  // el scroll pueda ser la raíz de la pantalla y iOS 26 encoja el tab bar.
  const floatingHeader = (
    <View
      style={styles.floatingHeader}
      onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
    >
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Próximos baños</Text>
        <Text style={styles.topSub}>
          {pending.length} pendiente{pending.length === 1 ? "" : "s"}
          {" · "}
          {formatCurrency(revenue)} en total
        </Text>
      </View>

      <FilterTabsUnderline
        tabs={[
          { key: "loose", label: "Suelto", count: counts.loose },
          { key: "stay", label: "Hospedaje", count: counts.stay },
        ]}
        activeTab={typeFilter}
        onSelect={(k) => selectTab(k as BathTypeFilter)}
        justified
        progress={tabProgress}
      />
    </View>
  );

  if (isError || isLoading) {
    return (
      <View style={styles.container}>
        {floatingHeader}
        <View style={{ marginTop: headerHeight }}>
          {isError ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <>
      <FlatList<Row>
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        data={typeFilter === "loose" ? rowsLoose : rowsStay}
        keyExtractor={(item, i) =>
          item.type === "item" ? item.bath.id : `${item.type}-${i}`
        }
        renderItem={({ item }) => {
          if (item.type === "header") {
            return (
              <Text style={styles.sectionHeader}>
                {item.title} · {item.count}
              </Text>
            );
          }
          return renderBath({ item: item.bath });
        }}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerHeight + 12 },
          isTablet && styles.listContentTablet,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            // Sin esto la ruedita gira DETRÁS de la cabecera flotante.
            progressViewOffset={headerHeight}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="water-outline" size={32} color={COLORS.border} />
            <Text style={styles.emptyText}>
              {typeFilter === "loose"
                ? "No hay baños sueltos"
                : "No hay baños de hospedaje"}
            </Text>
          </View>
        }
      />

      {floatingHeader}

      {extrasAddon && (
        <ExtrasPriceModal
          addonId={extrasAddon.addonId}
          petName={extrasAddon.petName}
          kind={extrasAddon.kind}
          currentPrice={extrasAddon.currentPrice}
          onClose={() => setExtrasAddon(null)}
          onSuccess={() => {
            setExtrasAddon(null);
            queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
          }}
        />
      )}
    </>
  );
}

// ─── Modal para que staff defina precio del deslanado/corte ──

function ExtrasPriceModal({
  addonId,
  petName,
  kind,
  currentPrice,
  onClose,
  onSuccess,
}: {
  addonId: string;
  petName: string;
  kind: "deslanado" | "corte";
  currentPrice: number | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [priceStr, setPriceStr] = useState(
    currentPrice ? String(currentPrice) : "",
  );
  const label = kind === "deslanado" ? "Deslanado" : "Corte";

  const mutation = useMutation({
    mutationFn: () => {
      const price = Number(priceStr);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Ingresa un precio válido");
      }
      const payload =
        kind === "deslanado"
          ? { extraDeslanadoPrice: price }
          : { extraCortePrice: price };
      return setBathExtrasPrice(addonId, payload);
    },
    onSuccess: () => onSuccess(),
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={extrasStyles.overlay} onPress={onClose}>
          <Pressable
            style={extrasStyles.card}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={extrasStyles.header}>
              <Text style={extrasStyles.title}>
                Precio de {label.toLowerCase()}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={22} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>
            <Text style={extrasStyles.subtitle}>
              {formatName(petName)} · el owner verá este monto desglosado en su reserva.
            </Text>

            <View style={extrasStyles.priceInputWrap}>
              <Text style={extrasStyles.priceSymbol}>$</Text>
              <TextInput
                style={extrasStyles.priceInput}
                value={priceStr}
                onChangeText={setPriceStr}
                placeholder="0"
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="numeric"
                autoFocus
              />
            </View>

            <View style={extrasStyles.actions}>
              <TouchableOpacity
                style={extrasStyles.cancelBtn}
                onPress={onClose}
              >
                <Text style={extrasStyles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  extrasStyles.saveBtn,
                  mutation.isPending && { opacity: 0.7 },
                ]}
                onPress={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                <Text style={extrasStyles.saveBtnText}>
                  {mutation.isPending ? "Guardando..." : "Guardar precio"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const extrasStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 32,
    // En iPad el bottom-sheet se acota y centra; en teléfono (ancho < 520)
    // width:100% manda y no cambia nada.
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  priceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  priceSymbol: {
    fontSize: 26,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textTertiary,
  },
  priceInput: {
    flex: 1,
    fontSize: 26,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});

const styles = StyleSheet.create({
  schedulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.bgSection,
    marginBottom: 6,
  },
  schedulePillWarn: { backgroundColor: COLORS.errorBg },
  scheduleText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  scheduleTextWarn: { color: COLORS.errorText },
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topTitle: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  topSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  // Cabecera fija sobre la lista: la lista tiene que ser la raíz del screen
  // para que iOS 26 enganche el minimize del tab bar.
  floatingHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.bgPage,
  },
  listContent: { padding: 16, paddingBottom: 24 },
  // En iPad se acota y centra el contenido (la cabecera sigue a ancho completo).
  listContentTablet: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },
  sectionHeader: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  bathBlock: {
    marginBottom: 4,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: -4,
    marginBottom: 8,
  },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  callBtnText: {
    color: COLORS.primary,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  completeBtn: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 10,
  },
  completeBtnDisabled: { opacity: 0.7 },
  completeText: { color: COLORS.white, fontSize: 14, fontFamily: "PlusJakartaSans_700Bold" },
  extrasSetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    paddingVertical: 9,
    borderRadius: 8,
    marginBottom: 12,
  },
  extrasSetBtnText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  extrasStatusPaid: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: COLORS.successBg,
    paddingVertical: 7,
    borderRadius: 8,
    marginBottom: 12,
  },
  extrasStatusPaidText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.successText,
  },
  extrasPickupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.warningBg,
    paddingVertical: 9,
    borderRadius: 8,
    marginBottom: 12,
  },
  extrasPickupBtnText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.warningText,
  },
  extraSetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  extraSetChipLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.successText,
  },
  extraSetChipPrice: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.successText,
  },
  extrasPending: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: COLORS.infoBg,
    paddingVertical: 7,
    borderRadius: 8,
    marginBottom: 12,
  },
  extrasPendingText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.infoText,
  },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textDisabled },
});
