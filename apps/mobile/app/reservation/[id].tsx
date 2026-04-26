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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStripe } from "@stripe/stripe-react-native";
import {
  getReservationById,
  getStayUpdates,
  createBalancePayment,
  confirmBalancePayment,
} from "@/lib/api";
import { StayUpdateCard } from "@/components/StayUpdateCard";
import { BathUpsellCard } from "@/components/BathUpsellCard";
import { ReviewPromptModal } from "@/components/ReviewPromptModal";

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
  CHECKED_OUT: { label: "Finalizada", bg: COLORS.bgSection, text: COLORS.textTertiary },
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

  console.log("📋 [ReservationDetail] MOUNTED with id:", id);

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

  const { data: updates } = useQuery({
    queryKey: ["stay-updates", id],
    queryFn: () => getStayUpdates(id!),
    enabled: !!reservation,
    refetchInterval: 30_000,
  });

  // Balance payment logic
  const isDeposit = reservation?.paymentType === "DEPOSIT";
  const totalPaid = reservation?.payments
    ?.filter((p: any) => p.status === "PAID")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0) ?? 0;
  const remainingBalance = reservation
    ? Number(reservation.totalAmount) - totalPaid
    : 0;
  const hasBalance = isDeposit && remainingBalance > 0 && reservation?.status !== "CANCELLED";
  const deadlinePassed = reservation?.depositDeadline
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
      Alert.alert("Pago completado", "Tu saldo ha sido liquidado exitosamente.");
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.petName}>{reservation.pet?.name}</Text>
        <View style={[styles.badge, { backgroundColor: statusConfig.bg }]}>
          <Text style={[styles.badgeText, { color: statusConfig.text }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>

      {/* PENDING banner */}
      {reservation.status === "PENDING" && (
        <View style={styles.pendingBanner}>
          <Ionicons name="time-outline" size={20} color={COLORS.warningText} />
          <View style={styles.pendingBannerText}>
            <Text style={styles.pendingBannerTitle}>Pendiente de confirmación</Text>
            <Text style={styles.pendingBannerBody}>
              Tu reservación está en revisión. Te notificaremos cuando sea confirmada por el equipo HDI.
            </Text>
          </View>
        </View>
      )}

      {/* Info card */}
      <View style={styles.card}>
        {reservation.pet?.breed && (
          <InfoRow
            icon="paw-outline"
            label="Raza"
            value={reservation.pet.breed}
          />
        )}
        {reservation.reservationType === "BATH" ? (
          <>
            <InfoRow
              icon="water-outline"
              label="Tipo"
              value="Cita de baño"
            />
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
          <Text style={styles.cardTitle}>Pagos</Text>
          {reservation.payments.map((p) => {
            const pConfig = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.UNPAID;
            return (
              <View key={p.id} style={styles.paymentRow}>
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
            );
          })}
        </View>
      )}

      {/* Deposit balance banner */}
      {hasBalance && !deadlinePassed && (
        <View style={styles.balanceBanner}>
          <View style={styles.balanceBannerHeader}>
            <Ionicons name="warning-outline" size={20} color={COLORS.warningText} />
            <Text style={styles.balanceBannerTitle}>Saldo pendiente</Text>
          </View>
          <Text style={styles.balanceBannerAmount}>
            ${remainingBalance.toLocaleString("es-MX")} MXN
          </Text>
          {reservation.depositDeadline && (
            <Text style={styles.balanceBannerDeadline}>
              Fecha límite: {new Date(reservation.depositDeadline).toLocaleDateString("es-MX", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          )}
          <Text style={styles.balanceBannerWarning}>
            Si no liquidas antes de la fecha límite, tu reservación será cancelada automáticamente.
          </Text>
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
            {updates.map((u) => (
              <View key={u.id} style={styles.photoWrapper}>
                <StayUpdateCard
                  mediaUrl={u.mediaUrl}
                  caption={u.caption}
                  createdAt={u.createdAt}
                />
              </View>
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
    </ScrollView>
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
  },
  paymentAmount: { fontSize: 15, fontWeight: "600", color: COLORS.textPrimary },
  paymentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  paymentBadgeText: { fontSize: 12, fontWeight: "700" },
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
});
