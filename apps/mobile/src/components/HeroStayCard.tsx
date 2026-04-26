import { COLORS } from "@/constants/colors";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getStayUpdates } from "@/lib/api";

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

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.headerRow}>
        {petPhotoUrl ? (
          <Image source={{ uri: petPhotoUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Ionicons name="paw" size={26} color={COLORS.primary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.petName} numberOfLines={1}>
            {petName}
          </Text>
          <View style={styles.statusRow}>
            <View style={styles.statusBadge}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Hospedado</Text>
            </View>
            {roomName && <Text style={styles.roomText}>· {roomName}</Text>}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
      </View>

      {latest && (
        <View style={styles.updateRow}>
          {latest.mediaUrl && (
            <Image source={{ uri: latest.mediaUrl }} style={styles.updateThumb} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.updateText} numberOfLines={2}>
              {latest.caption || "El staff compartió una actualización"}
            </Text>
            <Text style={styles.updateTime}>{timeAgo(latest.createdAt)}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  petName: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.successBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.successText,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.successText,
  },
  roomText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  updateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  updateThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: COLORS.bgSection,
  },
  updateText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: "italic",
    lineHeight: 18,
  },
  updateTime: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
});
