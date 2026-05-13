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
  notes?: string | null;
  onDelete?: () => void;
}

export function BehaviorTagPill({ tag, notes, onDelete }: BehaviorTagPillProps) {
  const config = TAG_CONFIG[tag] ?? TAG_CONFIG.CALM;
  const hasNotes = !!notes && notes.trim().length > 0;

  return (
    <View style={hasNotes ? styles.wrapWithNotes : undefined}>
      <View style={[styles.pill, { backgroundColor: config.bg }]}>
        <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
        {hasNotes && (
          <Ionicons name="chatbubble-ellipses" size={12} color={config.text} />
        )}
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
      {hasNotes && (
        <Text style={[styles.notes, { color: config.text }]} numberOfLines={3}>
          {notes!.trim()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapWithNotes: {
    alignItems: "flex-start",
  },
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
  notes: {
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 4,
    marginLeft: 4,
    maxWidth: 220,
    opacity: 0.85,
  },
  deleteBtn: {
    marginLeft: 2,
  },
});
