import { COLORS } from "@/constants/colors";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  getOwnerChecklists,
  getReservationById,
  getStayUpdates,
  deleteStayUpdate,
} from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import { ChecklistSummaryCard } from "@/components/ChecklistSummaryCard";
import { EvidenceGrid } from "@/components/EvidenceByReports";
import { MediaViewer, type MediaViewerItem } from "@/components/MediaViewer";
import { formatName, utcDayKey, localDayKey, formatDateLong } from "@/lib/format";
import type { StayUpdate } from "@holidoginn/shared";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function ChecklistsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [orphansExpanded, setOrphansExpanded] = useState(false);
  const initRef = useRef(false);

  const [viewerItem, setViewerItem] = useState<MediaViewerItem | null>(null);

  // Staff/admin pueden eliminar evidencias; los dueños solo las ven.
  const role = useAuthStore((s) => s.role);
  const canDelete = role === "ADMIN" || role === "STAFF";

  const { data: reservation } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => getReservationById(id!),
    enabled: !!id,
  });

  const {
    data: checklists,
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ["reservation-checklists", id],
    queryFn: () => getOwnerChecklists(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const { data: updates } = useQuery({
    queryKey: ["stay-updates", id],
    queryFn: () => getStayUpdates(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const sorted = (checklists ?? []).slice().sort(
    (a, b) => +new Date(a.date) - +new Date(b.date)
  );

  // Por defecto, expande el reporte más reciente (último del array ascendente).
  useEffect(() => {
    if (!initRef.current && sorted.length > 0) {
      setExpandedIds(new Set([sorted[sorted.length - 1].id]));
      initRef.current = true;
    }
  }, [sorted]);

  const toggleExpanded = (checklistId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(checklistId)) next.delete(checklistId);
      else next.add(checklistId);
      return next;
    });
  };

  const toggleOrphans = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOrphansExpanded((v) => !v);
  };

  const { updatesByDay, orphans } = useMemo(() => {
    const byDay = new Map<string, StayUpdate[]>();
    const orphan: StayUpdate[] = [];
    if (!updates || updates.length === 0) {
      return { updatesByDay: byDay, orphans: orphan };
    }
    const reportDays = new Set(sorted.map((c) => utcDayKey(c.date)));
    for (const u of updates) {
      const key = localDayKey(new Date(u.createdAt));
      if (reportDays.has(key)) {
        const arr = byDay.get(key) ?? [];
        arr.push(u);
        byDay.set(key, arr);
      } else {
        orphan.push(u);
      }
    }
    for (const arr of byDay.values()) {
      arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    }
    orphan.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return { updatesByDay: byDay, orphans: orphan };
  }, [updates, sorted]);

  const openItem = (u: StayUpdate) =>
    setViewerItem({
      url: u.mediaUrl,
      type: u.mediaType === "video" ? "video" : "image",
    });

  // Optimista: la evidencia desaparece al confirmar; si el server falla,
  // reaparece. También se invalidan los reportes (recuentan fotos/videos).
  const deleteMutation = useOptimisticMutation({
    mutationFn: (updateId: string) => deleteStayUpdate(updateId),
    patches: [
      {
        queryKey: ["stay-updates", id],
        updater: (old, updateId) => {
          const list = old as StayUpdate[] | undefined;
          if (!Array.isArray(list)) return old;
          return list.filter((u) => u.id !== updateId);
        },
      },
    ],
    invalidateKeys: [
      ["stay-updates", id],
      ["reservation-checklists", id],
    ],
    errorTitle: "No se pudo eliminar la evidencia",
  });

  const confirmDelete = (u: StayUpdate) => {
    Alert.alert(
      u.mediaType === "video" ? "Eliminar video" : "Eliminar foto",
      "El dueño dejará de verla. Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteMutation.mutate(u.id),
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al cargar reportes</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (sorted.length === 0) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyIcon}>
          <Ionicons name="document-text-outline" size={36} color={COLORS.primary} />
        </View>
        <Text style={styles.emptyTitle}>Aún no hay reportes</Text>
        <Text style={styles.emptySubtitle}>
          {reservation?.pet
            ? `Cuando el equipo HDI registre el primer reporte de ${formatName(reservation.pet.name)}, aparecerá aquí.`
            : "Cuando el equipo HDI registre el primer reporte, aparecerá aquí."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header con info de la mascota */}
      {reservation?.pet && (
        <View style={styles.header}>
          <Text style={styles.petName}>{formatName(reservation.pet.name)}</Text>
          <Text style={styles.headerSubtitle}>
            {sorted.length} {sorted.length === 1 ? "reporte" : "reportes"} en esta estancia
          </Text>
        </View>
      )}

      {/* Lista de reportes */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        {sorted.map((c) => {
          const dayItems = updatesByDay.get(utcDayKey(c.date)) ?? [];
          const isExpanded = expandedIds.has(c.id);
          return (
            <View key={c.id} style={styles.reportBlock}>
              <TouchableOpacity
                style={styles.collapseHeader}
                onPress={() => toggleExpanded(c.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayHeader}>{formatDateLong(c.date)}</Text>
                  <Text style={styles.staffLabel}>
                    Reportado por {formatName(c.staff?.firstName ?? "—")}{" "}
                    {formatName(c.staff?.lastName ?? "")}
                    {dayItems.length > 0 && ` · ${dayItems.length} evid.`}
                  </Text>
                </View>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={COLORS.textTertiary}
                />
              </TouchableOpacity>
              {isExpanded && (
                <>
                  <ChecklistSummaryCard checklist={c} />
                  {dayItems.length > 0 && (
                    <View style={styles.evidenceBlock}>
                      <Text style={styles.evidenceTitle}>
                        Evidencias ({dayItems.length})
                      </Text>
                      <EvidenceGrid
                        items={dayItems}
                        onPressItem={openItem}
                        onDeleteItem={canDelete ? confirmDelete : undefined}
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          );
        })}

        {orphans.length > 0 && (
          <View style={styles.orphanBlock}>
            <TouchableOpacity
              style={styles.orphanHeader}
              onPress={toggleOrphans}
              activeOpacity={0.7}
            >
              <Ionicons
                name="alert-circle-outline"
                size={16}
                color={COLORS.warningText}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.orphanTitle}>
                  Sin reporte diario asignado
                </Text>
                <Text style={styles.orphanSubtitle}>
                  Evidencias subidas en días sin reporte ({orphans.length})
                </Text>
              </View>
              <Ionicons
                name={orphansExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={COLORS.textTertiary}
              />
            </TouchableOpacity>
            {orphansExpanded && (
              <EvidenceGrid
                items={orphans}
                onPressItem={openItem}
                onDeleteItem={canDelete ? confirmDelete : undefined}
              />
            )}
          </View>
        )}
      </ScrollView>

      <MediaViewer item={viewerItem} onClose={() => setViewerItem(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  petName: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  reportBlock: {
    marginBottom: 8,
  },
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  dayHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 2,
    textTransform: "capitalize",
  },
  staffLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  evidenceBlock: {
    marginTop: 8,
    marginBottom: 16,
  },
  evidenceTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  orphanBlock: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  orphanHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  orphanTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  orphanSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: COLORS.bgPage,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  errorText: {
    fontSize: 15,
    color: COLORS.dangerText,
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 14,
  },
});
