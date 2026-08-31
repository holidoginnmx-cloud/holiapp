import { memo } from "react";
import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  formatName,
  formatCurrency,
  formatDayShort,
  formatWeekdayShort,
  formatTime,
  formatTimeHHmm,
} from "@/lib/format";
import { PawRating } from "./PawRating";

interface ReservationCardProps {
  petName: string;
  roomName: string | null;
  status: string;
  checkIn?: string | Date | null;
  checkOut?: string | Date | null;
  reservationType?: "STAY" | "BATH" | "DAYCARE";
  appointmentAt?: string | Date | null;
  /** Guardería: horas estimadas de entrada/salida ("HH:mm"). */
  checkInTime?: string | null;
  checkOutTime?: string | null;
  /** Hospedaje que incluye un baño (servicio en el checkout). */
  hasBath?: boolean;
  totalAmount: number;
  ownerName?: string;
  /** Perro compartido: quién hizo esta reserva, si no fue quien está viendo. */
  bookedByName?: string | null;
  staffName?: string | null;
  petCount?: number;
  paymentType?: string | null;
  hasBalance?: boolean;
  hasPendingChangeRequest?: boolean;
  lastUpdateAt?: string | null;
  hasReview?: boolean;
  reviewRating?: number | null;
  /** Si true, el card cambia la copy de "Deja tu reseña" por "Aún sin reseña"
   * (vista admin/staff donde no se puede dejar reseña). */
  adminView?: boolean;
  hasDeslanado?: boolean;
  hasCorte?: boolean;
  /** Baño ya ejecutado al que le falta el cobro: se pinta en ámbar. */
  bathReady?: boolean;
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

// Etiqueta amigable basada en la fecha (futuro). Devuelve null si ya pasó.
function futureLabel(date: string | Date): string | null {
  const target = new Date(date);
  const today = new Date();
  // Comparar a medianoche local para evitar saltos por la hora.
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (diffDays < 0) return null;
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Mañana";
  if (diffDays <= 14) return `En ${diffDays} días`;
  return null;
}

function ReservationCardBase({
  petName,
  roomName,
  status,
  checkIn,
  checkOut,
  reservationType,
  appointmentAt,
  checkInTime,
  checkOutTime,
  hasBath,
  totalAmount,
  ownerName,
  bookedByName,
  staffName,
  petCount,
  paymentType,
  hasBalance,
  hasPendingChangeRequest,
  lastUpdateAt,
  hasReview,
  reviewRating,
  adminView,
  hasDeslanado,
  hasCorte,
  bathReady,
  onPress,
}: ReservationCardProps) {
  const isBath = reservationType === "BATH";
  const isDaycare = reservationType === "DAYCARE";
  const baseConfig = STATUS_CONFIG[status] || STATUS_CONFIG.CONFIRMED;
  // Un baño ya hecho al que solo le falta el cobro se queda en CONFIRMED a
  // propósito (para poder cobrarlo al entregar), y así se veía idéntico a uno
  // que ni ha empezado. Se distingue en ámbar.
  const showBathReady =
    !!bathReady && status !== "CHECKED_OUT" && status !== "CANCELLED";
  const config = showBathReady
    ? {
        label: "Baño listo · por cobrar",
        bg: COLORS.warningBg,
        text: COLORS.warningText,
        accent: COLORS.warningText,
      }
    : baseConfig;

  const showDepositAlert =
    !!hasBalance &&
    paymentType === "DEPOSIT" &&
    status === "CONFIRMED";
  const showChangeRequest = !!hasPendingChangeRequest;
  const showUpdatePreview = status === "CHECKED_IN" && !!lastUpdateAt;
  const showReviewCta = status === "CHECKED_OUT" && hasReview === false;
  const showReviewRating =
    status === "CHECKED_OUT" &&
    hasReview === true &&
    typeof reviewRating === "number" &&
    reviewRating > 0;
  const showPetCount = (petCount ?? 1) > 1;

  const hasIndicators =
    showDepositAlert ||
    showChangeRequest ||
    showUpdatePreview ||
    showReviewCta ||
    showReviewRating ||
    showPetCount;

  const nights =
    !isBath && checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View
        style={[
          styles.accentBar,
          {
            // Baño/guardería activo o agendado → naranja (identidad de servicio
            // de día). Concluido → gris apagado, igual que un hospedaje finalizado.
            // Baño hecho pendiente de cobro → ámbar, para que salte a la vista.
            backgroundColor: showBathReady
              ? COLORS.warningText
              : (isBath || isDaycare) && status !== "CHECKED_OUT"
                ? COLORS.primary
                : config.accent,
          },
        ]}
      />

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
          <View style={styles.headerRight}>
            {!isBath && hasBath && (
              <View style={styles.bathTag}>
                <Ionicons name="water" size={11} color={COLORS.infoText} />
                <Text style={styles.bathTagText}>Baño</Text>
              </View>
            )}
            <View style={[styles.badge, { backgroundColor: config.bg }]}>
              <Text style={[styles.badgeText, { color: config.text }]}>
                {config.label}
              </Text>
            </View>
          </View>
        </View>

        {(roomName || ownerName || bookedByName) && (
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
            {bookedByName && (
              <View style={styles.subtitleItem}>
                <Ionicons
                  name="people-outline"
                  size={13}
                  color={COLORS.textTertiary}
                />
                <Text style={styles.subtitleText} numberOfLines={1}>
                  Reservó {formatName(bookedByName)}
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
                style={[
                  styles.indicatorBadge,
                  {
                    backgroundColor: adminView ? COLORS.bgSection : "#FEF3C7",
                  },
                ]}
              >
                <Ionicons
                  name="paw-outline"
                  size={13}
                  color={adminView ? COLORS.textTertiary : COLORS.star}
                />
                <Text
                  style={[
                    styles.indicatorText,
                    {
                      color: adminView ? COLORS.textTertiary : COLORS.star,
                    },
                  ]}
                >
                  {adminView ? "Aún sin reseña" : "Deja tu reseña"}
                </Text>
              </View>
            )}
            {showReviewRating && (
              <View
                style={[
                  styles.indicatorBadge,
                  { backgroundColor: COLORS.primaryLight, gap: 3 },
                ]}
              >
                <PawRating
                  value={reviewRating!}
                  size={12}
                  gap={3}
                  emptyColor={COLORS.textDisabled}
                />
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
        {isDaycare && appointmentAt ? (
          <View style={styles.bathHero}>
            <View style={styles.bathBadge}>
              <Ionicons name="sunny" size={14} color={COLORS.primary} />
              <Text style={styles.bathBadgeText}>Guardería</Text>
            </View>
            <View style={styles.bathInfoRow}>
              <Text style={styles.bathDay}>{formatDayShort(appointmentAt)}</Text>
              {checkInTime && checkOutTime && (
                <Text style={styles.bathTime}>
                  {checkInTime}–{checkOutTime}
                </Text>
              )}
            </View>
          </View>
        ) : isBath && appointmentAt ? (
          <>
            <View style={styles.bathHero}>
              <View style={styles.bathBadge}>
                <Ionicons name="water" size={14} color={COLORS.primary} />
                <Text style={styles.bathBadgeText}>Baño</Text>
              </View>
              <View style={styles.bathInfoRow}>
                <Text style={styles.bathDay}>
                  {formatDayShort(appointmentAt)}
                </Text>
                <Text style={styles.bathTime}>
                  {formatTime(appointmentAt)}
                </Text>
              </View>
            </View>
            {(() => {
              const when =
                status === "CONFIRMED" ? futureLabel(appointmentAt) : null;
              const showExtras = hasDeslanado || hasCorte;
              if (!when && !showExtras) return null;
              return (
                <View style={styles.bathExtrasRow}>
                  {when && (
                    <View style={styles.bathExtraChipWhen}>
                      <Ionicons
                        name="time-outline"
                        size={12}
                        color={COLORS.infoText}
                      />
                      <Text style={styles.bathExtraChipWhenText}>{when}</Text>
                    </View>
                  )}
                  {hasDeslanado && (
                    <View style={styles.bathExtraChip}>
                      <Ionicons name="cut-outline" size={12} color={COLORS.primary} />
                      <Text style={styles.bathExtraChipText}>Deslanado</Text>
                    </View>
                  )}
                  {hasCorte && (
                    <View style={styles.bathExtraChip}>
                      <Ionicons name="cut" size={12} color={COLORS.primary} />
                      <Text style={styles.bathExtraChipText}>Corte</Text>
                    </View>
                  )}
                </View>
              );
            })()}
          </>
        ) : checkIn && checkOut ? (
          <View style={styles.dateHero}>
            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>ENTRADA</Text>
              {/* Fechas de estadía: día-calendario anclado a UTC (igual que el
                  detalle); sin timeZone, medianoche UTC retrocede un día en
                  Hermosillo — la card mostraba la salida vieja tras editarla. */}
              <Text style={styles.datePillDay}>{formatDayShort(checkIn, { timeZone: "UTC" })}</Text>
              <Text style={styles.datePillSub}>{formatWeekdayShort(checkIn, { timeZone: "UTC" })}</Text>
              {/* La hora también en hospedaje: hasta ahora solo se pintaba en
                  guardería, y es justo lo que el equipo busca al abrir el
                  calendario del día. */}
              {checkInTime && (
                <Text style={styles.datePillTime}>{formatTimeHHmm(checkInTime)}</Text>
              )}
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
              <Text style={styles.datePillDay}>{formatDayShort(checkOut, { timeZone: "UTC" })}</Text>
              <Text style={styles.datePillSub}>{formatWeekdayShort(checkOut, { timeZone: "UTC" })}</Text>
              {checkOutTime && (
                <Text style={styles.datePillTime}>{formatTimeHHmm(checkOutTime)}</Text>
              )}
            </View>
          </View>
        ) : null}

        {/* Total footer */}
        <View style={styles.totalFooter}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>
            {formatCurrency(totalAmount)}
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bathTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.infoBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bathTagText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.infoText,
    letterSpacing: 0.3,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_600SemiBold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  staffTextUnassigned: {
    color: COLORS.textDisabled,
    fontStyle: "italic",
    fontFamily: "PlusJakartaSans_500Medium",
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
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  datePillDay: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  datePillSub: {
    fontSize: 10,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textTransform: "capitalize",
    marginTop: 1,
  },
  datePillTime: {
    fontSize: 10,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
    marginTop: 2,
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
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  bathInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bathDay: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  bathTime: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  bathExtrasRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  bathExtraChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bathExtraChipText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  bathExtraChipWhen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.infoBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bathExtraChipWhenText: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.infoText,
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalAmount: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
});

// Memoizado: es un ítem de lista que se renderiza muchas veces; evita
// re-renders cuando sus props no cambian (combinar con onPress estable en el
// consumidor para máximo efecto).
export const ReservationCard = memo(ReservationCardBase);
