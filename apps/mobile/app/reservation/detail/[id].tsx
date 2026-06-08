import { COLORS } from "@/constants/colors";
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StripeProvider, useStripe } from "@stripe/stripe-react-native";
import {
  getReservationById,
  getReservations,
  getCreditLedger,
  getOwnerChecklists,
  createBalancePayment,
  confirmBalancePayment,
} from "@/lib/api";
import { BathUpsellCard } from "@/components/BathUpsellCard";
import { BathExtrasPaymentCard } from "@/components/BathExtrasPaymentCard";
import { ExtensionPaymentCard } from "@/components/ExtensionPaymentCard";
import { formatName } from "@/lib/format";
import { ReviewPromptModal } from "@/components/ReviewPromptModal";
import { CancelReservationModal } from "@/components/CancelReservationModal";
import { listChangeRequests, type ChangeRequest } from "@/lib/api";

export function ErrorBoundary({ error }: { error: Error }) {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.errorText, marginBottom: 8 }}>
        Error en la pantalla
      </Text>
      <Text style={{ fontSize: 14, color: COLORS.textTertiary, textAlign: "center" }}>
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

function formatDayShort(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function formatWeekday(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", { weekday: "short" });
}

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
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [payingBalance, setPayingBalance] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewPrompted, setReviewPrompted] = useState(false);
  const [cancelModalMode, setCancelModalMode] = useState<
    null | "cancel" | "issue-refund"
  >(null);
  const {
    data: reservation,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
    refetchInterval: 30_000,
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
  const canCancel =
    reservation && reservation.status === "CONFIRMED";
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
  const hasBalance =
    remainingBalance > 0.01 &&
    reservation?.status !== "CANCELLED" &&
    reservation?.status !== "CHECKED_OUT";
  const deadlinePassed =
    isDeposit && reservation?.depositDeadline
      ? new Date(reservation.depositDeadline) < new Date()
      : false;

  useEffect(() => {
    if (
      reservation &&
      reservation.status === "CHECKED_OUT" &&
      !reservation.review &&
      !reviewPrompted
    ) {
      setReviewPrompted(true);
      setReviewModalOpen(true);
    }
  }, [reservation, reviewPrompted]);

  const handlePayBalance = async () => {
    if (!id) return;
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

      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "Holidog Inn",
        applePay: { merchantCountryCode: "MX" },
      });
      if (initError) {
        Alert.alert("Error", initError.message);
        return;
      }

      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        if (payError.code !== "Canceled") {
          Alert.alert("Error de pago", payError.message);
        }
        return;
      }

      await confirmBalancePayment(id, paymentIntentId);
      queryClient.invalidateQueries({ queryKey: ["reservation", id] });
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      router.replace({
        pathname: "/reservation/success" as any,
        params: { variant: "balance" },
      });
    } catch (err: any) {
      Alert.alert("Error", err.message || "No se pudo procesar el pago");
    } finally {
      setPayingBalance(false);
    }
  };

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
                      +${reservationRefund.toLocaleString("es-MX")}
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
              source={{ uri: reservation.pet.photoUrl }}
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
              Cancelamos esta reserva. Toca para elegir cómo recibir ${totalPaidForCancel.toLocaleString("es-MX")}.
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
              <Text style={styles.groupPetAmount}>${Number(r.totalAmount).toLocaleString()}</Text>
            </View>
          ))}
          <View style={styles.groupTotalRow}>
            <Text style={styles.groupTotalLabel}>Total</Text>
            <Text style={styles.groupTotalValue}>
              ${groupedReservations.reduce((sum: number, r: any) => sum + Number(r.totalAmount), 0).toLocaleString()}
            </Text>
          </View>
        </View>
      )}

      {/* Info card */}
      <View style={styles.card}>
        {reservation.reservationType === "BATH" ? (
          <View style={styles.bathHero}>
            <View style={styles.bathBadge}>
              <Ionicons name="water" size={14} color={COLORS.primary} />
              <Text style={styles.bathBadgeText}>Cita de baño</Text>
            </View>
            {reservation.appointmentAt && (
              <View style={styles.bathInfoRow}>
                <Text style={styles.bathDay}>
                  {new Date(reservation.appointmentAt).toLocaleDateString(
                    "es-MX",
                    {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    }
                  )}
                </Text>
                <Text style={styles.bathTime}>
                  {new Date(reservation.appointmentAt).toLocaleTimeString(
                    "es-MX",
                    {
                      timeZone: "America/Hermosillo",
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}
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
                  {formatDayShort(reservation.checkIn)}
                </Text>
                <Text style={styles.datePillSub}>
                  {formatWeekday(reservation.checkIn)}
                </Text>
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
                  {formatDayShort(reservation.checkOut)}
                </Text>
                <Text style={styles.datePillSub}>
                  {formatWeekday(reservation.checkOut)}
                </Text>
              </View>
            </View>
          )
        )}

        {reservation.reservationType !== "BATH" && (
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

        <View style={styles.totalFooter}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>
            ${Number(reservation.totalAmount).toLocaleString("es-MX")}
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
        <ExtensionPaymentCard
          reservationId={reservation.id}
          changeRequest={approvedExtension}
        />
      )}
      {approvedExtensionPaidShortcut &&
        approvedExtensionPaidShortcut.id !== approvedExtension?.id && (
          <ExtensionPaymentCard
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
            {new Date(pendingChange.newCheckIn).toLocaleDateString("es-MX", {
              day: "numeric",
              month: "short",
            })}{" "}
            →{" "}
            {new Date(pendingChange.newCheckOut).toLocaleDateString("es-MX", {
              day: "numeric",
              month: "short",
            })}{" "}
            (+${Number(pendingChange.deltaAmount).toLocaleString("es-MX")})
          </Text>
          <Text style={styles.pendingChangeSubtitle}>
            El admin la revisará pronto.
          </Text>
        </View>
      )}

      {hasBalance && !deadlinePassed && (
        <View style={styles.balanceBanner}>
          <View style={styles.balanceBannerHeader}>
            <Ionicons name="warning-outline" size={20} color={COLORS.warningText} />
            <Text style={styles.balanceBannerTitle}>
              {isDeposit ? "Saldo pendiente" : "Saldo por extensión"}
            </Text>
          </View>
          <Text style={styles.balanceBannerAmount}>
            ${remainingBalance.toLocaleString("es-MX")} MXN
          </Text>
          {isDeposit && (
            <Text style={styles.balanceBannerWarning}>
              Puedes liquidarlo aquí en la app o al entregar a tu mascota en la sucursal de Holidog Inn.
            </Text>
          )}
          {!isDeposit && (
            <Text style={styles.balanceBannerWarning}>
              Corresponde a los días agregados tras la extensión aprobada.
            </Text>
          )}
          <TouchableOpacity
            style={[styles.balanceButton, payingBalance && { opacity: 0.5 }]}
            onPress={handlePayBalance}
            disabled={payingBalance}
            activeOpacity={0.8}
          >
            {payingBalance ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="card-outline" size={20} color={COLORS.white} />
                <Text style={styles.balanceButtonText}>Liquidar saldo</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {hasBalance && deadlinePassed && (
        <View style={[styles.balanceBanner, { backgroundColor: COLORS.errorBg, borderColor: COLORS.errorText }]}>
          <Ionicons name="close-circle-outline" size={20} color={COLORS.errorText} />
          <Text style={[styles.balanceBannerTitle, { color: COLORS.errorText }]}>
            Reservación cancelada por falta de pago
          </Text>
        </View>
      )}

      {/* Notes */}
      {reservation.notes && (
        <View style={styles.notesCard}>
          <Ionicons name="document-text-outline" size={16} color={COLORS.warningText} />
          <Text style={styles.notesText}>{reservation.notes}</Text>
        </View>
      )}

      {/* Bath upsell: solo para STAYS donde se puede sumar un baño de salida. */}
      {!isBath && <BathUpsellCard reservation={reservation} />}

      {/* Baño primario: servicios contratados.
          - Pagado: itemizado con precios y total, marca verde.
          - Aún sin precio: chips + nota explicando cobro post-servicio.
          - Con precio pero pendiente/al recoger: chips simples; el BathExtrasPaymentCard maneja la acción. */}
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
                      ? `$${bathExtraDeslanadoPrice.toLocaleString("es-MX")}`
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
                      ? `$${bathExtraCortePrice.toLocaleString("es-MX")}`
                      : "—"}
                  </Text>
                </View>
              )}
              <View style={styles.bathServicesTotalRow}>
                <Text style={styles.bathServicesTotalLabel}>Total</Text>
                <Text style={styles.bathServicesTotalValue}>
                  ${bathExtraTotal!.toLocaleString("es-MX")}
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
          <BathExtrasPaymentCard
            key={a.id}
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
                {[1, 2, 3, 4, 5].map((i) => (
                  <Ionicons
                    key={i}
                    name={
                      i <= reservation.review!.rating ? "paw" : "paw-outline"
                    }
                    size={24}
                    color={
                      i <= reservation.review!.rating ? COLORS.primary : COLORS.border
                    }
                  />
                ))}
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
              <Ionicons name="star-outline" size={22} color={COLORS.primary} />
              <Text style={styles.reviewCTAText}>
                Dejar reseña de esta estancia
              </Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
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
                    ${Number(p.amount).toLocaleString("es-MX")}
                  </Text>
                  <Text style={styles.paymentMeta}>
                    {p.method}
                    {p.paidAt
                      ? ` · ${new Date(p.paidAt).toLocaleDateString("es-MX", {
                          day: "numeric",
                          month: "short",
                        })}`
                      : ""}
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
        reservationId={reservation.id}
        onDismiss={() => setReviewModalOpen(false)}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  contentContainer: { padding: 16, paddingBottom: 40 },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  emptyText: { fontSize: 14, color: COLORS.textDisabled },
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
    flex: 1,
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 13, fontWeight: "700" },
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
  cardTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoLabel: { fontSize: 14, color: COLORS.textTertiary },
  infoValue: { fontSize: 14, fontWeight: "600", color: COLORS.textPrimary },
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
    fontWeight: "800",
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
    fontWeight: "800",
    color: COLORS.primary,
  },
  // Bath hero
  bathHero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    padding: 12,
  },
  bathBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  bathBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },
  bathInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bathDay: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  bathTime: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  // Meta row
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
    fontWeight: "800",
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
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 10,
    marginTop: 4,
  },
  totalValue: { fontSize: 20, fontWeight: "800", color: COLORS.primary },
  // Payments card
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
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
  paymentIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentRowNew: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  paymentRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
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
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  paymentRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  refundPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.successBg,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.successText,
  },
  refundPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.successText,
  },
  refundBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  refundBannerTitle: {
    color: COLORS.white,
    fontWeight: "800",
    fontSize: 15,
  },
  refundBannerSub: {
    color: COLORS.white,
    opacity: 0.9,
    fontSize: 12,
    marginTop: 2,
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: COLORS.warningBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  pendingBannerText: { flex: 1, gap: 2 },
  pendingBannerTitle: { fontSize: 14, fontWeight: "700", color: COLORS.warningText },
  pendingBannerBody: { fontSize: 13, color: COLORS.warningText, lineHeight: 18, opacity: 0.85 },
  notesCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.notesBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  notesText: { flex: 1, fontSize: 14, color: COLORS.notesText, lineHeight: 20 },
  reviewCard: {
    backgroundColor: COLORS.reviewBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.reviewBorder,
    gap: 8,
  },
  reviewTitle: { fontSize: 16, fontWeight: "700", color: COLORS.primary },
  pawRow: { flexDirection: "row", gap: 4 },
  reviewComment: {
    fontSize: 14,
    color: COLORS.textTertiary,
    lineHeight: 20,
    marginTop: 4,
  },
  reviewCTA: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.reviewBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.reviewBorder,
  },
  reviewCTAText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.primary,
  },
  // Group pets
  groupPetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  groupPetName: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  groupPetBreed: {
    fontSize: 13,
    color: COLORS.textTertiary,
    flex: 1,
  },
  groupPetAmount: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  groupTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 8,
    marginTop: 4,
  },
  groupTotalLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  groupTotalValue: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.primary,
  },
  // Balance banner
  balanceBanner: {
    backgroundColor: COLORS.warningBg,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.warningText,
    gap: 8,
  },
  balanceBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balanceBannerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.warningText,
  },
  balanceBannerAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  balanceBannerDeadline: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  balanceBannerWarning: {
    fontSize: 13,
    color: COLORS.warningText,
    lineHeight: 18,
  },
  balanceButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 4,
  },
  balanceButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  dangerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.errorText,
  },
  dangerButtonText: {
    color: COLORS.errorText,
    fontSize: 14,
    fontWeight: "700",
  },
  pendingChangeBanner: {
    backgroundColor: COLORS.warningBg,
    borderWidth: 1,
    borderColor: COLORS.warningText,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  pendingChangeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  pendingChangeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.warningText,
  },
  pendingChangeBody: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: "600",
  },
  pendingChangeSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 4,
  },
  checklistsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    marginBottom: 16,
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
  // Bath services card (deslanado/corte + nota de cobro post-servicio)
  bathServicesCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    gap: 12,
  },
  bathServicesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bathServicesIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  bathServicesTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  bathServicesChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bathServiceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  bathServiceChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },
  bathServicesNoteBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.infoBg,
    borderRadius: 10,
    padding: 10,
  },
  bathServicesNoteText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.infoText,
    lineHeight: 17,
    fontWeight: "600",
  },
  bathServicesCardPaid: {
    borderColor: COLORS.successText,
    backgroundColor: COLORS.successBg,
  },
  bathServicesPaidPill: {
    backgroundColor: COLORS.successText,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  bathServicesPaidPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.white,
    letterSpacing: 0.3,
  },
  bathServicesItemized: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  bathServicesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  bathServicesRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bathServicesRowLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  bathServicesRowValue: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  bathServicesTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  bathServicesTotalLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bathServicesTotalValue: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.successText,
  },
});
