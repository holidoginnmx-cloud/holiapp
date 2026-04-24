import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RoomWithStatus } from "@/lib/api";

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
  const isOccupied = room.currentReservation !== null;
  const isInactive = !room.isActive;

  let statusLabel: string;
  let statusBg: string;
  let statusColor: string;

  if (isInactive) {
    statusLabel = "Inactivo";
    statusBg = COLORS.bgSection;
    statusColor = COLORS.textDisabled;
  } else if (isOccupied) {
    statusLabel = "Ocupado";
    statusBg = COLORS.errorBg;
    statusColor = COLORS.errorText;
  } else {
    statusLabel = "Disponible";
    statusBg = COLORS.successBg;
    statusColor = COLORS.successText;
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <Ionicons name="bed-outline" size={20} color={COLORS.primary} />
          <Text style={styles.name}>{room.name}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusBg }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {isOccupied && room.currentReservation && (
        <View style={styles.occupantRow}>
          <Ionicons name="paw" size={14} color={COLORS.textTertiary} />
          <Text style={styles.occupantText}>
            {room.currentReservation.petName} — {room.currentReservation.ownerName}
          </Text>
          <Text style={styles.checkoutText}>
            Sale {formatDate(room.currentReservation.checkOut)}
          </Text>
        </View>
      )}

      <View style={styles.details}>
        <Text style={styles.price}>
          ${Number(room.pricePerDay).toLocaleString()}/día
        </Text>
        <Text style={styles.meta} numberOfLines={2} ellipsizeMode="tail">
          Cap. {room.capacity} ·{" "}
          {(room.sizeAllowed as string[]).map((s) => SIZE_LABELS[s] || s).join(", ")}
        </Text>
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
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 17,
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
  occupantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: COLORS.errorBgLight,
    borderRadius: 8,
    padding: 8,
  },
  occupantText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: "600",
    flex: 1,
  },
  checkoutText: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  details: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  price: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
    flexShrink: 0,
  },
  meta: {
    fontSize: 12,
    color: COLORS.textDisabled,
    flex: 1,
    flexShrink: 1,
    textAlign: "right",
  },
});
