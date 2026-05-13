import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RoomWithStatus } from "@/lib/api";
import { formatName } from "@/lib/format";

interface RoomStatusCardProps {
  room: RoomWithStatus;
  onPress?: () => void;
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

const SIZE_LABELS: Record<string, string> = {
  XS: "Muy peq.",
  S: "Pequeño",
  M: "Mediano",
  L: "Grande",
  XL: "Muy grande",
};

export function RoomStatusCard({ room, onPress }: RoomStatusCardProps) {
  const occupants = room.currentReservations ?? [];
  const occupiedCount = occupants.length;
  const isFull = occupiedCount >= room.capacity;
  const isPartial = occupiedCount > 0 && !isFull;
  const isInactive = !room.isActive;

  const statusStyle = isInactive
    ? {
        label: "Inactivo",
        bg: COLORS.bgSection,
        color: COLORS.textDisabled,
        accent: COLORS.border,
      }
    : isFull
    ? {
        label: "Lleno",
        bg: COLORS.errorBg,
        color: COLORS.errorText,
        accent: COLORS.errorText,
      }
    : isPartial
    ? {
        label: `${occupiedCount}/${room.capacity}`,
        bg: COLORS.warningBg,
        color: COLORS.warningText,
        accent: COLORS.warningText,
      }
    : {
        label: "Disponible",
        bg: COLORS.successBg,
        color: COLORS.successText,
        accent: COLORS.successText,
      };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.accentBar, { backgroundColor: statusStyle.accent }]} />
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.nameRow}>
            <View style={styles.bedIconWrap}>
              <Ionicons name="bed" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {room.name}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.badgeText, { color: statusStyle.color }]}>
              {statusStyle.label}
            </Text>
          </View>
        </View>

        {occupants.length > 0 &&
          occupants.map((occupant) => (
            <View key={occupant.reservationId} style={styles.occupantRow}>
              <Ionicons name="paw" size={14} color={COLORS.errorText} />
              <Text style={styles.occupantText} numberOfLines={1}>
                {formatName(occupant.pet.name)} —{" "}
                {formatName(occupant.owner.name)}
              </Text>
              <View style={styles.checkoutPill}>
                <Ionicons
                  name="log-out-outline"
                  size={11}
                  color={COLORS.errorText}
                />
                <Text style={styles.checkoutText}>
                  Sale {formatDate(occupant.checkOut)}
                </Text>
              </View>
            </View>
          ))}

        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons
              name="people-outline"
              size={11}
              color={COLORS.textTertiary}
            />
            <Text style={styles.metaText}>Cap. {room.capacity}</Text>
          </View>
          {(room.sizeAllowed as string[]).map((s) => (
            <View key={s} style={styles.metaChip}>
              <Text style={styles.metaText}>{SIZE_LABELS[s] || s}</Text>
            </View>
          ))}
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
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
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
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  bedIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 16,
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
  occupantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    backgroundColor: COLORS.errorBgLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  occupantText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: "700",
    flex: 1,
  },
  checkoutPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.errorBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  checkoutText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.errorText,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
});
