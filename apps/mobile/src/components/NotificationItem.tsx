import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface NotificationItemProps {
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string | Date;
  onPress?: () => void;
}

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  CHECK_IN: "log-in-outline",
  CHECK_OUT: "log-out-outline",
  RESERVATION_CONFIRMED: "checkmark-circle-outline",
  RESERVATION_REMINDER: "alarm-outline",
  NEW_UPDATE: "camera-outline",
  PAYMENT_RECEIVED: "card-outline",
  GENERAL: "information-circle-outline",
  DAILY_REPORT: "document-text-outline",
  STAFF_ALERT: "warning-outline",
  REVIEW_REQUEST: "star-outline",
  RESERVATION_CHANGE_REQUESTED: "calendar-outline",
  RESERVATION_CHANGE_APPROVED: "checkmark-circle-outline",
  RESERVATION_CHANGE_REJECTED: "close-circle-outline",
  REFUND_ISSUED: "cash-outline",
  CREDIT_ADDED: "wallet-outline",
  CREDIT_APPLIED: "wallet-outline",
  STAFF_ASSIGNED: "person-add-outline",
  NEW_RESERVATION: "paw-outline",
  CHECKLIST_REMINDER: "document-text-outline",
};

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationItem({
  type,
  title,
  body,
  isRead,
  createdAt,
  onPress,
}: NotificationItemProps) {
  const iconName = ICON_MAP[type] || ICON_MAP.GENERAL;

  return (
    <TouchableOpacity
      style={[styles.container, !isRead && styles.unread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, !isRead && styles.iconUnread]}>
        <Ionicons name={iconName} size={22} color={isRead ? COLORS.textDisabled : COLORS.primary} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, !isRead && styles.titleUnread]}>{title}</Text>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
        <Text style={styles.date}>{formatDate(createdAt)}</Text>
      </View>
      {!isRead && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  unread: {
    backgroundColor: COLORS.reviewBg,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  iconUnread: {
    backgroundColor: COLORS.reviewBgAlt,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  titleUnread: {
    color: COLORS.textPrimary,
    fontWeight: "700",
  },
  body: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    lineHeight: 18,
  },
  date: {
    fontSize: 11,
    color: COLORS.textDisabled,
    marginTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: 6,
  },
});
