import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatDayShort } from "@/lib/format";

interface NotificationItemProps {
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string | Date;
  onPress?: () => void;
}

type TypeStyle = {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
};

const TYPE_STYLE: Record<string, TypeStyle> = {
  CHECK_IN: { icon: "log-in-outline", tint: COLORS.successText },
  CHECK_OUT: { icon: "log-out-outline", tint: COLORS.textTertiary },
  RESERVATION_REMINDER: { icon: "alarm-outline", tint: COLORS.warningText },
  NEW_UPDATE: { icon: "camera-outline", tint: COLORS.primary },
  PAYMENT_RECEIVED: { icon: "card-outline", tint: COLORS.successText },
  GENERAL: { icon: "information-circle-outline", tint: COLORS.infoText },
  DAILY_REPORT: { icon: "document-text-outline", tint: COLORS.primary },
  STAFF_ALERT: { icon: "warning-outline", tint: COLORS.errorText },
  REVIEW_REQUEST: { icon: "star-outline", tint: COLORS.star ?? COLORS.warningText },
  RESERVATION_CHANGE_APPROVED: {
    icon: "checkmark-circle-outline",
    tint: COLORS.successText,
  },
  RESERVATION_CHANGE_REJECTED: {
    icon: "close-circle-outline",
    tint: COLORS.errorText,
  },
  REFUND_ISSUED: { icon: "cash-outline", tint: COLORS.successText },
  CREDIT_ADDED: { icon: "wallet-outline", tint: COLORS.successText },
  CREDIT_APPLIED: { icon: "wallet-outline", tint: COLORS.primary },
  STAFF_ASSIGNED: { icon: "person-add-outline", tint: COLORS.primary },
  NEW_RESERVATION: { icon: "paw-outline", tint: COLORS.primary },
  CHECKLIST_REMINDER: {
    icon: "document-text-outline",
    tint: COLORS.warningText,
  },
};

function relativeTime(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Justo ahora";
  if (min < 60) return `Hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Hace ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `Hace ${d}d`;
  return formatDayShort(date);
}

export function NotificationItem({
  type,
  title,
  body,
  isRead,
  createdAt,
  onPress,
}: NotificationItemProps) {
  const cfg = TYPE_STYLE[type] ?? TYPE_STYLE.GENERAL;
  const tint = cfg.tint;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        !isRead && { backgroundColor: `${tint}10` },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        style={[styles.accentBar, { backgroundColor: !isRead ? tint : "transparent" }]}
      />
      <View style={styles.body}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: !isRead ? `${tint}25` : COLORS.bgSection },
          ]}
        >
          <Ionicons
            name={cfg.icon}
            size={18}
            color={isRead ? COLORS.textTertiary : tint}
          />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, !isRead && styles.titleUnread]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {!isRead && <View style={[styles.dot, { backgroundColor: tint }]} />}
          </View>
          <Text style={styles.bodyText} numberOfLines={2}>
            {body}
          </Text>
          <Text style={styles.date}>{relativeTime(createdAt)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  accentBar: {
    width: 3,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    gap: 12,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  titleUnread: {
    color: COLORS.textPrimary,
    fontWeight: "800",
  },
  bodyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 3,
    lineHeight: 18,
  },
  date: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 6,
    fontWeight: "600",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
