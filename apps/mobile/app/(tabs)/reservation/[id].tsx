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
  Modal,
  Image,
  Pressable,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStripe } from "@stripe/stripe-react-native";
import {
  getReservationById,
  getReservations,
  getStayUpdates,
  getCreditLedger,
  createBalancePayment,
  confirmBalancePayment,
} from "@/lib/api";
import { StayUpdateCard } from "@/components/StayUpdateCard";
import { BathUpsellCard } from "@/components/BathUpsellCard";
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
  PENDING: { label: "Pendiente", bg: COLORS.warningBg, text: COLORS.warningText },
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, text: COLORS.infoText },
  CHECKED_IN: { label: "En estancia", bg: COLORS.successBg, text: COLORS.successText },
  CHECKED_OUT: { label: "Concluida", bg: COLORS.bgSection, text: COLORS.textTertiary },
  CANCELLED: { label: "Cancelada", bg: COLORS.errorBg, text: COLORS.errorText },
};

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  UNPAID: { label: "Sin pagar", color: COLORS.errorText },
  PARTIAL: { label: "Anticipo", color: COLORS.warningText },
  PAID: { label: "Pagado", color: COLORS.successText },
  REFUNDED: { label: "Reembolsado", color: COLORS.textTertiary },
};

export default function ReservationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [payingBalance, setPayingBalance] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewPrompted, setReviewPrompted] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

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

  const { data: updates } = useQuery({
    queryKey: ["stay-updates", id],
    queryFn: () => getStayUpdates(id!),
    enabled: !!reservation,
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
    enabled: !!reservation,
  });
  const pendingChange: ChangeRequest | undefined = changeRequests?.find(
    (c) => c.status === "PENDING"
  );
  const canModify =
    reservation &&
    reservation.reservationType !== "BATH" &&
    ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(reservation.status) &&
    !pendingChange;
  const canCancel =
    reservation && ["PENDING", "CONFIRMED"].includes(reservation.status);
  const paidStripeAmount = reservation?.payments
    ?.filter((p: any) => p.status === "PAID" && p.stripePaymentIntentId)
    .reduce((s: number, p: any) => s + Number(p.amount), 0) ?? 0;
  const totalPaidForCancel = reservation?.payments
    ?.filter((p: any) => p.status === "PAID")
    .reduce((s: number, p: any) => s + Number(p.amount), 0) ?? 0;

  // Balance payment logic
  const isDeposit = reservation?.paymentType === "DEPOSIT";
  const totalPaid = reservation?.payments
    ?.filter((p: any) => p.status === "PAID")
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

      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "HolidogInn",
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

  return (
    <>
      {reservationRefund > 0 && (
        <Stack.Screen
          options={{
            headerRight: () => (
              <TouchableOpacity
                onPress={() => router.push("/profile/credit-history" as any)}
                style={styles.refundPill}
                activeOpacity={0.85}
                hitSlop={8}
                testID="reservation-refund-pill"
              >
                <Ionicons name="wallet" size={13} color={COLORS.successText} />
                <Text style={styles.refundPillText}>
                  +${reservationRefund.toLocaleString("es-MX")}
                </Text>
              </TouchableOpacity>
            ),
          }}
        />
      )}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
        <Text style={styles.petName}>
          {groupedReservations
            ? groupedReservations.map((r: any) => r.pet.name).join(", ")
            : reservation.pet?.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: statusConfig.bg }]}>
          <Text style={[styles.badgeText, { color: statusConfig.text }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>

      {/* Mascotas del grupo */}
      {groupedReservations && groupedReservations.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mascotas</Text>
          {groupedReservations.map((r: any) => (
            <View key={r.id} style={styles.groupPetRow}>
              <Ionicons name="paw" size={16} color={COLORS.primary} />
              <Text style={styles.groupPetName}>{r.pet.name}</Text>
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
        {!groupedReservations && reservation.pet?.breed && (
          <InfoRow
            icon="paw-outline"
            label="Raza"
            value={reservation.pet.breed}
          />
        )}
        {reservation.reservationType === "BATH" ? (
          <>
            <InfoRow icon="water-outline" label="Tipo" value="Cita de baño" />
            {reservation.appointmentAt && (
              <>
                <InfoRow
                  icon="calendar-outline"
                  label="Fecha"
                  value={new Date(reservation.appointmentAt).toLocaleDateString("es-MX", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                />
                <InfoRow
                  icon="time-outline"
                  label="Hora"
                  value={new Date(reservation.appointmentAt).toLocaleTimeString("es-MX", {
                    timeZone: "America/Hermosillo",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                />
              </>
            )}
          </>
        ) : (
          <>
            {reservation.checkIn && (
              <InfoRow
                icon="calendar-outline"
                label="Check-in"
                value={new Date(reservation.checkIn).toLocaleDateString("es-MX", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              />
            )}
            {reservation.checkOut && (
              <InfoRow
                icon="calendar-outline"
                label="Check-out"
                value={new Date(reservation.checkOut).toLocaleDateString("es-MX", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              />
            )}
            {reservation.room ? (
              <InfoRow
                icon="bed-outline"
                label="Habitación"
                value={reservation.room.name}
              />
            ) : (
              <InfoRow
                icon="bed-outline"
                label="Habitación"
                value="Por asignar"
              />
            )}
            {reservation.totalDays != null && (
              <InfoRow
                icon="moon-outline"
                label="Noches"
                value={`${reservation.totalDays}`}
              />
            )}
          </>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            ${Number(reservation.totalAmount).toLocaleString("es-MX")}
          </Text>
        </View>
      </View>

      {/* Payment status */}
      {reservation.payments && reservation.payments.length > 0 && (
        <View style={styles.card}>
          {reservation.payments.map((p, idx) => {
            const pConfig = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.UNPAID;
            return (
              <View key={p.id} style={styles.paymentRow}>
                {idx === 0 ? (
                  <Text style={styles.cardTitle}>Pagos</Text>
                ) : (
                  <View />
                )}
                <View style={styles.paymentRight}>
                  <Text style={styles.paymentAmount}>
                    ${Number(p.amount).toLocaleString("es-MX")}
                  </Text>
                  <View
                    style={[
                      styles.paymentBadge,
                      { backgroundColor: `${pConfig.color}15` },
                    ]}
                  >
                    <Text
                      style={[styles.paymentBadgeText, { color: pConfig.color }]}
                    >
                      {pConfig.label}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
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

      {(canModify || canCancel) && (
        <View style={styles.actionsRow}>
          {canModify && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push(`/reservation/modify/${reservation.id}` as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
              <Text style={styles.secondaryButtonText}>Modificar fechas</Text>
            </TouchableOpacity>
          )}
          {canCancel && (
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={() => setCancelModalOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={18} color={COLORS.errorText} />
              <Text style={styles.dangerButtonText}>Cancelar</Text>
            </TouchableOpacity>
          )}
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
          {isDeposit && reservation.depositDeadline && (
            <>
              <Text style={styles.balanceBannerDeadline}>
                Fecha límite: {new Date(reservation.depositDeadline).toLocaleDateString("es-MX", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              <Text style={styles.balanceBannerWarning}>
                Si no liquidas antes de la fecha límite, tu reservación será cancelada automáticamente.
              </Text>
            </>
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

      {/* Bath upsell (CONFIRMED → CHECKED_IN) */}
      <BathUpsellCard reservation={reservation} />

      {/* Photos / Videos */}
      {updates && updates.length > 0 && (
        <View>
          <Text style={styles.sectionTitle}>
            Fotos y videos ({updates.length})
          </Text>
          <View style={styles.photosGrid}>
            {updates.map((u, idx) => (
              <TouchableOpacity
                key={u.id}
                style={styles.photoWrapper}
                onPress={() => setViewerIndex(idx)}
                activeOpacity={0.85}
              >
                <StayUpdateCard
                  mediaUrl={u.mediaUrl}
                  caption={u.caption}
                  createdAt={u.createdAt}
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Review CTA or existing review */}
      {reservation.status === "CHECKED_OUT" && (
        <View style={{ marginTop: 8 }}>
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

      <ReviewPromptModal
        visible={reviewModalOpen}
        reservationId={reservation.id}
        onDismiss={() => setReviewModalOpen(false)}
      />

      <CancelReservationModal
        visible={cancelModalOpen}
        reservationId={reservation.id}
        petName={reservation.pet?.name ?? ""}
        refundAmount={totalPaidForCancel}
        allowStripeRefund={paidStripeAmount > 0}
        onClose={() => setCancelModalOpen(false)}
      />
      </ScrollView>

      {viewerIndex !== null && updates && updates[viewerIndex] && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setViewerIndex(null)}
          statusBarTranslucent
        >
          <Pressable
            style={styles.viewerBackdrop}
            onPress={() => setViewerIndex(null)}
          >
            <TouchableOpacity
              style={styles.viewerClose}
              onPress={() => setViewerIndex(null)}
              activeOpacity={0.7}
              hitSlop={12}
            >
              <Ionicons name="close" size={28} color={COLORS.white} />
            </TouchableOpacity>
            <Image
              source={{ uri: updates[viewerIndex].mediaUrl }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
            {updates[viewerIndex].caption && (
              <View style={styles.viewerCaptionWrap} pointerEvents="none">
                <Text style={styles.viewerCaption}>
                  {updates[viewerIndex].caption}
                </Text>
              </View>
            )}
          </Pressable>
        </Modal>
      )}
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
  },
  petName: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary },
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
    shadowRadius: 6,
    elevation: 2,
    gap: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoLabel: { fontSize: 14, color: COLORS.textTertiary },
  infoValue: { fontSize: 14, fontWeight: "600", color: COLORS.textPrimary },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary },
  totalValue: { fontSize: 20, fontWeight: "800", color: COLORS.primary },
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
  paymentAmount: { fontSize: 15, fontWeight: "600", color: COLORS.textPrimary },
  paymentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  paymentBadgeText: { fontSize: 12, fontWeight: "700" },
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
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    justifyContent: "center",
    alignItems: "center",
  },
  viewerClose: {
    position: "absolute",
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  viewerImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.85,
  },
  viewerCaptionWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 50,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  viewerCaption: {
    color: COLORS.white,
    fontSize: 14,
    lineHeight: 20,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
    marginTop: 8,
  },
  photosGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  photoWrapper: { width: "48%" },
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
});
