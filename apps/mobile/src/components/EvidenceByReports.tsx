import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StayUpdate, DailyChecklist } from "@holidoginn/shared";
import {
  utcDayKey,
  localDayKey,
  formatName,
  formatDateLong,
} from "@/lib/format";
import { videoThumbnailUrl, cloudinaryResized } from "@/lib/cloudinary";

type ChecklistMaybeWithStaff = DailyChecklist & {
  staff?: { id: string; firstName: string; lastName: string };
};

type Props = {
  updates: StayUpdate[];
  checklists: ChecklistMaybeWithStaff[];
  onPressItem: (update: StayUpdate, allInGroup: StayUpdate[]) => void;
  onPressReport?: () => void;
};

export function EvidenceByReports({
  updates,
  checklists,
  onPressItem,
  onPressReport,
}: Props) {
  if (updates.length === 0) {
    return null;
  }

  const reportByDay = new Map<string, ChecklistMaybeWithStaff>();
  for (const c of checklists) {
    reportByDay.set(utcDayKey(c.date), c);
  }

  const updatesByDay = new Map<string, StayUpdate[]>();
  const orphans: StayUpdate[] = [];
  for (const u of updates) {
    const key = localDayKey(new Date(u.createdAt));
    if (reportByDay.has(key)) {
      const arr = updatesByDay.get(key) ?? [];
      arr.push(u);
      updatesByDay.set(key, arr);
    } else {
      orphans.push(u);
    }
  }

  // Sort updates within each day desc by createdAt
  for (const arr of updatesByDay.values()) {
    arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  orphans.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // Days that have evidence, sorted desc by date
  const daysWithEvidence = Array.from(updatesByDay.keys()).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Evidencias por reporte</Text>
        {onPressReport && (
          <TouchableOpacity
            onPress={onPressReport}
            activeOpacity={0.8}
            hitSlop={6}
          >
            <Text style={styles.linkText}>Ver reportes</Text>
          </TouchableOpacity>
        )}
      </View>

      {daysWithEvidence.map((dayKey) => {
        const checklist = reportByDay.get(dayKey)!;
        const items = updatesByDay.get(dayKey) ?? [];
        return (
          <View key={dayKey} style={styles.reportBlock}>
            <View style={styles.reportHeader}>
              <Ionicons
                name="document-text"
                size={16}
                color={COLORS.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.reportDate}>{formatDateLong(checklist.date)}</Text>
                {checklist.staff && (
                  <Text style={styles.reportStaff}>
                    Reportado por {formatName(checklist.staff.firstName)}{" "}
                    {formatName(checklist.staff.lastName)}
                  </Text>
                )}
              </View>
              <Text style={styles.countBadge}>
                {items.length} {items.length === 1 ? "evidencia" : "evidencias"}
              </Text>
            </View>
            <EvidenceGrid items={items} onPressItem={onPressItem} />
          </View>
        );
      })}

      {orphans.length > 0 && (
        <View style={styles.reportBlock}>
          <View style={styles.reportHeader}>
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={COLORS.warningText}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportDate}>Sin reporte diario asignado</Text>
              <Text style={styles.reportStaff}>
                Evidencias subidas en días sin reporte
              </Text>
            </View>
            <Text style={styles.countBadge}>
              {orphans.length}{" "}
              {orphans.length === 1 ? "evidencia" : "evidencias"}
            </Text>
          </View>
          <EvidenceGrid items={orphans} onPressItem={onPressItem} />
        </View>
      )}
    </View>
  );
}

export function EvidenceGrid({
  items,
  onPressItem,
}: {
  items: StayUpdate[];
  onPressItem: (update: StayUpdate, allInGroup: StayUpdate[]) => void;
}) {
  return (
    <View style={styles.grid}>
      {items.map((u) => {
        const isVideo = u.mediaType === "video";
        const thumbUri = isVideo ? videoThumbnailUrl(u.mediaUrl) : u.mediaUrl;
        return (
          <TouchableOpacity
            key={u.id}
            style={styles.thumbWrap}
            activeOpacity={0.85}
            onPress={() => onPressItem(u, items)}
          >
            <Image
              source={{ uri: cloudinaryResized(thumbUri, 360, "fill") }}
              style={styles.thumb}
            />
            {isVideo && (
              <View style={styles.playOverlay}>
                <Ionicons name="play-circle" size={32} color={COLORS.white} />
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  reportBlock: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  reportDate: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  reportStaff: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  countBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textTertiary,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thumbWrap: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    backgroundColor: COLORS.bgSection,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
});
