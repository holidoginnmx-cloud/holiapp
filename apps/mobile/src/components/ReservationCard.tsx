import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ReservationCardProps {
  petName: string;
  roomName: string | null;
  status: string;
  checkIn?: string | Date | null;
  checkOut?: string | Date | null;
  reservationType?: "STAY" | "BATH";
  appointmentAt?: string | Date | null;
  totalAmount: number;
  ownerName?: string;
  staffName?: string | null;
  petCount?: number;
  paymentType?: string | null;
  hasPendingChangeRequest?: boolean;
  lastUpdateAt?: string | null;
  hasReview?: boolean;
  onPress?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  CHECKED_IN: { label: "Hospedado", bg: COLORS.successBg, text: COLORS.successText },
  CONFIRMED: { label: "Confirmada", bg: COLORS.infoBg, text: COLORS.infoText },
  PENDING: { label: "Pendiente", bg: COLORS.warningBg, text: COLORS.warningText },
  CHECKED_OUT: { label: "Concluida", bg: COLORS.bgSection, text: COLORS.textTertiary },
  CANCELLED: { label: "Cancelada", bg: COLORS.errorBg, text: COLORS.errorText },
};

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Justo ahora";
  if (diffMin < 60) return `Hace ${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Hace ${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  return `Hace ${diffDays}d`;
}

export function ReservationCard({
  petName,
  roomName,
  status,
  checkIn,
  checkOut,
  reservationType,
  appointmentAt,
  totalAmount,
  ownerName,
  staffName,
  petCount,
  paymentType,
  hasPendingChangeRequest,
  lastUpdateAt,
  hasReview,
  onPress,
}: ReservationCardProps) {
  const isBath = reservationType === "BATH";
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;

  const showDepositAlert =
    paymentType === "DEPOSIT" &&
    (status === "PENDING" || status === "CONFIRMED");
  const showChangeRequest = !!hasPendingChangeRequest;
  const showUpdatePreview = status === "CHECKED_IN" && !!lastUpdateAt;
  const showReviewCta = status === "CHECKED_OUT" && hasReview === false;
  const showPetCount = (petCount ?? 1) > 1;

  const hasIndicators =
    showDepositAlert || showChangeRequest || showUpdatePreview || showReviewCta || showPetCount;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.petName}>{petName}</Text>
        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <Text style={[styles.badgeText, { color: config.text }]}>
            {config.label}
          </Text>
        </View>
      </View>

      {ownerName && <Text style={styles.room}>{ownerName}</Text>}
      {roomName && <Text style={styles.room}>{roomName}</Text>}
      {staffName !== undefined && (
        <View style={styles.staffRow}>
          <Ionicons
            name="person-outline"
            size={13}
            color={staffName ? COLORS.primary : COLORS.textDisabled}
          />
          <Text
            style={[
              styles.staffText,
              !staffName && styles.staffTextUnassigned,
            ]}
          >
            {staffName ?? "Sin staff asignado"}
          </Text>
        </View>
      )}

      {hasIndicators && (
        <View style={styles.indicatorsRow}>
          {showDepositAlert && (
            <View style={styles.indicatorBadge}>
              <Ionicons name="alert-circle" size={13} color={COLORS.warningText} />
              <Text style={styles.indicatorText}>Saldo pendiente</Text>
            </View>
          )}
          {showChangeRequest && (
            <View style={[styles.indicatorBadge, { backgroundColor: COLORS.infoBg }]}>
              <Ionicons name="time" size={13} color={COLORS.infoText} />
              <Text style={[styles.indicatorText, { color: COLORS.infoText }]}>
                Cambio pendiente
              </Text>
            </View>
          )}
          {showUpdatePreview && (
            <View style={[styles.indicatorBadge, { backgroundColor: COLORS.successBg }]}>
              <Ionicons name="camera" size={13} color={COLORS.successText} />
              <Text style={[styles.indicatorText, { color: COLORS.successText }]}>
                {formatRelativeTime(lastUpdateAt!)}
              </Text>
            </View>
          )}
          {showReviewCta && (
            <View style={[styles.indicatorBadge, { backgroundColor: "#FEF3C7" }]}>
              <Ionicons name="star-outline" size={13} color={COLORS.star} />
              <Text style={[styles.indicatorText, { color: COLORS.star }]}>
                Deja tu reseña
              </Text>
            </View>
          )}
          {showPetCount && (
            <View style={[styles.indicatorBadge, { backgroundColor: COLORS.primaryLight }]}>
              <Ionicons name="paw" size={13} color={COLORS.primary} />
              <Text style={[styles.indicatorText, { color: COLORS.primary }]}>
                {petCount} peludos
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.details}>
        {isBath && appointmentAt ? (
          <>
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>🛁 Baño</Text>
              <Text style={styles.dateValue}>{formatDate(appointmentAt)}</Text>
            </View>
            <View style={styles.dateSeparator} />
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Hora</Text>
              <Text style={styles.dateValue}>
                {new Date(appointmentAt).toLocaleTimeString("es-MX", {
                  timeZone: "America/Hermosillo",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Entrada</Text>
              <Text style={styles.dateValue}>
                {checkIn ? formatDate(checkIn) : "—"}
              </Text>
            </View>
            <View style={styles.dateSeparator} />
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Salida</Text>
              <Text style={styles.dateValue}>
                {checkOut ? formatDate(checkOut) : "—"}
              </Text>
            </View>
          </>
        )}
        <View style={styles.amountContainer}>
          <Text style={styles.amount}>${Number(totalAmount).toLocaleString()}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  petName: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  room: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 4,
  },
  staffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  staffText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
  },
  staffTextUnassigned: {
    color: COLORS.textDisabled,
    fontStyle: "italic",
    fontWeight: "500",
  },
  indicatorsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  indicatorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.warningBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  indicatorText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.warningText,
  },
  details: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  dateRow: {
    alignItems: "center",
  },
  dateLabel: {
    fontSize: 11,
    color: COLORS.textDisabled,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  dateValue: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: "600",
    marginTop: 2,
  },
  dateSeparator: {
    width: 24,
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: 12,
  },
  amountContainer: {
    flex: 1,
    alignItems: "flex-end",
  },
  amount: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.primary,
  },
});
