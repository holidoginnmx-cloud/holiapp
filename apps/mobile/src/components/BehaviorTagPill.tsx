import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet } from "react-native";
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
}

export function BehaviorTagPill({ tag }: BehaviorTagPillProps) {
  const config = TAG_CONFIG[tag] ?? TAG_CONFIG.CALM;

  return (
    <View style={[styles.pill, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
  },
});
