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
  Linking,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
  Dimensions,
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
import { formatName, phoneToTelUri } from "@/lib/format";
import { ReservationCard } from "@/components/ReservationCard";
import { FilterTabsUnderline } from "@/components/FilterTabsUnderline";

type BathTypeFilter = "loose" | "stay";

const TZ_OFFSET_HOURS = 7; // Hermosillo UTC-7

function localYMD(value: string | Date): string {
  const d = new Date(value);
  const local = new Date(d.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function todayYMD(): string {
  return localYMD(new Date());
}

function formatDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const today = todayYMD();
  const diffDays = Math.round(
    (date.getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) /
      (24 * 3600 * 1000),
  );
  const label = date.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (diffDays === 0) return `Hoy · ${label}`;
  if (diffDays === 1) return `Mañana · ${label}`;
  return label;
}

function getBathAddon(bath: StaffBath) {
  return bath.addons.find((a) => a.variant?.serviceType?.code === "BATH");
}

// Físicamente terminado (foto subida). No equivale a "concluido" — baños
// sueltos quedan en este estado hasta que se liquide el saldo.
function isBathPhysicallyDone(bath: StaffBath): boolean {
  return !!getBathAddon(bath)?.completedAt;
}

// Concluido = totalmente cerrado (status CHECKED_OUT para sueltos, addon
// completado para hospedajes — éstos no requieren liquidación aquí).
function isBathConcluded(bath: StaffBath): boolean {
  if (bath.reservationType === "BATH") return bath.status === "CHECKED_OUT";
  return !!getBathAddon(bath)?.completedAt;
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
    const ymd = b.appointmentAt ? localYMD(b.appointmentAt) : "—";
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
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<BathTypeFilter>("loose");
  // Ref espejo del filtro para que el PanResponder lea el valor actual sin
  // recrearse en cada render (cierre estable).
  const typeFilterRef = useRef<BathTypeFilter>(typeFilter);
  typeFilterRef.current = typeFilter;

  // Animated.Value que controla la posición del underline y del contenido
  // (0..1). 0 = Suelto, 1 = Hospedaje. Lo actualiza el PanResponder en tiempo
  // real para que tanto la línea como el contenido sigan al dedo.
  const tabProgress = useRef(new Animated.Value(0)).current;

  // Ancho del contenido (= screen width). Lo medimos via onLayout para precisión.
  const [contentWidth, setContentWidth] = useState(
    Dimensions.get("window").width,
  );
  const contentWidthRef = useRef(contentWidth);
  contentWidthRef.current = contentWidth;

  function snapToTab(target: BathTypeFilter) {
    Animated.spring(tabProgress, {
      toValue: target === "loose" ? 0 : 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start();
  }

  function selectTab(target: BathTypeFilter) {
    if (target !== typeFilterRef.current) setTypeFilter(target);
    snapToTab(target);
  }

  // PanResponder: detecta swipe horizontal en el contenido para cambiar de
  // tab (Suelto ↔ Hospedaje). Mueve el underline pixel a pixel con el dedo,
  // y al soltar hace snap al tab más cercano.
  const swipePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
      },
      onPanResponderMove: (_e, g) => {
        const w = contentWidthRef.current;
        if (w <= 0) return;
        const base = typeFilterRef.current === "loose" ? 0 : 1;
        // Swipe izquierda (dx negativo) → progress aumenta hacia 1.
        // Normalizamos por el ancho COMPLETO del contenido, no por tabWidth,
        // para que el contenido se mueva 1:1 con el dedo.
        const next = Math.max(0, Math.min(1, base + -g.dx / w));
        tabProgress.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const threshold = 50;
        let target = typeFilterRef.current;
        if (g.dx <= -threshold && typeFilterRef.current === "loose") {
          target = "stay";
        } else if (g.dx >= threshold && typeFilterRef.current === "stay") {
          target = "loose";
        }
        selectTab(target);
      },
      onPanResponderTerminate: () => {
        snapToTab(typeFilterRef.current);
      },
    }),
  ).current;
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

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["staff-baths", "upcoming"],
    queryFn: () => getStaffBaths(),
    refetchInterval: 60_000,
  });

  const allBaths = data?.baths ?? [];

  const counts = useMemo(() => {
    return {
      loose: allBaths.filter((b) => b.reservationType === "BATH").length,
      stay: allBaths.filter((b) => b.reservationType === "STAY").length,
    };
  }, [allBaths]);

  // Computamos baños por tipo. Renderizamos AMBAS listas a la vez para
  // animar el swipe horizontal entre tabs.
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

  async function handleComplete(bath: StaffBath) {
    Alert.alert(
      "Foto del baño",
      `Sube una foto de ${formatName(bath.pet.name)} bañado para completar la cita.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Tomar foto", onPress: () => uploadAndComplete(bath, "camera") },
        { text: "Elegir foto", onPress: () => uploadAndComplete(bath, "library") },
      ],
    );
  }

  const renderBath = ({ item }: { item: StaffBath }) => {
    const physicallyDone = isBathPhysicallyDone(item);
    const concluded = isBathConcluded(item);
    const ownerPhone = item.owner.phone;
    const bathAddon = getBathAddon(item);
    const hasDeslanado = bathAddon?.variant?.deslanado ?? false;
    const hasCorte = bathAddon?.variant?.corte ?? false;

    return (
      <View testID={`bath-card-${item.id}`} style={styles.bathBlock}>
        <ReservationCard
          petName={item.pet.name}
          roomName={null}
          status={item.status}
          checkIn={item.checkIn}
          checkOut={item.checkOut}
          reservationType={item.reservationType}
          appointmentAt={item.appointmentAt}
          totalAmount={Number(item.totalAmount)}
          ownerName={`${item.owner.firstName} ${item.owner.lastName}`}
          paymentType={item.paymentType}
          hasBalance={false}
          hasDeslanado={hasDeslanado}
          hasCorte={hasCorte}
          onPress={() =>
            router.push(
              item.reservationType === "BATH"
                ? (`/staff/bath/${item.id}` as any)
                : (`/staff/stay/${item.id}` as any),
            )
          }
        />

        <View style={styles.actionsRow}>
          {ownerPhone && (
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${phoneToTelUri(ownerPhone)}`)}
              style={styles.callBtn}
              hitSlop={6}
              testID={`bath-call-${item.id}`}
            >
              <Ionicons name="call" size={16} color={COLORS.primary} />
              <Text style={styles.callBtnText}>Llamar</Text>
            </TouchableOpacity>
          )}
          {!physicallyDone && (
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
          )}
        </View>

        {/* Extras (deslanado/corte) — staff cotiza cada uno por separado.
            Una vez completos, fluye por extraPaymentStatus. */}
        {(() => {
          if (!bathAddon) return null;
          const hasExtras = bathAddon.variant.deslanado || bathAddon.variant.corte;
          if (!hasExtras) return null;

          if (bathAddon.extraPrice && bathAddon.extraPaymentStatus === "PAID") {
            return (
              <View style={styles.extrasStatusPaid}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
                <Text style={styles.extrasStatusPaidText}>
                  Extras cobrados · ${Number(bathAddon.extraPrice).toLocaleString("es-MX")}
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
                    `¿Cómo recibiste $${Number(bathAddon.extraPrice).toLocaleString("es-MX")} de ${formatName(item.pet.name)}?`,
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
                  Cobrar ${Number(bathAddon.extraPrice).toLocaleString("es-MX")} al recoger
                </Text>
              </TouchableOpacity>
            );
          }
          if (bathAddon.extraPrice && bathAddon.extraPaymentStatus === "PENDING_PAYMENT") {
            return (
              <View style={styles.extrasPending}>
                <Ionicons name="time-outline" size={14} color={COLORS.infoText} />
                <Text style={styles.extrasPendingText}>
                  Owner debe elegir cómo pagar ${Number(bathAddon.extraPrice).toLocaleString("es-MX")}
                </Text>
              </View>
            );
          }
          // Modo cotización por extra (solo cuando el baño ya está físicamente listo).
          if (!physicallyDone) return null;
          const open = (kind: "deslanado" | "corte") =>
            setExtrasAddon({
              addonId: bathAddon.id,
              petName: item.pet.name,
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
              {bathAddon.variant.deslanado &&
                (bathAddon.extraDeslanadoPrice ? (
                  <View style={styles.extraSetChip}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
                    <Text style={styles.extraSetChipLabel}>Deslanado</Text>
                    <Text style={styles.extraSetChipPrice}>
                      ${Number(bathAddon.extraDeslanadoPrice).toLocaleString("es-MX")}
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
              {bathAddon.variant.corte &&
                (bathAddon.extraCortePrice ? (
                  <View style={styles.extraSetChip}>
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.successText} />
                    <Text style={styles.extraSetChipLabel}>Corte</Text>
                    <Text style={styles.extraSetChipPrice}>
                      ${Number(bathAddon.extraCortePrice).toLocaleString("es-MX")}
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

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Próximos baños</Text>
        <Text style={styles.topSub}>
          {pending.length} pendiente{pending.length === 1 ? "" : "s"}
          {" · "}
          ${revenue.toLocaleString("es-MX")} en total
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

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <View
          style={styles.swipeWrap}
          onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)}
          {...swipePan.panHandlers}
        >
          <Animated.View
            style={[
              styles.swipeTrack,
              {
                width: contentWidth * 2,
                transform: [
                  {
                    translateX: tabProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -contentWidth],
                      extrapolate: "clamp",
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={{ width: contentWidth }}>
              <FlatList<Row>
                data={rowsLoose}
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
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyCard}>
                    <Ionicons name="water-outline" size={32} color={COLORS.border} />
                    <Text style={styles.emptyText}>No hay baños sueltos</Text>
                  </View>
                }
              />
            </View>
            <View style={{ width: contentWidth }}>
              <FlatList<Row>
                data={rowsStay}
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
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyCard}>
                    <Ionicons name="water-outline" size={32} color={COLORS.border} />
                    <Text style={styles.emptyText}>No hay baños de hospedaje</Text>
                  </View>
                }
              />
            </View>
          </Animated.View>
        </View>
      )}

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
    </View>
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
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
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
    fontWeight: "800",
    color: COLORS.textTertiary,
  },
  priceInput: {
    flex: 1,
    fontSize: 26,
    fontWeight: "800",
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
    fontWeight: "700",
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
    fontWeight: "700",
    color: COLORS.white,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  topSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
  swipeWrap: { flex: 1, overflow: "hidden" },
  swipeTrack: { flex: 1, flexDirection: "row" },
  listContent: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "800",
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
    fontWeight: "800",
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
  completeText: { color: COLORS.white, fontSize: 14, fontWeight: "700" },
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
    fontWeight: "700",
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
    fontWeight: "700",
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
    fontWeight: "700",
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
    fontWeight: "700",
    color: COLORS.successText,
  },
  extraSetChipPrice: {
    fontSize: 13,
    fontWeight: "800",
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
    fontWeight: "600",
    color: COLORS.infoText,
  },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 13, color: COLORS.textDisabled },
});
