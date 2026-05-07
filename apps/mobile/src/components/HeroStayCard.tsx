import { COLORS } from "@/constants/colors";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getStayUpdates } from "@/lib/api";
import { formatName } from "@/lib/format";

interface HeroStayCardProps {
  reservationId: string;
  petName: string;
  petPhotoUrl: string | null;
  roomName: string | null;
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

export function HeroStayCard({
  reservationId,
  petName,
  petPhotoUrl,
  roomName,
  onPress,
}: HeroStayCardProps) {
  const { data: updates } = useQuery({
    queryKey: ["stay-updates", reservationId],
    queryFn: () => getStayUpdates(reservationId),
  });
  const latest = updates?.[0];
  const hasCaption = !!latest?.caption;

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
            {petPhotoUrl ? (
              <Image source={{ uri: petPhotoUrl }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Ionicons name="paw" size={26} color={COLORS.primary} />
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
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={COLORS.textTertiary}
          />
        </View>

        {latest && (
          <View style={styles.updateRow}>
            <View style={styles.updateThumbWrap}>
              {latest.mediaUrl ? (
                <Image
                  source={{ uri: latest.mediaUrl }}
                  style={styles.updateThumb}
                />
              ) : (
                <View style={[styles.updateThumb, styles.updateThumbFallback]}>
                  <Ionicons name="image" size={18} color={COLORS.border} />
                </View>
              )}
              <View style={styles.cameraBadge}>
                <Ionicons
                  name={latest.mediaType === "video" ? "videocam" : "camera"}
                  size={10}
                  color={COLORS.white}
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.updateText,
                  !hasCaption && styles.updateTextFallback,
                ]}
                numberOfLines={2}
              >
                {latest.caption || "El staff compartió una actualización"}
              </Text>
              <Text style={styles.updateTime}>
                {timeAgo(latest.createdAt)}
              </Text>
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
  updateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  updateThumbWrap: {
    position: "relative",
  },
  updateThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  updateThumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  updateText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: "600",
    lineHeight: 18,
  },
  updateTextFallback: {
    color: COLORS.textTertiary,
    fontStyle: "italic",
    fontWeight: "500",
  },
  updateTime: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "700",
  },
});
