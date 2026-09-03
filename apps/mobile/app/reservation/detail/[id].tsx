import { COLORS } from "@/constants/colors";
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { StripeProvider } from "@stripe/stripe-react-native";
import { usePaymentCheckout } from "@/hooks/usePaymentCheckout";
import {
  usePendingConfirmation,
  PendingConfirmationError,
} from "@/hooks/usePendingConfirmation";
import { ENDPOINTS } from "@/constants/api";
import { useAuthStore } from "@/store/authStore";
import {
  getReservationById,
  getReservations,
  getCreditLedger,
  getOwnerChecklists,
  createBalancePayment,
  confirmBalancePayment,
  updateReservationTimes,
  updateReservationDelivery,
} from "@/lib/api";
import { BathUpsellCard } from "@/components/BathUpsellCard";
import { PaymentCardFlow } from "@/components/PaymentCardFlow";
import { ReservationBreakdownCard } from "@/components/ReservationBreakdownCard";
import { TimeSlotPicker } from "@/components/TimeSlotPicker";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import {
  formatName,
  daysSinceVisitEnd,
  BALANCE_AFTER_CHECKOUT_MAX_DAYS,
  formatCurrency,
  formatDayShort,
  formatWeekdayShort,
  formatWeekdayDayShort,
  formatTime,
  formatTimeHHmm,
} from "@/lib/format";
import { ReviewPromptModal } from "@/components/ReviewPromptModal";
import { PawRating } from "@/components/PawRating";
import { REVIEW_COPY } from "@holidoginn/shared";
import { CancelReservationModal } from "@/components/CancelReservationModal";
import { ReservationDeliveryModal } from "@/components/ReservationDeliveryModal";
import { VIAJE_SUB_CLIENTE } from "@/constants/delivery";
import { listChangeRequests, type ChangeRequest } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";
import { styles } from "@/styles/ownerReservationDetailStyles";
import { cloudinaryResized } from "@/lib/cloudinary";
import { LIVE_OPS } from "@/lib/queryOptions";

export function ErrorBoundary({ error }: { error: Error }) {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.errorText, marginBottom: 8 }}>
        Error en la pantalla
      </Text>
      <Text style={{ fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textTertiary, textAlign: "center" }}>
        {error.message}
      </Text>
    </View>
  );
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, text: COLORS.infoText },
  CHECKED_IN: { label: "En estancia", bg: COLORS.successBg, text: COLORS.successText },
  CHECKED_OUT: { label: "Concluida", bg: COLORS.bgSection, text: COLORS.textTertiary },
  CANCELLED: { label: "Cancelada", bg: COLORS.errorBg, text: COLORS.errorText },
};

const PAYMENT_STATUS: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  UNPAID: {
    label: "Sin pagar",
    bg: COLORS.errorBg,
    color: COLORS.errorText,
  },
  PARTIAL: {
    label: "Anticipo",
    bg: COLORS.warningBg,
    color: COLORS.warningText,
  },
  PAID: {
    label: "Pagado",
    bg: COLORS.successBg,
    color: COLORS.successText,
  },
  REFUNDED: {
    label: "Reembolsado",
    bg: COLORS.bgSection,
    color: COLORS.textTertiary,
  },
};

export default function ReservationDetailScreen() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.holidoginnmx.app"
    >
      <ReservationDetailScreenContent />
    </StripeProvider>
  );
}

