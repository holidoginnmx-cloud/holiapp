import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DailyChecklist } from "@holidoginn/shared";
import { formatDayShort } from "@/lib/format";
import { cloudinaryResized } from "@/lib/cloudinary";

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

// Separa `additionalNotes` en notas normales y nota de "siguiente turno"
// (handoff), que el staff agrega con prefijo `[HANDOFF]` desde el form.
function splitNotes(raw: string | null | undefined): {
  notes: string | null;
  handoff: string | null;
} {
  if (!raw) return { notes: null, handoff: null };
  const match = raw.match(/\n?\[HANDOFF\] ([\s\S]*)$/);
  if (!match) return { notes: raw.trim() || null, handoff: null };
  const notes = raw.replace(/\n?\[HANDOFF\] [\s\S]*$/, "").trim();
  return {
    notes: notes || null,
    handoff: match[1].trim() || null,
  };
}

export function ChecklistSummaryCard({
  checklist,
  compact = false,
  simplified = false,
  photoUrl,
}: ChecklistSummaryCardProps) {
  const moodConfig = MOOD_LABELS[checklist.mood] ?? MOOD_LABELS.HAPPY;
  const { notes: parsedNotes, handoff: parsedHandoff } = splitNotes(
    checklist.additionalNotes,
  );

  if (simplified) {
    return (
      <View style={styles.card}>
        <View style={styles.simplifiedMoodRow}>
          <Text style={styles.moodEmojiHero}>{moodConfig.emoji}</Text>
          <Text style={styles.moodLabelHero}>{moodConfig.label}</Text>
        </View>

        <View style={styles.checksRow}>
          <CheckItem label="Comió" done={checklist.mealsCompleted} />
          <CheckItem label="Paseó" done={checklist.walksCompleted} />
          <CheckItem label="Sanitario" done={checklist.bathroomBreaks} />
        </View>

        {parsedNotes && <Text style={styles.notes}>{parsedNotes}</Text>}
        {parsedHandoff && (
          <View style={styles.handoffBox}>
            <Ionicons name="swap-horizontal" size={14} color={COLORS.infoText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.handoffLabel}>Para el siguiente turno</Text>
              <Text style={styles.handoffText}>{parsedHandoff}</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  const date = formatDayShort(checklist.date);

  if (compact) {
    return (
      <View style={styles.compactCard}>
        {photoUrl ? (
          <Image
            source={{ uri: cloudinaryResized(photoUrl, 168, "fill") }}
            style={styles.compactThumb}
          />
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

  // Versión completa compacta: mood + 3 checks en una fila visualmente densa,
  // notas/handoff debajo, evidencias al pie.
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.moodPill}>
          <Text style={styles.moodPillEmoji}>{moodConfig.emoji}</Text>
          <Text style={styles.moodPillLabel}>{moodConfig.label}</Text>
        </View>
        <View style={styles.checksInline}>
          <CheckItem label="Comidas" done={checklist.mealsCompleted} />
          <CheckItem label="Paseos" done={checklist.walksCompleted} />
          <CheckItem label="Sanitario" done={checklist.bathroomBreaks} />
        </View>
      </View>

      {parsedNotes && <Text style={styles.notes}>{parsedNotes}</Text>}
      {parsedHandoff && (
        <View style={styles.handoffBox}>
          <Ionicons name="swap-horizontal" size={14} color={COLORS.infoText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.handoffLabel}>Para el siguiente turno</Text>
            <Text style={styles.handoffText}>{parsedHandoff}</Text>
          </View>
        </View>
      )}

      <View style={styles.evidenceRow}>
        <View style={styles.evidenceChip}>
          <Ionicons name="camera-outline" size={12} color={COLORS.textTertiary} />
          <Text style={styles.evidenceText}>{checklist.photosCount} fotos</Text>
        </View>
        <View style={styles.evidenceChip}>
          <Ionicons name="videocam-outline" size={12} color={COLORS.textTertiary} />
          <Text style={styles.evidenceText}>{checklist.videosCount} videos</Text>
        </View>
      </View>
    </View>
  );
}

function CheckItem({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={styles.checkItem}>
      <View
        style={[
          styles.checkCircle,
          { backgroundColor: done ? COLORS.successBg : COLORS.bgSection },
        ]}
      >
        <Ionicons
          name={done ? "checkmark" : "close"}
          size={14}
          color={done ? COLORS.successText : COLORS.textDisabled}
        />
      </View>
      <Text
        style={[
          styles.checkLabel,
          !done && { color: COLORS.textDisabled },
        ]}
      >
        {label}
      </Text>
    </View>
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
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 1,
    marginBottom: 10,
  },
  // Fila superior compacta: mood pill a la izquierda + checks a la derecha.
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  moodPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
  },
  moodPillEmoji: {
    fontSize: 14,
  },
  moodPillLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  checksInline: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  // Versión simplified (sin divider, mood hero más visible).
  simplifiedMoodRow: {
    alignItems: "center",
    marginBottom: 12,
  },
  moodEmojiHero: {
    fontSize: 36,
    marginBottom: 2,
  },
  moodLabelHero: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  // Fila de checks (3 items distribuidos) — usada por simplified.
  checksRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  checkItem: {
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: "700",
  },
  // Notas y handoff.
  notes: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 10,
    lineHeight: 17,
  },
  handoffBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 10,
    padding: 9,
    backgroundColor: COLORS.infoBg,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.infoText,
  },
  handoffLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.infoText,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  handoffText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  // Evidencias (chips) — fila al pie sin divider para ahorrar altura.
  evidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  evidenceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  evidenceText: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontWeight: "600",
  },
  // Compact card (con thumbnail) — sin cambios mayores.
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
