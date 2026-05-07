import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  onPress?: () => void;
  badge?: number;
}

export function StatCard({ label, value, icon, color = COLORS.primary, onPress, badge }: StatCardProps) {
  const isHighlighted = badge !== undefined && badge > 0;
  const cardStyle = [
    styles.card,
    isHighlighted && {
      borderColor: color,
      backgroundColor: `${color}0D`,
      shadowColor: color,
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
  ];

  const content = (
    <>
      <View style={[styles.iconContainer, { backgroundColor: `${color}15` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {isHighlighted && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.75}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={cardStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: "transparent",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconContainer: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  label: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  badge: {
    position: "absolute",
    top: -8,
    right: -8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.errorText,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.white,
  },
});