function ReservationDetailScreenContent() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string; from?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const checkout = usePaymentCheckout("balance");
  const userId = useAuthStore((s) => s.userId);
  const [payingBalance, setPayingBalance] = useState(false);

  // Lo que sigue a un saldo liquidado. Se comparte entre el camino normal y el
  // reintento de una confirmación que quedó pendiente.
  const finishBalance = () => {
    queryClient.invalidateQueries({ queryKey: ["reservation", id] });
    queryClient.invalidateQueries({ queryKey: ["reservations"] });
    router.replace({
      pathname: "/reservation/success" as any,
      params: { variant: "balance" },
    });
  };

  // Red de seguridad: si `/payments/confirm-balance` falla DESPUÉS de que
  // Stripe cobró, el PaymentIntent no se pierde — se reintenta tal cual. Se
  // acota a ESTA reservación para no mezclar avisos entre detalles.
  const pendingConfirm = usePendingConfirmation<
    Awaited<ReturnType<typeof confirmBalancePayment>>
  >({
    flow: "balance",
    telemetryFlow: "balance",
    userId,
    matches: (record) => record.payload.reservationId === id,
    onConfirmed: () => finishBalance(),
    subject: "tu pago",
  });
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewPrompted, setReviewPrompted] = useState(false);
  const [cancelModalMode, setCancelModalMode] = useState<
    null | "cancel" | "issue-refund"
  >(null);
  // Selector de hora estimada de llegada ("in") / recogida ("out").
  const [timePickerFor, setTimePickerFor] = useState<"in" | "out" | null>(null);
  const [deliveryModalVisible, setDeliveryModalVisible] = useState(false);
  const {
    data: reservation,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
    refetchInterval: 30_000,
    ...LIVE_OPS,
  });

  // Load grouped reservations if multi-pet
  const { data: groupedReservations } = useQuery({
    queryKey: ["reservation-group", reservation?.groupId],
    queryFn: async () => {
      if (!reservation?.groupId) return null;
      const all = await getReservations({ ownerId: reservation.ownerId });
      return all.filter((r: any) => r.groupId === reservation.groupId);
    },
    enabled: !!reservation?.groupId,
  });

  const { data: checklists } = useQuery({
    queryKey: ["reservation-checklists", id],
    queryFn: () => getOwnerChecklists(id!),
    enabled: !!id, // solo necesita id → arranca en paralelo (sin esperar a reservation)
    refetchInterval: 30_000,
  });

  const { data: ledger } = useQuery({
    queryKey: ["credit-ledger"],
    queryFn: getCreditLedger,
    enabled: !!id,
  });

  const reservationRefund = (ledger ?? [])
    .filter((e) => e.reservationId === id && e.type === "CREDIT_ADDED")
    .reduce((sum, e) => sum + Number(e.amount), 0);

  const { data: changeRequests } = useQuery({
    queryKey: ["reservation", id, "change-requests"],
    queryFn: () => listChangeRequests(id!),
    enabled: !!id, // solo necesita id → arranca en paralelo (sin esperar a reservation)
  });
  const pendingChange: ChangeRequest | undefined = changeRequests?.find(
    (c) => c.status === "PENDING"
  );
  const approvedExtension: ChangeRequest | undefined = changeRequests?.find(
    (c) => c.status === "APPROVED" && Number(c.deltaAmount) > 0 && !c.paidAt,
  );
  const approvedExtensionPaidShortcut: ChangeRequest | undefined = changeRequests?.find(
    (c) =>
      c.status === "APPROVED" &&
      Number(c.deltaAmount) > 0 &&
      (c.payOnPickup || !!c.paidAt),
  );
  const canModify =
    reservation &&
    reservation.reservationType !== "BATH" &&
    ["CONFIRMED", "CHECKED_IN"].includes(reservation.status) &&
    !pendingChange;
  // Hora estimada: llegada editable hasta el check-in; recogida hasta el check-out.
  const canEditCheckInTime = reservation?.status === "CONFIRMED";
  const canEditCheckOutTime =
    !!reservation && ["CONFIRMED", "CHECKED_IN"].includes(reservation.status);

  // Optimista: la hora aparece en el pill al instante; el backend la propaga
  // a todo el grupo multi-mascota.
  const timesMutation = useOptimisticMutation({
    mutationFn: (data: { checkInTime?: string | null; checkOutTime?: string | null }) =>
      updateReservationTimes(id!, data),
    patches: [
      {
        queryKey: ["reservation", id],
        updater: (old, data) =>
          old ? { ...(old as object), ...data } : old,
      },
    ],
    invalidateKeys: [["reservation", id], ["reservations"]],
    errorTitle: "No se pudo guardar la hora",
  });
  const canCancel =
    reservation && reservation.status === "CONFIRMED";
  // El domicilio se puede pedir/quitar mientras la reserva no haya empezado.
  const canEditDelivery = reservation?.status === "CONFIRMED";
  // Decimal serializado: llega como string.
  const deliveryFee = Number(reservation?.homeDeliveryFee ?? 0);

  const deliveryMutation = useMutation({
    mutationFn: (
      payload:
        | { enable: true; address: string; lat: number; lng: number; placeId?: string }
        | { enable: false },
    ) => updateReservationDelivery(id!, payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      setDeliveryModalVisible(false);
      Alert.alert(
        "Listo",
        res.delta > 0
          ? `Agregamos el servicio a domicilio. Se sumaron ${formatCurrency(res.delta)} a tu total; se pagan al recoger a tu mascota.`
          : res.delta < 0
            ? `Se quitó el servicio a domicilio. Tu total bajó ${formatCurrency(-res.delta)}.`
            : "Tu servicio a domicilio quedó actualizado.",
      );
    },
    onError: (e: Error) =>
      Alert.alert("No se pudo actualizar el domicilio", e.message),
  });
  // Count both PAID and PARTIAL — both are real money already paid by owner.
  const paidStripeAmount = reservation?.payments
    ?.filter((p: any) =>
      (p.status === "PAID" || p.status === "PARTIAL") && p.stripePaymentIntentId,
    )
    .reduce((s: number, p: any) => s + Number(p.amount), 0) ?? 0;
  const totalPaidForCancel = reservation?.payments
    ?.filter((p: any) => p.status === "PAID" || p.status === "PARTIAL")
    .reduce((s: number, p: any) => s + Number(p.amount), 0) ?? 0;
  const hasPendingRefundChoice =
    reservation?.status === "CANCELLED" &&
    totalPaidForCancel > 0 &&
    !reservation?.payments?.some((p: any) => p.status === "REFUNDED");

  // Si llegamos con ?action=choose-refund (push de admin-cancel), abrir modal.
  useEffect(() => {
    if (
      action === "choose-refund" &&
      hasPendingRefundChoice &&
      cancelModalMode === null
    ) {
      setCancelModalMode("issue-refund");
    }
  }, [action, hasPendingRefundChoice, cancelModalMode]);

  // Balance payment logic
  const isDeposit = reservation?.paymentType === "DEPOSIT";
  const totalPaid = reservation?.payments
    ?.filter((p: any) => p.status === "PAID" || p.status === "PARTIAL")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0) ?? 0;
  const remainingBalance = reservation
    ? Number(reservation.totalAmount) - totalPaid
    : 0;
  // El saldo NO se apaga al concluir la visita: antes `CHECKED_OUT` escondía el
  // botón, así que una estancia que se cerró debiendo dinero se quedaba sin
  // forma de cobrarse desde la app (el endpoint pay-balance siempre lo permitió;
  // el candado era solo de UI). Solo una reserva cancelada deja de cobrarse.
  //
  // Con una excepción: una visita cerrada hace mucho suele tener el saldo
  // cobrado en mostrador y nunca registrado (ver daysSinceVisitEnd). Pasada la
  // ventana, el cobro vuelve a ser cosa del equipo y al cliente no se le pide
  // nada.
  const daysSinceEnd = reservation ? daysSinceVisitEnd(reservation) : null;
  const checkoutTooOld =
    reservation?.status === "CHECKED_OUT" &&
    daysSinceEnd != null &&
    daysSinceEnd > BALANCE_AFTER_CHECKOUT_MAX_DAYS;
  const hasBalance =
    remainingBalance > 0.01 &&
    reservation?.status !== "CANCELLED" &&
    !checkoutTooOld;
  const balanceAfterCheckout =
    hasBalance && reservation?.status === "CHECKED_OUT";
  // "Saldo por extensión" solo si de verdad hay una extensión aprobada: en una
  // reserva capturada por el equipo sin anticipo, `isDeposit` es false y el
  // banner venía anunciando días agregados que nunca existieron.
  const balanceFromExtension =
    !isDeposit && !!approvedExtension && !balanceAfterCheckout;

  // El modal de reseña se abre SOLO si venimos del push (?action=review) o si
  // el cliente toca el CTA. Antes se abría solo cada vez que se entraba a una
  // reservación finalizada sin reseñar, incluso para consultar un pago: era el
  // pop-up más molesto de la app y el "Más tarde" no lo callaba. Ahora quien
  // insiste es `GlobalReviewPrompt` en el Inicio, con snooze del lado servidor.
  useEffect(() => {
    if (
      action === "review" &&
      reservation &&
      reservation.status === "CHECKED_OUT" &&
      !reservation.review &&
      !reviewPrompted
    ) {
      setReviewPrompted(true);
      setReviewModalOpen(true);
    }
  }, [action, reservation, reviewPrompted]);

  // La reseña es de la VISITA: si vinieron tres perros, una sola calificación
  // cubre a los tres (el API escribe una fila por mascota).
  const reviewType = (reservation?.reservationType ?? "STAY") as
    | "STAY"
    | "BATH"
    | "DAYCARE";
  const reviewCopy = REVIEW_COPY[reviewType] ?? REVIEW_COPY.STAY;
  const reviewTarget = {
    reservationIds:
      groupedReservations && groupedReservations.length > 0
        ? groupedReservations.map((r: any) => r.id)
        : [reservation?.id ?? ""],
    reservationType: reviewType,
    petNames:
      groupedReservations && groupedReservations.length > 0
        ? (groupedReservations
            .map((r: any) => r.pet?.name)
            .filter(Boolean) as string[])
        : [reservation?.pet?.name].filter(Boolean) as string[],
  };

  const handlePayBalance = async () => {
    if (!id || pendingConfirm.hasPending) return;
    setPayingBalance(true);
    try {
      const { clientSecret, paymentIntentId } = await createBalancePayment(id);

      if (!clientSecret) {
        Alert.alert(
          "Error",
          "No se pudo iniciar el pago. Verifica el saldo pendiente o intenta de nuevo.",
        );
        return;
      }

      const outcome = await checkout.run({
        clientSecret,
        paymentIntentId,
      });
      if (outcome !== "paid") return;

      // Mismo cuerpo que `confirmBalancePayment`, pero con red de seguridad.
      await pendingConfirm.confirm({
        paymentIntentId,
        request: {
          path: `${ENDPOINTS.payments}/confirm-balance`,
          payload: { reservationId: id, stripePaymentIntentId: paymentIntentId },
        },
      });
      finishBalance();
    } catch (err: any) {
      // Ya se cobró y el aviso con "Reintentar" está en pantalla.
      if (err instanceof PendingConfirmationError) return;
      Alert.alert("Error", err.message || "No se pudo procesar el pago");
    } finally {
      setPayingBalance(false);
    }
  };

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!reservation) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.emptyText}>Reservación no encontrada</Text>
      </View>
    );
  }

  const statusConfig = STATUS_CONFIG[reservation.status] ?? STATUS_CONFIG.PENDING;
  const isBath = reservation.reservationType === "BATH";
  const bathAddon = isBath
    ? reservation.addons?.find(
        (a) => a.variant?.serviceType?.code === "BATH",
      )
    : undefined;
  const bathHasDeslanado = bathAddon?.variant?.deslanado === true;
  const bathHasCorte = bathAddon?.variant?.corte === true;
  // Cuando el staff ya definió el precio de los extras, el card de pago toma
  // el lugar de la nota informativa.
  const showBathExtrasNotice =
    isBath &&
    (bathHasDeslanado || bathHasCorte) &&
    !bathAddon?.extraPaymentStatus &&
    (reservation.status === "CONFIRMED" || reservation.status === "CHECKED_IN");

  // Para baño concluido con extras pagados: mostramos un único card con el
  // desglose en vez de duplicar "Servicios adicionales" + "Extras pagado".
  const bathExtraDeslanadoPrice = bathAddon?.extraDeslanadoPrice
    ? Number(bathAddon.extraDeslanadoPrice)
    : null;
  const bathExtraCortePrice = bathAddon?.extraCortePrice
    ? Number(bathAddon.extraCortePrice)
    : null;
  const bathExtraTotal = bathAddon?.extraPrice
    ? Number(bathAddon.extraPrice)
    : null;
  const bathExtrasPaid =
    isBath && bathAddon?.extraPaymentStatus === "PAID" && bathExtraTotal !== null;

  return (
    <>
      <Stack.Screen
        options={{
          title: isBath ? "Detalle del baño" : "Detalle de reservación",
          ...(reservationRefund > 0
            ? {
                headerRight: () => (
                  <TouchableOpacity
                    onPress={() =>
                      router.push("/profile/credit-history" as any)
                    }
                    style={styles.refundPill}
                    activeOpacity={0.85}
                    hitSlop={8}
                    testID="reservation-refund-pill"
                  >
                    <Ionicons
                      name="wallet"
                      size={13}
                      color={COLORS.successText}
                    />
                    <Text style={styles.refundPillText}>
                      +{formatCurrency(reservationRefund)}
                    </Text>
                  </TouchableOpacity>
                ),
              }
            : {}),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!groupedReservations && reservation.pet?.photoUrl ? (
            <Image
              source={{ uri: cloudinaryResized(reservation.pet.photoUrl, 156, "fill") }}
              style={styles.petAvatar}
            />
          ) : (
            <View style={[styles.petAvatar, styles.petAvatarFallback]}>
              <Ionicons name="paw" size={22} color={COLORS.primary} />
            </View>
          )}
          <Text style={styles.petName} numberOfLines={2}>
            {groupedReservations
              ? groupedReservations.map((r: any) => formatName(r.pet.name)).join(", ")
              : formatName(reservation.pet?.name)}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusConfig.bg }]}>
          <Text style={[styles.badgeText, { color: statusConfig.text }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>

      {/* Banner: cancelada por admin, falta elegir reembolso */}
      {hasPendingRefundChoice && (
        <TouchableOpacity
          style={styles.refundBanner}
          onPress={() => setCancelModalMode("issue-refund")}
          activeOpacity={0.85}
        >
          <Ionicons name="cash-outline" size={20} color={COLORS.white} />
          <View style={{ flex: 1 }}>
            <Text style={styles.refundBannerTitle}>Elige tu reembolso</Text>
            <Text style={styles.refundBannerSub}>
              Cancelamos esta reserva. Toca para elegir cómo recibir {formatCurrency(totalPaidForCancel)}.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.white} />
        </TouchableOpacity>
      )}

      {/* Mascotas del grupo */}
      {groupedReservations && groupedReservations.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mascotas</Text>
          {groupedReservations.map((r: any) => (
            <View key={r.id} style={styles.groupPetRow}>
              <Ionicons name="paw" size={16} color={COLORS.primary} />
              <Text style={styles.groupPetName}>{formatName(r.pet.name)}</Text>
              {r.pet.breed && <Text style={styles.groupPetBreed}>{r.pet.breed}</Text>}
              <Text style={styles.groupPetAmount}>{formatCurrency(r.totalAmount)}</Text>
            </View>
          ))}
          <View style={styles.groupTotalRow}>
            <Text style={styles.groupTotalLabel}>Total</Text>
            <Text style={styles.groupTotalValue}>
              {formatCurrency(groupedReservations.reduce((sum: number, r: any) => sum + Number(r.totalAmount), 0))}
            </Text>
          </View>
        </View>
      )}

      {/* Info card */}
      <View style={styles.card}>
        {reservation.reservationType === "DAYCARE" ? (
          <View style={styles.bathHero}>
            <View style={styles.bathBadge}>
              <Ionicons name="sunny" size={14} color={COLORS.primary} />
              <Text style={styles.bathBadgeText}>Guardería</Text>
            </View>
            {reservation.appointmentAt && (
              <View style={styles.bathInfoRow}>
                <Text style={styles.bathDay}>
                  {formatWeekdayDayShort(reservation.appointmentAt)}
                </Text>
                {reservation.checkInTime && reservation.checkOutTime && (
                  <Text style={styles.bathTime}>
                    {formatTimeHHmm(reservation.checkInTime)}–
                    {formatTimeHHmm(reservation.checkOutTime)}
                  </Text>
                )}
              </View>
            )}
          </View>
        ) : reservation.reservationType === "BATH" ? (
          <View style={styles.bathHero}>
            <View style={styles.bathBadge}>
              <Ionicons name="water" size={14} color={COLORS.primary} />
              <Text style={styles.bathBadgeText}>Cita de baño</Text>
            </View>
            {reservation.appointmentAt && (
              <View style={styles.bathInfoRow}>
                <Text style={styles.bathDay}>
                  {formatWeekdayDayShort(reservation.appointmentAt)}
                </Text>
                <Text style={styles.bathTime}>
                  {formatTime(reservation.appointmentAt)}
                </Text>
              </View>
            )}
          </View>
        ) : (
          reservation.checkIn &&
          reservation.checkOut && (
            <View style={styles.dateHero}>
              <View style={styles.datePill}>
                <Text style={styles.datePillLabel}>CHECK-IN</Text>
                <Text style={styles.datePillDay}>
                  {formatDayShort(reservation.checkIn, { timeZone: "UTC" })}
                </Text>
                <Text style={styles.datePillSub}>
                  {formatWeekdayShort(reservation.checkIn, { timeZone: "UTC" })}
                </Text>
                {(canEditCheckInTime || reservation.checkInTime) && (
                  <TouchableOpacity
                    style={[
                      styles.timeChip,
                      reservation.checkInTime && styles.timeChipSet,
                    ]}
                    onPress={() => setTimePickerFor("in")}
                    disabled={!canEditCheckInTime}
                    activeOpacity={0.7}
                    testID="reservation-checkin-time-chip"
                  >
                    <Ionicons
                      name="time-outline"
                      size={11}
                      color={reservation.checkInTime ? COLORS.primary : COLORS.textTertiary}
                    />
                    <Text
                      style={[
                        styles.timeChipText,
                        reservation.checkInTime && styles.timeChipTextSet,
                      ]}
                    >
                      {reservation.checkInTime
                        ? formatTimeHHmm(reservation.checkInTime)
                        : "Indicar hora"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.dateConnector}>
                <View style={styles.connectorLine} />
                {reservation.totalDays != null && (
                  <View style={styles.nightsBadge}>
                    <Ionicons name="moon" size={12} color={COLORS.primary} />
                    <Text style={styles.nightsBadgeText}>
                      {reservation.totalDays}{" "}
                      {reservation.totalDays === 1 ? "noche" : "noches"}
                    </Text>
                  </View>
                )}
                <View style={styles.connectorLine} />
              </View>

              <View style={styles.datePill}>
                <Text style={styles.datePillLabel}>CHECK-OUT</Text>
                <Text style={styles.datePillDay}>
                  {formatDayShort(reservation.checkOut, { timeZone: "UTC" })}
                </Text>
                <Text style={styles.datePillSub}>
                  {formatWeekdayShort(reservation.checkOut, { timeZone: "UTC" })}
                </Text>
                {(canEditCheckOutTime || reservation.checkOutTime) && (
                  <TouchableOpacity
                    style={[
                      styles.timeChip,
                      reservation.checkOutTime && styles.timeChipSet,
                    ]}
                    onPress={() => setTimePickerFor("out")}
                    disabled={!canEditCheckOutTime}
                    activeOpacity={0.7}
                    testID="reservation-checkout-time-chip"
                  >
                    <Ionicons
                      name="time-outline"
                      size={11}
                      color={reservation.checkOutTime ? COLORS.primary : COLORS.textTertiary}
                    />
                    <Text
                      style={[
                        styles.timeChipText,
                        reservation.checkOutTime && styles.timeChipTextSet,
                      ]}
                    >
                      {reservation.checkOutTime
                        ? formatTimeHHmm(reservation.checkOutTime)
                        : "Indicar hora"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )
        )}

        {reservation.reservationType === "STAY" && (
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <View style={styles.metaIconWrap}>
                <Ionicons
                  name="bed-outline"
                  size={16}
                  color={COLORS.primary}
                />
              </View>
              <Text style={styles.metaLabel}>Habitación</Text>
              <Text style={styles.metaValue} numberOfLines={1}>
                {reservation.room?.name ?? "Por asignar"}
              </Text>
            </View>
            {!groupedReservations && reservation.pet?.breed && (
              <>
                <View style={styles.metaDivider} />
                <View style={styles.metaItem}>
                  <View style={styles.metaIconWrap}>
                    <Ionicons name="paw" size={16} color={COLORS.primary} />
                  </View>
                  <Text style={styles.metaLabel}>Raza</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>
                    {reservation.pet.breed}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* Qué incluye el cobro. En multi-mascota es el desglose de ESTA
            mascota; el reparto del grupo ya sale en el card "Mascotas". */}
        <ReservationBreakdownCard reservation={reservation} />

        <View style={styles.totalFooter}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>
            {formatCurrency(reservation.totalAmount)}
          </Text>
        </View>
      </View>

      {/* Modificar fechas */}
      {canModify && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() =>
              router.push(`/reservation/modify/${reservation.id}` as any)
            }
            activeOpacity={0.8}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={COLORS.primary}
            />
            <Text style={styles.secondaryButtonText}>Modificar fechas</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Extension payment options (after approval) */}
      {approvedExtension && (
        <PaymentCardFlow
          kind="extension"
          reservationId={reservation.id}
          changeRequest={approvedExtension}
        />
      )}
      {approvedExtensionPaidShortcut &&
        approvedExtensionPaidShortcut.id !== approvedExtension?.id && (
          <PaymentCardFlow
            kind="extension"
            reservationId={reservation.id}
            changeRequest={approvedExtensionPaidShortcut}
          />
        )}

      {/* Deposit balance banner */}
      {pendingChange && (
        <View style={styles.pendingChangeBanner}>
          <View style={styles.pendingChangeHeader}>
            <Ionicons name="time-outline" size={18} color={COLORS.warningText} />
            <Text style={styles.pendingChangeTitle}>
              Solicitud de extensión pendiente
            </Text>
          </View>
          <Text style={styles.pendingChangeBody}>
            Nuevas fechas:{" "}
            {formatDayShort(pendingChange.newCheckIn)}{" "}
            →{" "}
            {formatDayShort(pendingChange.newCheckOut)}{" "}
            (+{formatCurrency(pendingChange.deltaAmount)})
          </Text>
          <Text style={styles.pendingChangeSubtitle}>
            El admin la revisará pronto.
          </Text>
        </View>
      )}

      {/* El saldo se liquida en la app o al entregar al perro; no hay fecha
          límite ni cancelación automática (ver auto-actions.ts). Sigue visible
          después del check-out: antes desaparecía ahí y la visita se quedaba sin
          forma de cobrarse desde la app. */}
      {hasBalance && (
        <View style={styles.balanceBanner}>
          <View style={styles.balanceBannerHeader}>
            <Ionicons name="warning-outline" size={20} color={COLORS.warningText} />
            <Text style={styles.balanceBannerTitle}>
              {balanceFromExtension ? "Saldo por extensión" : "Saldo pendiente"}
            </Text>
          </View>
          <Text style={styles.balanceBannerAmount}>
            {formatCurrency(remainingBalance)} MXN
          </Text>
          {balanceAfterCheckout ? (
            <Text style={styles.balanceBannerWarning}>
              La visita de {formatName(reservation.pet?.name ?? "tu mascota")} ya
              terminó y quedó este saldo por cubrir. Puedes pagarlo aquí mismo.
            </Text>
          ) : balanceFromExtension ? (
            <Text style={styles.balanceBannerWarning}>
              Corresponde a los días agregados tras la extensión aprobada.
            </Text>
          ) : (
            <Text style={styles.balanceBannerWarning}>
              Puedes liquidarlo aquí en la app o al entregar a tu mascota en la sucursal de Holidog Inn.
            </Text>
          )}

          {/* Qué se está pagando: total, lo ya cubierto y el desglose de
              conceptos. Antes solo se veía la cifra del saldo, sin explicación. */}
          {totalPaid > 0 && (
            <View style={styles.balancePaidRow}>
              <Text style={styles.balancePaidLabel}>Ya pagaste</Text>
              <Text style={styles.balancePaidValue}>
                {formatCurrency(totalPaid)}
              </Text>
            </View>
          )}
          <ReservationBreakdownCard
            reservation={reservation}
            variant="payment"
            title="Qué estás pagando"
          />

          <TouchableOpacity
            style={[
              styles.balanceButton,
              (payingBalance || pendingConfirm.hasPending) && { opacity: 0.5 },
            ]}
            onPress={handlePayBalance}
            disabled={payingBalance || pendingConfirm.hasPending}
            activeOpacity={0.8}
          >
            {payingBalance ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="card-outline" size={20} color={COLORS.white} />
                <Text style={styles.balanceButtonText}>
                  {balanceAfterCheckout ? "Pagar saldo" : "Liquidar saldo"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {checkout.stuckNotice}
          {pendingConfirm.notice}
        </View>
      )}

      {/* La nota de la reserva ya NO se le muestra al dueño: el campo `notes`
          venía sirviendo a la vez de nota del cliente y de nota interna del
          equipo (el wizard del admin decía "Notas internas..." y escribía ahí),
          así que lo interno era legible para él. Ahora el equipo usa
          `internalNotes`, y las notas históricas de este campo dejan de verse
          sin tener que revisarlas una por una. */}

      {/* Bath upsell: solo para STAYS donde se puede sumar un baño de salida. */}
      {reservation.reservationType === "STAY" && (
        <BathUpsellCard reservation={reservation} />
      )}

      {/* Baño primario: servicios contratados.
          - Pagado: itemizado con precios y total, marca verde.
          - Aún sin precio: chips + nota explicando cobro post-servicio.
          - Con precio pero pendiente/al recoger: chips simples; el PaymentCardFlow maneja la acción. */}
      {isBath && (bathHasDeslanado || bathHasCorte) && (
        <View
          style={[
            styles.bathServicesCard,
            bathExtrasPaid && styles.bathServicesCardPaid,
          ]}
        >
          <View style={styles.bathServicesHeader}>
            <View
              style={[
                styles.bathServicesIconWrap,
                bathExtrasPaid && {
                  backgroundColor: COLORS.successBg,
                },
              ]}
            >
              <Ionicons
                name={bathExtrasPaid ? "checkmark-circle" : "cut-outline"}
                size={20}
                color={bathExtrasPaid ? COLORS.successText : COLORS.primary}
              />
            </View>
            <Text style={styles.bathServicesTitle}>Servicios adicionales</Text>
            {bathExtrasPaid && (
              <View style={styles.bathServicesPaidPill}>
                <Text style={styles.bathServicesPaidPillText}>Pagado</Text>
              </View>
            )}
          </View>

          {bathExtrasPaid ? (
            <View style={styles.bathServicesItemized}>
              {bathHasDeslanado && (
                <View style={styles.bathServicesRow}>
                  <View style={styles.bathServicesRowLeft}>
                    <Ionicons
                      name="cut-outline"
                      size={14}
                      color={COLORS.primary}
                    />
                    <Text style={styles.bathServicesRowLabel}>Deslanado</Text>
                  </View>
                  <Text style={styles.bathServicesRowValue}>
                    {bathExtraDeslanadoPrice !== null
                      ? formatCurrency(bathExtraDeslanadoPrice)
                      : "—"}
                  </Text>
                </View>
              )}
              {bathHasCorte && (
                <View style={styles.bathServicesRow}>
                  <View style={styles.bathServicesRowLeft}>
                    <Ionicons name="cut" size={14} color={COLORS.primary} />
                    <Text style={styles.bathServicesRowLabel}>Corte</Text>
                  </View>
                  <Text style={styles.bathServicesRowValue}>
                    {bathExtraCortePrice !== null
                      ? formatCurrency(bathExtraCortePrice)
                      : "—"}
                  </Text>
                </View>
              )}
              <View style={styles.bathServicesTotalRow}>
                <Text style={styles.bathServicesTotalLabel}>Total</Text>
                <Text style={styles.bathServicesTotalValue}>
                  {formatCurrency(bathExtraTotal!)}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.bathServicesChips}>
                {bathHasDeslanado && (
                  <View style={styles.bathServiceChip}>
                    <Ionicons name="cut-outline" size={13} color={COLORS.primary} />
                    <Text style={styles.bathServiceChipText}>Deslanado</Text>
                  </View>
                )}
                {bathHasCorte && (
                  <View style={styles.bathServiceChip}>
                    <Ionicons name="cut" size={13} color={COLORS.primary} />
                    <Text style={styles.bathServiceChipText}>Corte</Text>
                  </View>
                )}
              </View>
              {showBathExtrasNotice && (
                <View style={styles.bathServicesNoteBox}>
                  <Ionicons
                    name="information-circle"
                    size={16}
                    color={COLORS.infoText}
                  />
                  <Text style={styles.bathServicesNoteText}>
                    El costo se calcula al terminar el baño según el esfuerzo y el
                    estado del pelaje, y se cobra cuando recoges a tu mascota.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* Acciones de pago de extras (PENDING_PAYMENT / PAY_ON_PICKUP).
          El estado PAID ya queda visualizado en el card unificado de servicios. */}
      {reservation.addons
        ?.filter(
          (a) =>
            a.variant?.serviceType?.code === "BATH" &&
            a.extraPaymentStatus &&
            a.extraPaymentStatus !== "PAID",
        )
        .map((a) => (
          <PaymentCardFlow
            key={a.id}
            kind="bath"
            reservationId={reservation.id}
            addon={a}
          />
        ))}

      {/* Reportes diarios del staff — botón a pantalla dedicada */}
      {checklists && checklists.length > 0 && (
        <TouchableOpacity
          style={styles.checklistsCard}
          onPress={() => router.push(`/reservation/checklists/${id}` as any)}
          activeOpacity={0.85}
          testID="reservation-checklists-link"
        >
          <View style={styles.checklistsIcon}>
            <Ionicons name="document-text" size={22} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checklistsTitle}>Reportes diarios</Text>
            <Text style={styles.checklistsSubtitle}>
              {checklists.length}{" "}
              {checklists.length === 1 ? "reporte" : "reportes"} del equipo HDI
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
        </TouchableOpacity>
      )}


      {/* Review CTA or existing review */}
      {reservation.status === "CHECKED_OUT" && (
        <View style={{ marginTop: 8, marginBottom: 16 }}>
          {reservation.review ? (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Tu reseña</Text>
              <View style={styles.pawRow}>
                <PawRating value={reservation.review.rating} size={24} gap={4} />
              </View>
              {reservation.review.comment && (
                <Text style={styles.reviewComment}>
                  {reservation.review.comment}
                </Text>
              )}
            </View>
          ) : (
            <TouchableOpacity
              style={styles.reviewCTA}
              onPress={() => setReviewModalOpen(true)}
              activeOpacity={0.8}
            >
              {/* Patita, no estrella: la calificación son patitas. */}
              <Ionicons name="paw-outline" size={22} color={COLORS.primary} />
              <Text style={styles.reviewCTAText}>{reviewCopy.cta}</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Servicio a domicilio — se puede pedir después de reservar, mientras la
          reserva siga confirmada. */}
      {(reservation.homeDelivery || canEditDelivery) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Servicio a domicilio</Text>
          {reservation.homeDelivery ? (
            <>
              <View style={styles.deliveryRow}>
                <Ionicons name="car-outline" size={18} color={COLORS.primary} />
                <Text style={styles.deliveryAddress}>
                  {reservation.homeDeliveryAddress ?? "Dirección registrada"}
                </Text>
              </View>
              {/* Qué viajes cubre lo pagado: sin esto, un cliente que contrató
                  solo ida esperaría que también se la regresemos. */}
              <Text style={styles.deliveryFee}>
                {VIAJE_SUB_CLIENTE[reservation.homeDeliveryTrip ?? "PICKUP"]}
              </Text>
              <Text style={styles.deliveryFee}>
                {deliveryFee > 0
                  ? `${formatCurrency(deliveryFee)} · se paga al recoger a tu mascota`
                  : "Sin costo · cortesía de Holidog Inn"}
              </Text>
              {canEditDelivery && (
                <TouchableOpacity
                  style={styles.deliveryCTA}
                  onPress={() => setDeliveryModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.deliveryCTAText}>Cambiar o quitar</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <TouchableOpacity
              style={styles.deliveryCTA}
              onPress={() => setDeliveryModalVisible(true)}
              activeOpacity={0.7}
              testID="client-add-delivery"
            >
              <Ionicons name="car-outline" size={18} color={COLORS.primary} />
              <Text style={styles.deliveryCTAText}>
                Recogemos y entregamos a tu mascota
              </Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Payment status — última sección */}
      {reservation.payments && reservation.payments.length > 0 && (
        <View style={styles.card}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.cardTitle}>Pagos</Text>
            <View style={styles.countChip}>
              <Text style={styles.countChipText}>
                {reservation.payments.length}
              </Text>
            </View>
          </View>
          {reservation.payments.map((p, idx) => {
            const pConfig = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.UNPAID;
            const methodIcon: keyof typeof Ionicons.glyphMap =
              p.method === "CASH"
                ? "cash-outline"
                : p.method === "TRANSFER"
                ? "swap-horizontal-outline"
                : "card-outline";
            const isLast = idx === reservation.payments.length - 1;
            return (
              <View
                key={p.id}
                style={[styles.paymentRowNew, isLast && styles.paymentRowLast]}
              >
                <View style={styles.paymentIconWrap}>
                  <Ionicons name={methodIcon} size={18} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentAmount}>
                    {formatCurrency(p.amount)}
                  </Text>
                  <Text style={styles.paymentMeta}>
                    {p.method}
                    {p.paidAt ? ` · ${formatDayShort(p.paidAt)}` : ""}
                  </Text>
                </View>
                <View
                  style={[styles.paymentBadge, { backgroundColor: pConfig.bg }]}
                >
                  <Text
                    style={[styles.paymentBadgeText, { color: pConfig.color }]}
                  >
                    {pConfig.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {canCancel && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={() => setCancelModalMode("cancel")}
            activeOpacity={0.8}
          >
            <Ionicons
              name="close-circle-outline"
              size={18}
              color={COLORS.errorText}
            />
            <Text style={styles.dangerButtonText}>
              {isBath ? "Cancelar baño" : "Cancelar reservación"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ReviewPromptModal
        visible={reviewModalOpen}
        userId={reservation.ownerId}
        target={reviewTarget}
        onDismiss={() => {
          setReviewModalOpen(false);
          // Limpiar el ?action del push para que volver atrás no lo reabra
          // (mismo cuidado que con choose-refund).
          if (action === "review") router.setParams({ action: undefined });
        }}
      />

      <CancelReservationModal
        visible={cancelModalMode !== null}
        mode={cancelModalMode ?? "cancel"}
        reservationId={reservation.id}
        petName={reservation.pet?.name ?? ""}
        refundAmount={totalPaidForCancel}
        allowStripeRefund={paidStripeAmount > 0}
        onClose={() => {
          setCancelModalMode(null);
          if (action === "choose-refund") {
            router.setParams({ action: undefined });
          }
        }}
      />

      <ReservationDeliveryModal
        visible={deliveryModalVisible}
        onClose={() => setDeliveryModalVisible(false)}
        submitting={deliveryMutation.isPending}
        onSubmit={(payload) => deliveryMutation.mutate(payload)}
        preloadSavedAddress
        current={{
          enabled: !!reservation.homeDelivery,
          address: reservation.homeDeliveryAddress ?? null,
          fee: deliveryFee,
        }}
      />

      <TimeSlotPicker
        visible={timePickerFor !== null}
        title={timePickerFor === "in" ? "Hora de llegada" : "Hora de recogida"}
        subtitle={
          timePickerFor === "in"
            ? "¿A qué hora planeas dejar a tu peludito? Así lo tenemos todo listo."
            : "¿A qué hora planeas recogerlo? Después de la 1:00 pm aplica guardería ($25/h)."
        }
        value={
          timePickerFor === "in"
            ? reservation.checkInTime ?? null
            : reservation.checkOutTime ?? null
        }
        warnFrom={timePickerFor === "out" ? "13:00" : undefined}
        warnLabel={timePickerFor === "out" ? "guardería" : undefined}
        onSelect={(v) => {
          const field = timePickerFor === "in" ? "checkInTime" : "checkOutTime";
          setTimePickerFor(null);
          timesMutation.mutate({ [field]: v });
        }}
        onClose={() => setTimePickerFor(null)}
      />
      </ScrollView>

    </>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLeft}>
        <Ionicons name={icon} size={16} color={COLORS.textTertiary} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}
