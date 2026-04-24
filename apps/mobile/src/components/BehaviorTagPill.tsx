import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BehaviorTagValue } from "@holidoginn/shared";

const TAG_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  CALM: { bg: COLORS.successBg, text: COLORS.successText, label: "Tranquilo" },
  ANXIOUS: { bg: COLORS.warningBg, text: COLORS.warningText, label: "Ansioso" },
  DOMINANT: { bg: COLORS.dominantBg, text: COLORS.dominantText, label: "Dominante" },
  SOCIABLE: { bg: COLORS.infoBg, text: COLORS.infoText, label: "Sociable" },
  SHY: { bg: COLORS.bgSection, text: COLORS.textTertiary, label: "Tímido" },
  AGGRESSIVE: { bg: COLORS.errorBg, text: COLORS.errorText, label: "Agresivo" },
};

interface BehaviorTagPillProps {
  tag: BehaviorTagValue | string;
  onDelete?: () => void;
}

export function BehaviorTagPill({ tag, onDelete }: BehaviorTagPillProps) {
  const config = TAG_CONFIG[tag] ?? TAG_CONFIG.CALM;

  return (
    <View style={[styles.pill, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
      {onDelete && (
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={8}
          style={styles.deleteBtn}
        >
          <Ionicons name="close-circle" size={16} color={config.text} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
  },
  deleteBtn: {
    marginLeft: 2,
  },
});
