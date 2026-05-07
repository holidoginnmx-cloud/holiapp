import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatName } from "@/lib/format";

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
  hasBalance?: boolean;
  hasPendingChangeRequest?: boolean;
  lastUpdateAt?: string | null;
  hasReview?: boolean;
  onPress?: () => void;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; accent: string }
> = {
  CHECKED_IN: {
    label: "Hospedado",
    bg: COLORS.successBg,
    text: COLORS.successText,
    accent: COLORS.successText,
  },
  CONFIRMED: {
    label: "Confirmada",
    bg: COLORS.infoBg,
    text: COLORS.infoText,
    accent: COLORS.infoText,
  },
  PENDING: {
    label: "Pendiente",
    bg: COLORS.warningBg,
    text: COLORS.warningText,
    accent: COLORS.warningText,
  },
  CHECKED_OUT: {
    label: "Concluida",
    bg: COLORS.bgSection,
    text: COLORS.textTertiary,
    accent: COLORS.border,
  },
  CANCELLED: {
    label: "Cancelada",
    bg: COLORS.errorBg,
    text: COLORS.errorText,
    accent: COLORS.errorText,
  },
};

function formatDayShort(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function formatWeekday(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-MX", {
    weekday: "short",
  });
}

function nightsBetween(
  checkIn: string | Date,
  checkOut: string | Date
): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
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
  hasBalance,
  hasPendingChangeRequest,
  lastUpdateAt,
  hasReview,
  onPress,
}: ReservationCardProps) {
  const isBath = reservationType === "BATH";
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;

  const showDepositAlert =
    !!hasBalance &&
    paymentType === "DEPOSIT" &&
    (status === "PENDING" || status === "CONFIRMED");
  const showChangeRequest = !!hasPendingChangeRequest;
  const showUpdatePreview = status === "CHECKED_IN" && !!lastUpdateAt;
  const showReviewCta = status === "CHECKED_OUT" && hasReview === false;
  const showPetCount = (petCount ?? 1) > 1;

  const hasIndicators =
    showDepositAlert ||
    showChangeRequest ||
    showUpdatePreview ||
    showReviewCta ||
    showPetCount;

  const nights =
    !isBath && checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.accentBar, { backgroundColor: config.accent }]} />

      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.titleWrap}>
            <View style={styles.petIconWrap}>
              <Ionicons name="paw" size={14} color={COLORS.primary} />
            </View>
            <Text style={styles.petName} numberOfLines={1}>
              {formatName(petName)}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: config.bg }]}>
            <Text style={[styles.badgeText, { color: config.text }]}>
              {config.label}
            </Text>
          </View>
        </View>

        {(roomName || ownerName) && (
          <View style={styles.subtitleRow}>
            {roomName && (
              <View style={styles.subtitleItem}>
                <Ionicons
                  name="bed-outline"
                  size={13}
                  color={COLORS.textTertiary}
                />
                <Text style={styles.subtitleText} numberOfLines={1}>
                  {roomName}
                </Text>
              </View>
            )}
            {ownerName && (
              <View style={styles.subtitleItem}>
                <Ionicons
                  name="person-outline"
                  size={13}
                  color={COLORS.textTertiary}
                />
                <Text style={styles.subtitleText} numberOfLines={1}>
                  {formatName(ownerName)}
                </Text>
              </View>
            )}
          </View>
        )}

        {staffName !== undefined && (
          <View style={styles.staffRow}>
            <Ionicons
              name="ribbon-outline"
              size={13}
              color={staffName ? COLORS.primary : COLORS.textDisabled}
            />
            <Text
              style={[
                styles.staffText,
                !staffName && styles.staffTextUnassigned,
              ]}
            >
              {staffName ? formatName(staffName) : "Sin staff asignado"}
            </Text>
          </View>
        )}

        {hasIndicators && (
          <View style={styles.indicatorsRow}>
            {showDepositAlert && (
              <View style={styles.indicatorBadge}>
                <Ionicons
                  name="alert-circle"
                  size={13}
                  color={COLORS.warningText}
                />
                <Text style={styles.indicatorText}>Saldo pendiente</Text>
              </View>
            )}
            {showChangeRequest && (
              <View
                style={[styles.indicatorBadge, { backgroundColor: COLORS.infoBg }]}
              >
                <Ionicons name="time" size={13} color={COLORS.infoText} />
                <Text style={[styles.indicatorText, { color: COLORS.infoText }]}>
                  Cambio pendiente
                </Text>
              </View>
            )}
            {showUpdatePreview && (
              <View
                style={[
                  styles.indicatorBadge,
                  { backgroundColor: COLORS.successBg },
                ]}
              >
                <Ionicons name="camera" size={13} color={COLORS.successText} />
                <Text
                  style={[styles.indicatorText, { color: COLORS.successText }]}
                >
                  {formatRelativeTime(lastUpdateAt!)}
                </Text>
              </View>
            )}
            {showReviewCta && (
              <View
                style={[styles.indicatorBadge, { backgroundColor: "#FEF3C7" }]}
              >
                <Ionicons name="star-outline" size={13} color={COLORS.star} />
                <Text style={[styles.indicatorText, { color: COLORS.star }]}>
                  Deja tu reseña
                </Text>
              </View>
            )}
            {showPetCount && (
              <View
                style={[
                  styles.indicatorBadge,
                  { backgroundColor: COLORS.primaryLight },
                ]}
              >
                <Ionicons name="paw" size={13} color={COLORS.primary} />
                <Text style={[styles.indicatorText, { color: COLORS.primary }]}>
                  {petCount} peludos
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Date hero */}
        {isBath && appointmentAt ? (
          <View style={styles.bathHero}>
            <View style={styles.bathBadge}>
              <Ionicons name="water" size={14} color={COLORS.primary} />
              <Text style={styles.bathBadgeText}>Baño</Text>
            </View>
            <View style={styles.bathInfoRow}>
              <Text style={styles.bathDay}>{formatDayShort(appointmentAt)}</Text>
              <Text style={styles.bathTime}>
                {new Date(appointmentAt).toLocaleTimeString("es-MX", {
                  timeZone: "America/Hermosillo",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          </View>
        ) : checkIn && checkOut ? (
          <View style={styles.dateHero}>
            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>ENTRADA</Text>
              <Text style={styles.datePillDay}>{formatDayShort(checkIn)}</Text>
              <Text style={styles.datePillSub}>{formatWeekday(checkIn)}</Text>
            </View>

            <View style={styles.dateConnector}>
              <View style={styles.connectorLine} />
              {nights !== null && (
                <View style={styles.nightsBadge}>
                  <Ionicons name="moon" size={11} color={COLORS.primary} />
                  <Text style={styles.nightsBadgeText}>
                    {nights} {nights === 1 ? "noche" : "noches"}
                  </Text>
                </View>
              )}
              <View style={styles.connectorLine} />
            </View>

            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>SALIDA</Text>
              <Text style={styles.datePillDay}>{formatDayShort(checkOut)}</Text>
              <Text style={styles.datePillSub}>{formatWeekday(checkOut)}</Text>
            </View>
          </View>
        ) : null}

        {/* Total footer */}
        <View style={styles.totalFooter}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>
            ${Number(totalAmount).toLocaleString("es-MX")}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  accentBar: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  titleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  petIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  subtitleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  subtitleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  subtitleText: {
    fontSize: 13,
    color: COLORS.textTertiary,
    fontWeight: "600",
    flexShrink: 1,
  },
  staffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  staffText: {
    fontSize: 12,
    fontWeight: "700",
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
    borderRadius: 999,
  },
  indicatorText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.warningText,
  },
  // Date hero
  dateHero: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    marginTop: 12,
  },
  datePill: {
    flex: 1,
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  datePillLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  datePillDay: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  datePillSub: {
    fontSize: 10,
    color: COLORS.textTertiary,
    textTransform: "capitalize",
    marginTop: 1,
  },
  dateConnector: {
    alignItems: "center",
    justifyContent: "center",
  },
  connectorLine: {
    flex: 1,
    width: 1,
    backgroundColor: COLORS.borderLight,
    minHeight: 6,
  },
  nightsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    marginVertical: 3,
  },
  nightsBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.primary,
  },
  // Bath hero
  bathHero: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
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
    gap: 8,
  },
  bathDay: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  bathTime: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  // Total footer
  totalFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    marginTop: 12,
    paddingTop: 10,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.primary,
  },
});
