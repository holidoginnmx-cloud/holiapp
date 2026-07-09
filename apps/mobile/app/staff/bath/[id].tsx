import { COLORS } from "@/constants/colors";
import { ErrorState } from "@/components/ErrorState";
import {
  PaymentManualModal,
  type ManualPaymentValues,
} from "@/components/PaymentManualModal";
import { styles, extrasStyles } from "@/styles/bathDetailStyles";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
  Image,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import {
  getStaffBaths,
  completeStaffBath,
  createStaffUpdate,
  deleteStayUpdate,
  setBathExtrasPrice,
  confirmExtrasPaidAtPickup,
  registerBathManualPayment,
  type StaffBath,
} from "@/lib/api";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import { uploadToCloudinary, cloudinaryResized } from "@/lib/cloudinary";
import { formatName, phoneToTelUri, formatCurrency, formatTime, formatDateLong } from "@/lib/format";
import { useAuthStore } from "@/store/authStore";

const SIZE_LABEL: Record<string, string> = {
  XS: "Extra chico",
  S: "Chico",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

function describeVariant(bath: StaffBath): string {
  const variant =
    bath.addons.find((a) => a.variant?.serviceType?.code === "BATH")?.variant ??
    bath.addons[0]?.variant;
  if (!variant) return "Baño";
  const extras: string[] = [];
  if (variant.deslanado) extras.push("Deslanado");
  if (variant.corte) extras.push("Corte");
  return extras.length > 0 ? `Baño + ${extras.join(" + ")}` : "Baño";
}

function getBathAddon(bath: StaffBath) {
  return bath.addons.find((a) => a.variant?.serviceType?.code === "BATH");
}

// Físicamente terminado: el staff ya subió la foto del baño.
function isBathPhysicallyDone(bath: StaffBath): boolean {
  return !!getBathAddon(bath)?.completedAt;
}

// Concluido: ya se liquidó el saldo (extras + deposit). Solo aplica a BATH.
function isBathConcluded(bath: StaffBath): boolean {
  if (bath.reservationType === "BATH") return bath.status === "CHECKED_OUT";
  return !!getBathAddon(bath)?.completedAt;
}

function bathOutstandingBalance(bath: StaffBath): {
  deposit: number;
  extras: number;
  total: number;
} {
  const paid = (bath.payments ?? []).reduce(
    (sum, p) => sum + Number(p.amount),
    0,
  );
  const deposit = Math.max(0, Number(bath.totalAmount) - paid);
  const extras = bath.addons.reduce((sum, a) => {
    if (
      a.variant?.serviceType?.code === "BATH" &&
      a.extraPrice !== null &&
      a.extraPaymentStatus !== "PAID"
    ) {
      return sum + Number(a.extraPrice);
    }
    return sum;
  }, 0);
  return { deposit, extras, total: deposit + extras };
}

export default function StaffBathDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isTablet } = useResponsive();
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [photoFullscreen, setPhotoFullscreen] = useState<string | null>(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const userId = useAuthStore((s) => s.userId);
  // Modal de cotización abierto para un extra específico (deslanado/corte).
  const [extraKind, setExtraKind] = useState<"deslanado" | "corte" | null>(
    null,
  );

  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["staff-baths", "upcoming"],
    queryFn: () => getStaffBaths(),
    refetchInterval: 60_000,
  });

  const bath = useMemo(
    () => data?.baths.find((b) => b.id === id) ?? null,
    [data, id],
  );

  const confirmPickupMutation = useMutation({
    mutationFn: (vars: { addonId: string; method: "CASH" | "TRANSFER" }) =>
      confirmExtrasPaidAtPickup(vars.addonId, { method: vars.method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Optimista: la foto desaparece al confirmar; si el server falla, reaparece.
  const deletePhotoMutation = useOptimisticMutation({
    mutationFn: (updateId: string) => deleteStayUpdate(updateId),
    patches: [
      {
        queryKey: ["staff-baths", "upcoming"],
        updater: (old, updateId) => {
          const d = old as { baths?: StaffBath[] } | undefined;
          if (!d?.baths) return old;
          return {
            ...d,
            baths: d.baths.map((b) =>
              b.id === id
                ? { ...b, updates: b.updates.filter((u) => u.id !== updateId) }
                : b
            ),
          };
        },
      },
    ],
    invalidateKeys: [["staff-baths"]],
    errorTitle: "No se pudo eliminar la foto",
  });

  const confirmDeletePhoto = (updateId: string) => {
    Alert.alert(
      "Eliminar foto",
      "El dueño dejará de verla. Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deletePhotoMutation.mutate(updateId),
        },
      ],
    );
  };

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

  async function uploadAndComplete(source: "camera" | "library") {
    if (!bath) return;
    const uri = await pickPhoto(source);
    if (!uri) return;
    setCompleting(true);
    try {
      const cloud = await uploadToCloudinary(uri, "baths");
      await completeStaffBath(bath.id, cloud.secure_url);
      queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo completar";
      Alert.alert("Error", msg);
    } finally {
      setCompleting(false);
    }
  }

  function handleComplete() {
    if (!bath) return;
    Alert.alert(
      "Foto del baño",
      `Sube una foto de ${formatName(bath.pet?.name ?? "—")} bañado para completar la cita.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Tomar foto", onPress: () => uploadAndComplete("camera") },
        { text: "Elegir foto", onPress: () => uploadAndComplete("library") },
      ],
    );
  }

  // Subir foto adicional una vez que el baño ya tiene la inicial.
  async function uploadExtraPhoto(source: "camera" | "library") {
    if (!bath) return;
    const uri = await pickPhoto(source);
    if (!uri) return;
    setAddingPhoto(true);
    try {
      const cloud = await uploadToCloudinary(uri, "baths");
      await createStaffUpdate({
        reservationId: bath.id,
        petId: bath.pet?.id ?? "",
        mediaUrl: cloud.secure_url,
        mediaType: "image",
        caption: null,
        staffId: userId ?? "",
      });
      queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo subir la foto";
      Alert.alert("Error", msg);
    } finally {
      setAddingPhoto(false);
    }
  }

  function handleAddPhoto() {
    if (!bath) return;
    Alert.alert(
      "Agregar foto",
      `Sube otra foto de ${formatName(bath.pet?.name ?? "—")}.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Tomar foto", onPress: () => uploadExtraPhoto("camera") },
        { text: "Elegir foto", onPress: () => uploadExtraPhoto("library") },
      ],
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!bath) {
    return (
      <View style={styles.center}>
        <Ionicons name="water-outline" size={32} color={COLORS.border} />
        <Text style={styles.emptyText}>No se encontró el baño</Text>
      </View>
    );
  }

  const physicallyDone = isBathPhysicallyDone(bath);
  const concluded = isBathConcluded(bath);
  const isStayBath = bath.reservationType === "STAY";
  const balance = bathOutstandingBalance(bath);
  const hasOutstanding = !isStayBath && balance.total > 0.01;
  const variantLine = describeVariant(bath);
  const bathAddon = getBathAddon(bath);
  const ownerPhone = bath.owner?.phone;
  const ownerEmail = bath.owner?.email;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        isTablet && { maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", width: "100%" },
      ]}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Hero: foto + nombre */}
      <View style={styles.hero}>
        {bath.pet?.photoUrl ? (
          <Image
            source={{ uri: cloudinaryResized(bath.pet.photoUrl, 216, "fill") }}
            style={styles.heroPhoto}
          />
        ) : (
          <View style={[styles.heroPhoto, styles.heroPhotoPlaceholder]}>
            <Ionicons name="paw" size={36} color={COLORS.primary} />
          </View>
        )}
        <View style={styles.heroInfo}>
          <Text style={styles.petName} numberOfLines={1}>
            {formatName(bath.pet?.name ?? "—")}
          </Text>
          <View style={styles.heroTags}>
            <View style={styles.variantPill}>
              <Ionicons name="water" size={12} color={COLORS.primary} />
              <Text style={styles.variantPillText}>{variantLine}</Text>
            </View>
            {concluded ? (
              <View style={styles.doneBadge}>
                <Ionicons
                  name="checkmark-done-circle"
                  size={12}
                  color={COLORS.successText}
                />
                <Text style={styles.doneText}>Concluida</Text>
              </View>
            ) : physicallyDone ? (
              <View style={styles.awaitingBadge}>
                <Ionicons
                  name="checkmark-circle"
                  size={12}
                  color={COLORS.warningText}
                />
                <Text style={styles.awaitingText}>
                  Listo · esperando pago
                </Text>
              </View>
            ) : (
              <View style={styles.pendingBadge}>
                <Ionicons name="time" size={12} color={COLORS.infoText} />
                <Text style={styles.pendingText}>Pendiente</Text>
              </View>
            )}
            {isStayBath && (
              <View style={styles.stayBadge}>
                <Ionicons
                  name="bed-outline"
                  size={12}
                  color={COLORS.warningText}
                />
                <Text style={styles.stayBadgeText}>Hospedaje</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Saldo pendiente — staff registra pago manual (efectivo/transfer).
          Va arriba de todo para que sea lo primero que vea el staff cuando
          el owner llega a recoger. */}
      {/* La sección aparece desde antes de subir foto: permite al staff cobrar
          el saldo del deposit cuando el owner llega a dejar a la mascota.
          Una vez con foto + sin saldo, el helper concluye el baño solo. */}
      {!concluded && hasOutstanding && (
        <ManualPaymentSection
          reservationId={bath.id}
          petName={bath.pet?.name ?? "—"}
          balance={balance}
          onSuccess={() =>
            queryClient.invalidateQueries({ queryKey: ["staff-baths"] })
          }
        />
      )}

      {/* Resumen unificado: cita + mascota + dueño + pago */}
      <View style={styles.summaryCard}>
        {/* Bloque de cita prominente */}
        {bath.appointmentAt && (
          <>
            <View style={styles.summaryAppointment}>
              <View style={styles.summaryAppointmentIcon}>
                <Ionicons name="calendar" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryAppointmentDate}>
                  {formatDateLong(bath.appointmentAt, { timeZone: "America/Hermosillo" })}
                </Text>
                <Text style={styles.summaryAppointmentTime}>
                  {formatTime(bath.appointmentAt, { hour12: false })}
                  {isStayBath ? " · antes del checkout" : ""}
                </Text>
              </View>
            </View>
            <View style={styles.summaryDivider} />
          </>
        )}

        {/* Grid 2 columnas: mascota + dueño */}
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryColLabel}>Mascota</Text>
            <Text style={styles.summaryColValue} numberOfLines={1}>
              {bath.pet?.breed ?? "—"}
            </Text>
            <Text style={styles.summaryColSub}>
              {SIZE_LABEL[bath.pet?.size ?? ""] ?? bath.pet?.size ?? "—"}
              {bath.pet?.weight ? ` · ${bath.pet.weight} kg` : ""}
            </Text>
          </View>
          <View style={styles.summaryColDivider} />
          <View style={styles.summaryCol}>
            <Text style={styles.summaryColLabel}>Dueño</Text>
            <Text style={styles.summaryColValue} numberOfLines={1}>
              {formatName(bath.owner?.firstName ?? "")}{" "}
              {formatName(bath.owner?.lastName ?? "")}
            </Text>
            {ownerPhone ? (
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(`tel:${phoneToTelUri(ownerPhone)}`)
                }
                style={styles.summaryCallLink}
                hitSlop={6}
              >
                <Ionicons name="call" size={12} color={COLORS.primary} />
                <Text style={styles.summaryCallLinkText}>Llamar</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.summaryColSub}>Sin teléfono</Text>
            )}
          </View>
        </View>

        {/* Notas si existen */}
        {bath.pet?.notes && (
          <View style={styles.summaryNotes}>
            <Ionicons
              name="information-circle"
              size={16}
              color={COLORS.warningText}
            />
            <Text style={styles.notesText}>{bath.pet?.notes}</Text>
          </View>
        )}

        <View style={styles.summaryDivider} />

        {/* Pagos: anticipo + pagos manuales = total cobrado. Se actualiza
            automáticamente cuando el staff registra un pago manual. */}
        {(() => {
          const totalPaid = (bath.payments ?? []).reduce(
            (sum, p) => sum + Number(p.amount),
            0,
          );
          const reservationTotal = Number(bath.totalAmount);
          const remaining = Math.max(0, reservationTotal - totalPaid);
          const isFullyPaid = remaining < 0.01;
          return (
            <View style={styles.summaryPayRow}>
              <View>
                <Text style={styles.summaryColLabel}>Pagado</Text>
                <Text style={styles.summaryColSub}>
                  {isFullyPaid
                    ? "Reservación liquidada"
                    : `Saldo: ${formatCurrency(remaining)} · Total ${formatCurrency(reservationTotal)}`}
                </Text>
              </View>
              <Text
                style={[
                  styles.summaryTotal,
                  isFullyPaid && { color: COLORS.successText },
                ]}
              >
                {formatCurrency(totalPaid)}
              </Text>
            </View>
          );
        })()}
      </View>

      {/* Foto del baño (tap → fullscreen). Botón para agregar más fotos
          una vez que ya existe al menos una (i.e. el baño está físicamente listo). */}
      {bath.updates.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Foto del baño</Text>
          <View style={styles.card}>
            <View style={styles.photoGrid}>
              {bath.updates.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  activeOpacity={0.85}
                  onPress={() => setPhotoFullscreen(u.mediaUrl)}
                  style={styles.photoThumbWrap}
                >
                  <Image
                    source={{ uri: cloudinaryResized(u.mediaUrl, 288, "fill") }}
                    style={styles.photoThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.photoExpandBadge}>
                    <Ionicons name="expand" size={12} color={COLORS.white} />
                  </View>
                  <TouchableOpacity
                    style={styles.photoDeleteBadge}
                    onPress={() => confirmDeletePhoto(u.id)}
                    disabled={deletePhotoMutation.isPending}
                    hitSlop={6}
                    testID={`staff-bath-photo-delete-${u.id}`}
                  >
                    <Ionicons name="trash" size={12} color={COLORS.white} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[
                  styles.photoThumbWrap,
                  styles.addPhotoTile,
                  addingPhoto && styles.completeBtnDisabled,
                ]}
                onPress={handleAddPhoto}
                disabled={addingPhoto}
                activeOpacity={0.7}
              >
                {addingPhoto ? (
                  <ActivityIndicator color={COLORS.primary} size="small" />
                ) : (
                  <>
                    <Ionicons name="add" size={28} color={COLORS.primary} />
                    <Text style={styles.addPhotoTileText}>Agregar</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Extras (deslanado/corte) — cada uno se cotiza por separado.
          Una vez cotizados todos, fluye por extraPaymentStatus (igual que antes). */}
      {bathAddon &&
        (bathAddon.variant?.deslanado || bathAddon.variant?.corte) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Extras</Text>
            <View style={styles.card}>
              {/* Desglose: cuando hay total (ambos extras cotizados), mostramos
                  el detalle por extra y el total antes del estado de pago. */}
              {bathAddon.extraPrice ? (
                <>
                  <ExtrasBreakdown
                    deslanadoPrice={
                      bathAddon.extraDeslanadoPrice
                        ? Number(bathAddon.extraDeslanadoPrice)
                        : null
                    }
                    cortePrice={
                      bathAddon.extraCortePrice
                        ? Number(bathAddon.extraCortePrice)
                        : null
                    }
                    total={Number(bathAddon.extraPrice)}
                  />
                  {bathAddon.extraPaymentStatus === "PAID" ? (
                    <View style={styles.extrasStatusPaid}>
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color={COLORS.successText}
                      />
                      <Text style={styles.extrasStatusPaidText}>Extras cobrados</Text>
                    </View>
                  ) : bathAddon.extraPaymentStatus === "PAY_ON_PICKUP" ? (
                    <TouchableOpacity
                      style={styles.extrasPickupBtn}
                      onPress={() => {
                        Alert.alert(
                          "Confirmar pago",
                          `¿Cómo recibiste ${formatCurrency(bathAddon.extraPrice)} de ${formatName(bath.pet?.name ?? "—")}?`,
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
                      <Ionicons
                        name="cash-outline"
                        size={14}
                        color={COLORS.warningText}
                      />
                      <Text style={styles.extrasPickupBtnText}>
                        Cobrar al recoger
                      </Text>
                    </TouchableOpacity>
                  ) : bathAddon.extraPaymentStatus === "PENDING_PAYMENT" ? (
                    <View style={styles.extrasPending}>
                      <Ionicons
                        name="time-outline"
                        size={14}
                        color={COLORS.infoText}
                      />
                      <Text style={styles.extrasPendingText}>
                        Owner debe elegir cómo pagar
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : !physicallyDone ? (
                <Text style={styles.paymentNote}>
                  Define el precio de cada extra cuando el baño esté listo.
                </Text>
              ) : (
                // Modo cotización: un botón/chip por cada extra contratado.
                <View style={{ gap: 8 }}>
                  {bathAddon.variant?.deslanado &&
                    (bathAddon.extraDeslanadoPrice ? (
                      <ExtraSetChip
                        label="Deslanado"
                        price={Number(bathAddon.extraDeslanadoPrice)}
                        onEdit={() => setExtraKind("deslanado")}
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.extrasSetBtn}
                        onPress={() => setExtraKind("deslanado")}
                      >
                        <Ionicons
                          name="pricetag-outline"
                          size={14}
                          color={COLORS.primary}
                        />
                        <Text style={styles.extrasSetBtnText}>
                          Cobrar deslanado
                        </Text>
                      </TouchableOpacity>
                    ))}
                  {bathAddon.variant?.corte &&
                    (bathAddon.extraCortePrice ? (
                      <ExtraSetChip
                        label="Corte"
                        price={Number(bathAddon.extraCortePrice)}
                        onEdit={() => setExtraKind("corte")}
                      />
                    ) : (
                      <TouchableOpacity
                        style={styles.extrasSetBtn}
                        onPress={() => setExtraKind("corte")}
                      >
                        <Ionicons
                          name="pricetag-outline"
                          size={14}
                          color={COLORS.primary}
                        />
                        <Text style={styles.extrasSetBtnText}>
                          Cobrar corte
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              )}
            </View>
          </View>
        )}

      {/* Notas de reservación */}
      {bath.notes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notas</Text>
          <View style={styles.card}>
            <Text style={styles.rowText}>{bath.notes}</Text>
          </View>
        </View>
      )}

      {/* Acción principal: subir foto si aún no se ha subido. */}
      {!physicallyDone && (
        <TouchableOpacity
          style={[
            styles.completeBtn,
            completing && styles.completeBtnDisabled,
          ]}
          onPress={handleComplete}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <>
              <Ionicons name="camera" size={18} color={COLORS.white} />
              <Text style={styles.completeText}>Marcar listo con foto</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Visor de foto fullscreen — montado solo cuando hay foto activa
          para evitar conflictos con otros Modal en el árbol. */}
      {photoFullscreen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPhotoFullscreen(null)}
        >
          <Pressable
            style={styles.fullscreenBackdrop}
            onPress={() => setPhotoFullscreen(null)}
          >
            <Image
              source={{ uri: cloudinaryResized(photoFullscreen, 1080, "limit") }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
            <TouchableOpacity
              style={styles.fullscreenClose}
              onPress={() => setPhotoFullscreen(null)}
              hitSlop={12}
            >
              <Ionicons name="close" size={28} color={COLORS.white} />
            </TouchableOpacity>
          </Pressable>
        </Modal>
      )}

      {extraKind && bathAddon && (
        <ExtrasPriceModal
          addonId={bathAddon.id}
          petName={bath.pet?.name ?? "—"}
          kind={extraKind}
          currentPrice={
            extraKind === "deslanado"
              ? bathAddon.extraDeslanadoPrice
                ? Number(bathAddon.extraDeslanadoPrice)
                : null
              : bathAddon.extraCortePrice
                ? Number(bathAddon.extraCortePrice)
                : null
          }
          onClose={() => setExtraKind(null)}
          onSuccess={() => {
            setExtraKind(null);
            queryClient.invalidateQueries({ queryKey: ["staff-baths"] });
          }}
        />
      )}
    </ScrollView>
  );
}

function ManualPaymentSection({
  reservationId,
  balance,
  onSuccess,
}: {
  reservationId: string;
  petName: string;
  balance: { deposit: number; extras: number; total: number };
  onSuccess: () => void;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [registering, setRegistering] = useState(false);

  function openModal() {
    setModalVisible(true);
  }
  function closeModal() {
    setModalVisible(false);
  }

  async function registerPayment(values: ManualPaymentValues) {
    setRegistering(true);
    try {
      const res = await registerBathManualPayment(reservationId, {
        amount: values.amount,
        method: values.method,
        notes: values.notes,
      });
      onSuccess();
      closeModal();
      Alert.alert(
        "Pago registrado",
        res.concluded
          ? `Recibido ${formatCurrency(res.amount)}. El baño quedó concluido.`
          : `Recibido ${formatCurrency(res.amount)}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo registrar";
      Alert.alert("Error", msg);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <View style={styles.manualPaySection}>
      <View style={styles.manualPayHeader}>
        <Ionicons name="cash" size={18} color={COLORS.warningText} />
        <Text style={styles.manualPayTitle}>Saldo pendiente</Text>
        <Text style={styles.manualPayTotal}>
          {formatCurrency(balance.total)}
        </Text>
      </View>
      {(balance.deposit > 0.01 || balance.extras > 0.01) && (
        <View style={styles.manualPayBreakdown}>
          {balance.deposit > 0.01 && (
            <Text style={styles.manualPayBreakdownText}>
              Saldo de reserva: {formatCurrency(balance.deposit)}
            </Text>
          )}
          {balance.extras > 0.01 && (
            <Text style={styles.manualPayBreakdownText}>
              Extras: {formatCurrency(balance.extras)}
            </Text>
          )}
        </View>
      )}
      {/* Botón estilo admin: dashed + primary light bg + texto en color primario */}
      <TouchableOpacity
        style={styles.registerPaymentBtn}
        onPress={openModal}
        activeOpacity={0.7}
      >
        <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
        <Text style={styles.registerPaymentText}>Registrar pago manual</Text>
      </TouchableOpacity>

      <PaymentManualModal
        visible={modalVisible}
        onClose={closeModal}
        submitting={registering}
        initialAmount={balance.total.toFixed(2)}
        onSubmit={registerPayment}
      />
    </View>
  );
}

function ExtrasBreakdown({
  deslanadoPrice,
  cortePrice,
  total,
}: {
  deslanadoPrice: number | null;
  cortePrice: number | null;
  total: number;
}) {
  return (
    <View style={styles.breakdown}>
      {deslanadoPrice !== null && (
        <View style={styles.breakdownRow}>
          <Ionicons name="cut-outline" size={14} color={COLORS.textSecondary} />
          <Text style={styles.breakdownLabel}>Deslanado</Text>
          <Text style={styles.breakdownAmount}>
            {formatCurrency(deslanadoPrice)}
          </Text>
        </View>
      )}
      {cortePrice !== null && (
        <View style={styles.breakdownRow}>
          <Ionicons name="cut" size={14} color={COLORS.textSecondary} />
          <Text style={styles.breakdownLabel}>Corte</Text>
          <Text style={styles.breakdownAmount}>
            {formatCurrency(cortePrice)}
          </Text>
        </View>
      )}
      <View style={styles.breakdownDivider} />
      <View style={styles.breakdownRow}>
        <Text style={[styles.breakdownLabel, styles.breakdownTotalLabel]}>
          Total
        </Text>
        <Text style={[styles.breakdownAmount, styles.breakdownTotalAmount]}>
          {formatCurrency(total)}
        </Text>
      </View>
    </View>
  );
}

function ExtraSetChip({
  label,
  price,
  onEdit,
}: {
  label: string;
  price: number;
  onEdit: () => void;
}) {
  return (
    <View style={styles.extraSetChip}>
      <Ionicons name="checkmark-circle" size={16} color={COLORS.successText} />
      <Text style={styles.extraSetChipLabel}>{label}</Text>
      <Text style={styles.extraSetChipPrice}>
        {formatCurrency(price)}
      </Text>
      <TouchableOpacity onPress={onEdit} hitSlop={8}>
        <Ionicons name="pencil" size={14} color={COLORS.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

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
              {formatName(petName)} · el owner verá este monto desglosado en su
              reserva.
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
