import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface AlertItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  severity: "warning" | "error" | "info";
  onPress?: () => void;
}

const SEVERITY_CONFIG = {
  warning: { bg: COLORS.warningBg, color: COLORS.warningText, iconColor: COLORS.warningText },
  error: { bg: COLORS.errorBg, color: COLORS.errorText, iconColor: COLORS.errorText },
  info: { bg: COLORS.infoBg, color: COLORS.infoText, iconColor: COLORS.infoText },
};

export function AlertItem({ icon, text, severity, onPress }: AlertItemProps) {
  const config = SEVERITY_CONFIG[severity];

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: config.bg }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <Ionicons name={icon} size={18} color={config.iconColor} />
      <Text style={[styles.text, { color: config.color }]} numberOfLines={2}>
        {text}
      </Text>
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color={config.iconColor} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
});
