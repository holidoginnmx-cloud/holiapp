import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DailyChecklist } from "@holidoginn/shared";

const ENERGY_LABELS: Record<string, { label: string; color: string }> = {
  LOW: { label: "Baja", color: COLORS.warningText },
  MEDIUM: { label: "Media", color: COLORS.infoText },
  HIGH: { label: "Alta", color: COLORS.successText },
};

const SOCIALIZATION_LABELS: Record<string, { label: string; color: string }> = {
  ISOLATED: { label: "Aislado", color: COLORS.warningText },
  SELECTIVE: { label: "Selectivo", color: COLORS.infoText },
  SOCIAL: { label: "Social", color: COLORS.successText },
};

const REST_LABELS: Record<string, { label: string; color: string }> = {
  POOR: { label: "Malo", color: COLORS.errorText },
  FAIR: { label: "Regular", color: COLORS.warningText },
  GOOD: { label: "Bueno", color: COLORS.successText },
};

const MOOD_LABELS: Record<string, { label: string; emoji: string }> = {
  SAD: { label: "Triste", emoji: "😢" },
  NEUTRAL: { label: "Neutral", emoji: "😐" },
  HAPPY: { label: "Feliz", emoji: "😊" },
  EXCITED: { label: "Emocionado", emoji: "🤩" },
};

interface ChecklistSummaryCardProps {
  checklist: DailyChecklist;
  compact?: boolean;
}

export function ChecklistSummaryCard({
  checklist,
  compact = false,
}: ChecklistSummaryCardProps) {
  const energyConfig = ENERGY_LABELS[checklist.energy] ?? ENERGY_LABELS.MEDIUM;
  const socConfig = SOCIALIZATION_LABELS[checklist.socialization] ?? SOCIALIZATION_LABELS.SOCIAL;
  const restConfig = REST_LABELS[checklist.rest] ?? REST_LABELS.GOOD;
  const moodConfig = MOOD_LABELS[checklist.mood] ?? MOOD_LABELS.HAPPY;

  const date = new Date(checklist.date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });

  if (compact) {
    return (
      <View style={styles.compactCard}>
        <Text style={styles.compactDate}>{date}</Text>
        <View style={styles.compactPills}>
          <View style={[styles.miniPill, { backgroundColor: `${energyConfig.color}20` }]}>
            <Text style={[styles.miniPillText, { color: energyConfig.color }]}>
              E: {energyConfig.label}
            </Text>
          </View>
          <View style={[styles.miniPill, { backgroundColor: `${restConfig.color}20` }]}>
            <Text style={[styles.miniPillText, { color: restConfig.color }]}>
              D: {restConfig.label}
            </Text>
          </View>
          <Text style={styles.moodEmoji}>{moodConfig.emoji}</Text>
        </View>
        <View style={styles.compactChecks}>
          <CheckIcon done={checklist.mealsCompleted} />
          <CheckIcon done={checklist.walksCompleted} />
          <CheckIcon done={checklist.bathroomBreaks} />
          <CheckIcon done={checklist.playtime} />
          <CheckIcon done={checklist.socializationDone} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <LevelPill label="Energía" value={energyConfig.label} color={energyConfig.color} />
        <LevelPill label="Social" value={socConfig.label} color={socConfig.color} />
        <LevelPill label="Descanso" value={restConfig.label} color={restConfig.color} />
        <View style={styles.moodBox}>
          <Text style={styles.moodEmojiLarge}>{moodConfig.emoji}</Text>
          <Text style={styles.moodLabel}>{moodConfig.label}</Text>
        </View>
      </View>

      <View style={styles.checklistRow}>
        <CheckItem label="Comidas" done={checklist.mealsCompleted} />
        <CheckItem label="Paseos" done={checklist.walksCompleted} />
        <CheckItem label="Baño" done={checklist.bathroomBreaks} />
        <CheckItem label="Juego" done={checklist.playtime} />
        <CheckItem label="Social" done={checklist.socializationDone} />
      </View>

      {checklist.additionalNotes && (
        <Text style={styles.notes}>{checklist.additionalNotes}</Text>
      )}

      <View style={styles.evidenceRow}>
        <Ionicons name="camera-outline" size={14} color={COLORS.textTertiary} />
        <Text style={styles.evidenceText}>{checklist.photosCount} fotos</Text>
        <Ionicons name="videocam-outline" size={14} color={COLORS.textTertiary} />
        <Text style={styles.evidenceText}>{checklist.videosCount} videos</Text>
      </View>
    </View>
  );
}

function LevelPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={[styles.levelPill, { backgroundColor: `${color}15` }]}>
      <Text style={styles.levelPillLabel}>{label}</Text>
      <Text style={[styles.levelPillValue, { color }]}>{value}</Text>
    </View>
  );
}

function CheckItem({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.checkItem}>
      <Ionicons
        name={done ? "checkmark-circle" : "close-circle"}
        size={18}
        color={done ? COLORS.successText : COLORS.border}
      />
      <Text style={[styles.checkLabel, !done && { color: COLORS.border }]}>
        {label}
      </Text>
    </View>
  );
}

function CheckIcon({ done }: { done: boolean }) {
  return (
    <Ionicons
      name={done ? "checkmark-circle" : "close-circle"}
      size={14}
      color={done ? COLORS.successText : COLORS.border}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  levelPill: {
    flex: 1,
    borderRadius: 8,
    padding: 8,
    alignItems: "center",
  },
  levelPillLabel: {
    fontSize: 10,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  levelPillValue: {
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  moodBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  moodEmojiLarge: {
    fontSize: 20,
  },
  moodLabel: {
    fontSize: 10,
    color: COLORS.textTertiary,
    fontWeight: "600",
    marginTop: 2,
  },
  checklistRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  checkItem: {
    alignItems: "center",
    gap: 2,
  },
  checkLabel: {
    fontSize: 10,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  notes: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 8,
    lineHeight: 18,
  },
  evidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  evidenceText: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginRight: 8,
  },
  // Compact
  compactCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    gap: 10,
  },
  compactDate: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    width: 50,
  },
  compactPills: {
    flexDirection: "row",
    gap: 4,
    flex: 1,
    alignItems: "center",
  },
  miniPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  miniPillText: {
    fontSize: 10,
    fontWeight: "700",
  },
  moodEmoji: {
    fontSize: 14,
  },
  compactChecks: {
    flexDirection: "row",
    gap: 2,
  },
});
