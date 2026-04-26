import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, Image } from "react-native";
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
  simplified?: boolean;
  photoUrl?: string | null;
}

export function ChecklistSummaryCard({
  checklist,
  compact = false,
  simplified = false,
  photoUrl,
}: ChecklistSummaryCardProps) {
  const energyConfig = ENERGY_LABELS[checklist.energy] ?? ENERGY_LABELS.MEDIUM;
  const socConfig = SOCIALIZATION_LABELS[checklist.socialization] ?? SOCIALIZATION_LABELS.SOCIAL;
  const restConfig = REST_LABELS[checklist.rest] ?? REST_LABELS.GOOD;
  const moodConfig = MOOD_LABELS[checklist.mood] ?? MOOD_LABELS.HAPPY;

  if (simplified) {
    return (
      <View style={styles.card}>
        <View style={styles.simplifiedMoodRow}>
          <Text style={styles.moodEmojiHero}>{moodConfig.emoji}</Text>
          <Text style={styles.moodLabelHero}>{moodConfig.label}</Text>
        </View>

        <View style={styles.simplifiedChecks}>
          <CheckItem label="Comió" done={checklist.mealsCompleted} />
          <CheckItem label="Paseó" done={checklist.walksCompleted} />
          <CheckItem label="Sanitario" done={checklist.bathroomBreaks} />
        </View>

        {checklist.additionalNotes && (
          <Text style={styles.notes}>{checklist.additionalNotes}</Text>
        )}
      </View>
    );
  }

  const date = new Date(checklist.date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });

  if (compact) {
    return (
      <View style={styles.compactCard}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.compactThumb} />
        ) : (
          <View style={[styles.compactThumb, styles.compactThumbFallback]}>
            <Ionicons name="image-outline" size={16} color={COLORS.textDisabled} />
          </View>
        )}
        <View style={styles.compactBody}>
          <View style={styles.compactTopRow}>
            <Text style={styles.compactDate}>{date}</Text>
            <View style={styles.compactMoodWrap}>
              <Text style={styles.compactMoodEmoji}>{moodConfig.emoji}</Text>
              <Text style={styles.compactMoodLabel}>{moodConfig.label}</Text>
            </View>
          </View>
          <View style={styles.compactChecks}>
            <CheckLabeledIcon label="Comió" done={checklist.mealsCompleted} />
            <CheckLabeledIcon label="Paseó" done={checklist.walksCompleted} />
            <CheckLabeledIcon label="Sanitario" done={checklist.bathroomBreaks} />
          </View>
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
        <CheckItem label="Sanitario" done={checklist.bathroomBreaks} />
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

function CheckLabeledIcon({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.compactCheckItem}>
      <Ionicons
        name={done ? "checkmark-circle" : "close-circle"}
        size={14}
        color={done ? COLORS.successText : COLORS.border}
      />
      <Text
        style={[
          styles.compactCheckLabel,
          !done && { color: COLORS.border },
        ]}
      >
        {label}
      </Text>
    </View>
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
  simplifiedMoodRow: {
    alignItems: "center",
    marginBottom: 14,
  },
  moodEmojiHero: {
    fontSize: 44,
    marginBottom: 4,
  },
  moodLabelHero: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  simplifiedChecks: {
    flexDirection: "row",
    justifyContent: "space-around",
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
    marginBottom: 8,
    gap: 12,
  },
  compactThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: COLORS.bgSection,
  },
  compactThumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  compactBody: {
    flex: 1,
    gap: 6,
  },
  compactTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  compactDate: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  compactMoodWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  compactMoodEmoji: {
    fontSize: 16,
  },
  compactMoodLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  compactChecks: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  compactCheckItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  compactCheckLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
});
