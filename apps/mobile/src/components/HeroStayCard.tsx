import { COLORS } from "@/constants/colors";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getStayUpdates } from "@/lib/api";
import { formatName, formatDayShort, formatWeekdayShort } from "@/lib/format";
import { cloudinaryResized } from "@/lib/cloudinary";

interface HeroStayCardProps {
  reservationId: string;
  petName: string;
  petPhotoUrl: string | null;
  roomName: string | null;
  checkIn?: string | Date | null;
  checkOut?: string | Date | null;
  onPress: () => void;
}

function timeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Justo ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function stayProgress(
  checkIn: string | Date,
  checkOut: string | Date,
): { current: number; total: number } | null {
  const ci = startOfDay(new Date(checkIn));
  const co = startOfDay(new Date(checkOut));
  const total = Math.max(
    1,
    Math.round((co.getTime() - ci.getTime()) / 86_400_000),
  );
  const today = startOfDay(new Date());
  const elapsed = Math.round((today.getTime() - ci.getTime()) / 86_400_000);
  const current = Math.min(Math.max(1, elapsed + 1), total);
  return { current, total };
}

export function HeroStayCard({
  reservationId,
  petName,
  petPhotoUrl,
  roomName,
  checkIn,
  checkOut,
  onPress,
}: HeroStayCardProps) {
  const { data: updates } = useQuery({
    queryKey: ["stay-updates", reservationId],
    queryFn: () => getStayUpdates(reservationId),
  });
  const latest = updates?.[0];
  // Si hay reporte, mostramos la última foto subida; si no, la foto de la
  // mascota como antes. La estructura del card no cambia.
  const photoUrl = latest?.mediaUrl ?? petPhotoUrl;
  const isVideo = latest?.mediaType === "video";
  const progress =
    checkIn && checkOut ? stayProgress(checkIn, checkOut) : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View style={styles.accentBar} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.photoRing}>
            {photoUrl ? (
              <Image
                source={{ uri: cloudinaryResized(photoUrl, 168, "fill") }}
                style={styles.photo}
              />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Ionicons name="paw" size={26} color={COLORS.primary} />
              </View>
            )}
            {latest && (
              <View style={styles.cameraBadge}>
                <Ionicons
                  name={isVideo ? "videocam" : "camera"}
                  size={10}
                  color={COLORS.white}
                />
              </View>
            )}
          </View>
          <View style={styles.headerText}>
            <Text style={styles.petName} numberOfLines={1}>
              {formatName(petName)}
            </Text>
            <View style={styles.statusRow}>
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Hospedado</Text>
              </View>
              {roomName && (
                <View style={styles.roomChip}>
                  <Ionicons
                    name="bed-outline"
                    size={11}
                    color={COLORS.textTertiary}
                  />
                  <Text style={styles.roomText} numberOfLines={1}>
                    {roomName}
                  </Text>
                </View>
              )}
            </View>
            {latest && (
              <Text style={styles.updateLine} numberOfLines={1}>
                <Text style={styles.updateCaption}>
                  {latest.caption || "Nuevo reporte"}
                </Text>
                <Text style={styles.updateTime}>
                  {"  ·  " + timeAgo(latest.createdAt)}
                </Text>
              </Text>
            )}
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={COLORS.textTertiary}
          />
        </View>

        {checkIn && checkOut && (
          <View style={styles.dateHero}>
            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>CHECK-IN</Text>
              <Text style={styles.datePillDay}>{formatDayShort(checkIn)}</Text>
              <Text style={styles.datePillSub}>{formatWeekdayShort(checkIn)}</Text>
            </View>

            <View style={styles.dateConnector}>
              <View style={styles.connectorLine} />
              {progress && (
                <View style={styles.progressBadge}>
                  <Ionicons name="paw" size={11} color={COLORS.primary} />
                  <Text style={styles.progressBadgeText}>
                    Día {progress.current} de {progress.total}
                  </Text>
                </View>
              )}
              <View style={styles.connectorLine} />
            </View>

            <View style={styles.datePill}>
              <Text style={styles.datePillLabel}>CHECK-OUT</Text>
              <Text style={styles.datePillDay}>{formatDayShort(checkOut)}</Text>
              <Text style={styles.datePillSub}>{formatWeekdayShort(checkOut)}</Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 16,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  accentBar: {
    width: 4,
    backgroundColor: COLORS.successText,
  },
  body: {
    flex: 1,
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  photoRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    padding: 2,
    backgroundColor: COLORS.successBg,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  photo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.bgSection,
  },
  photoFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  petName: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    flexWrap: "wrap",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.successText,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.successText,
    letterSpacing: 0.3,
  },
  roomChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    flexShrink: 1,
  },
  roomText: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontWeight: "700",
    flexShrink: 1,
  },
  updateLine: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  updateCaption: {
    color: COLORS.textPrimary,
    fontWeight: "600",
  },
  updateTime: {
    color: COLORS.textTertiary,
    fontWeight: "700",
  },
  // Bloque CHECK-IN | progreso | CHECK-OUT
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
  progressBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginVertical: 3,
  },
  progressBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.primary,
  },
});
