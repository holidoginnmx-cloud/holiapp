import { COLORS } from "@/constants/colors";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Animated,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  getAdminAlerts,
  resolveAdminAlert,
  getAdminStats,
} from "@/lib/api";
import type { AdminAlert } from "@/lib/api";
import { formatName } from "@/lib/format";
import { FilterTabsUnderline } from "@/components/FilterTabsUnderline";

const ALERT_LABELS: Record<string, string> = {
  NOT_EATING: "No está comiendo",
  LETHARGIC: "Está decaído",
  BEHAVIOR_ISSUE: "Problema de comportamiento",
  HEALTH_CONCERN: "Preocupación de salud",
  INCIDENT: "Incidente",
};

const SEVERITY_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  NOT_EATING: { icon: "restaurant-outline", color: COLORS.warningText, bg: COLORS.warningBg },
  LETHARGIC: { icon: "sad-outline", color: COLORS.warningText, bg: COLORS.warningBg },
  BEHAVIOR_ISSUE: { icon: "warning-outline", color: COLORS.errorText, bg: COLORS.errorBg },
  HEALTH_CONCERN: { icon: "medkit-outline", color: COLORS.errorText, bg: COLORS.errorBg },
  INCIDENT: { icon: "alert-circle-outline", color: COLORS.errorText, bg: COLORS.errorBg },
};

const TABS = [
  { key: "unresolved", label: "Sin resolver" },
  { key: "resolved", label: "Resueltas" },
];

type CategoryKey = "all" | "staff" | "evidence" | "vaccines";

type UnifiedAlert =
  | { kind: "staff"; id: string; data: AdminAlert }
  | {
      kind: "evidence";
      id: string;
      reservationId: string;
      petName: string;
      ownerName: string;
    }
  | {
      kind: "vaccine";
      id: string;
      vaccineName: string;
      petId: string;
      petName: string;
      ownerName: string;
      expiresAt: string;
    };

const CATEGORY_KEYS: CategoryKey[] = ["all", "staff", "evidence", "vaccines"];

export default function AdminAlerts() {
  const router = useRouter();
  const qc = useQueryClient();
  const { width: pageWidth } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<"unresolved" | "resolved">("unresolved");
  const [category, setCategory] = useState<CategoryKey>("all");
  const pagerRef = useRef<ScrollView>(null);
  // scrollX captura el offset horizontal del pager; un listener lo mapea
  // a tabProgress (0..3) para que el underline siga al dedo en tiempo real.
  const scrollX = useRef(new Animated.Value(0)).current;
  const tabProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pageWidth <= 0) return;
    const id = scrollX.addListener(({ value }) => {
      tabProgress.setValue(value / pageWidth);
    });
    return () => scrollX.removeListener(id);
  }, [pageWidth]);

  // Sincroniza el pager cuando cambia la categoría (tap en chip).
  useEffect(() => {
    const idx = CATEGORY_KEYS.indexOf(category);
    if (idx >= 0) {
      pagerRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
    }
  }, [category, pageWidth]);

  const onPagerMomentumEnd = (e: {
    nativeEvent: { contentOffset: { x: number } };
  }) => {
    if (pageWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    const next = CATEGORY_KEYS[idx];
    if (next && next !== category) setCategory(next);
  };

  const showResolved = activeTab === "resolved";

  const { data: staffAlerts, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "alerts", activeTab],
    queryFn: () => getAdminAlerts(showResolved),
    refetchInterval: 30_000,
  });

  // Las fuentes dinámicas (sin evidencia, vacunas) sólo aplican al tab
  // "Sin resolver". Se auto-resuelven cuando el problema subyacente se arregla.
  // Las cartillas pendientes viven en su propio panel, no aquí.
  const { data: stats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: getAdminStats,
    refetchInterval: 60_000,
    enabled: !showResolved,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveAdminAlert(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "alerts"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      Alert.alert("Listo", "Alerta marcada como resuelta");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  // Para el modo resuelto: lista única (no hay sub-categorías).
  const resolvedAlerts = useMemo<UnifiedAlert[]>(
    () =>
      (staffAlerts ?? []).map((a) => ({
        kind: "staff" as const,
        id: a.id,
        data: a,
      })),
    [staffAlerts],
  );

  // Para el modo sin resolver: una lista por cada categoría (para swipe).
  const alertsByCategory = useMemo<Record<CategoryKey, UnifiedAlert[]>>(() => {
    const staffItems: UnifiedAlert[] = (staffAlerts ?? []).map((a) => ({
      kind: "staff" as const,
      id: a.id,
      data: a,
    }));
    const evidenceItems: UnifiedAlert[] = (stats?.staysWithoutUpdates ?? []).map(
      (s) => ({
        kind: "evidence" as const,
        id: `evidence-${s.reservationId}`,
        reservationId: s.reservationId,
        petName: s.petName,
        ownerName: s.ownerName,
      }),
    );
    const vaccineItems: UnifiedAlert[] = (stats?.expiringVaccines ?? []).map(
      (v) => ({
        kind: "vaccine" as const,
        id: `vaccine-${v.id}`,
        vaccineName: v.name,
        petId: v.petId,
        petName: v.petName,
        ownerName: v.ownerName,
        expiresAt: v.expiresAt,
      }),
    );
    return {
      all: [...staffItems, ...evidenceItems, ...vaccineItems],
      staff: staffItems,
      evidence: evidenceItems,
      vaccines: vaccineItems,
    };
  }, [staffAlerts, stats]);

  // Counts por categoría para los chips.
  const counts = useMemo(
    () => ({
      staff: staffAlerts?.length ?? 0,
      evidence: stats?.staysWithoutUpdates.length ?? 0,
      vaccines: stats?.expiringVaccines.length ?? 0,
    }),
    [staffAlerts, stats]
  );
  const totalUnresolved = counts.staff + counts.evidence + counts.vaccines;

  const CATEGORIES: { key: CategoryKey; label: string; count: number }[] = [
    { key: "all", label: "Todas", count: totalUnresolved },
    { key: "staff", label: "Staff", count: counts.staff },
    { key: "evidence", label: "Sin evidencia", count: counts.evidence },
    { key: "vaccines", label: "Vacunas", count: counts.vaccines },
  ];

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const renderStaffAlert = (item: AdminAlert) => {
    const severity = SEVERITY_CONFIG[item.type] ?? SEVERITY_CONFIG.INCIDENT;
    const dateStr = new Date(item.createdAt).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <TouchableOpacity
        style={[styles.alertCard, { borderLeftColor: severity.color }]}
        activeOpacity={0.7}
        onPress={() => router.push(`/pet/incidents/${item.pet.id}` as any)}
      >
        <View style={styles.alertHeader}>
          <View style={[styles.alertIconWrap, { backgroundColor: severity.bg }]}>
            <Ionicons name={severity.icon as any} size={20} color={severity.color} />
          </View>
          <View style={styles.alertHeaderInfo}>
            <Text style={styles.alertType}>
              {ALERT_LABELS[item.type] ?? item.type}
            </Text>
            <Text style={styles.alertDate}>{dateStr}</Text>
          </View>
          {item.isResolved && item.resolvedAt && (
            <Text style={styles.resolvedLabel}>
              Resuelta{" "}
              {new Date(item.resolvedAt).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
              })}
            </Text>
          )}
        </View>

        <Text style={styles.alertDescription}>{item.description}</Text>

        {!item.isResolved && (
          <TouchableOpacity
            style={styles.resolveBtnFull}
            activeOpacity={0.85}
            onPress={(e) => {
              e.stopPropagation();
              Alert.alert("Resolver alerta", "¿Marcar como resuelta?", [
                { text: "Cancelar", style: "cancel" },
                {
                  text: "Resolver",
                  onPress: () => resolveMutation.mutate(item.id),
                },
              ]);
            }}
            disabled={resolveMutation.isPending}
          >
            <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
            <Text style={styles.resolveBtnFullText}>
              {resolveMutation.isPending && resolveMutation.variables === item.id
                ? "Resolviendo…"
                : "Marcar como resuelta"}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.alertMeta}>
          <View style={styles.metaChip}>
            <Ionicons name="paw" size={12} color={COLORS.primary} />
            <Text style={styles.metaText}>{formatName(item.pet.name)}</Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="person-outline" size={12} color={COLORS.textTertiary} />
            <Text style={styles.metaText}>
              {formatName(item.reservation.owner.firstName)}{" "}
              {formatName(item.reservation.owner.lastName)}
            </Text>
          </View>
          {item.reservation.room && (
            <View style={styles.metaChip}>
              <Ionicons name="bed-outline" size={12} color={COLORS.textTertiary} />
              <Text style={styles.metaText}>{item.reservation.room.name}</Text>
            </View>
          )}
          <View style={styles.metaChip}>
            <Ionicons name="person-circle-outline" size={12} color={COLORS.textTertiary} />
            <Text style={styles.metaText}>
              Staff: {formatName(item.staff.firstName)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSimpleAlert = (opts: {
    icon: string;
    color: string;
    bg: string;
    title: string;
    description: string;
    onPress: () => void;
    metaChips: { icon: string; text: string }[];
  }) => (
    <TouchableOpacity
      style={[styles.alertCard, { borderLeftColor: opts.color }]}
      activeOpacity={0.7}
      onPress={opts.onPress}
    >
      <View style={styles.alertHeader}>
        <View style={[styles.alertIconWrap, { backgroundColor: opts.bg }]}>
          <Ionicons name={opts.icon as any} size={20} color={opts.color} />
        </View>
        <View style={styles.alertHeaderInfo}>
          <Text style={styles.alertType}>{opts.title}</Text>
        </View>
      </View>
      <Text style={styles.alertDescription}>{opts.description}</Text>
      <View style={styles.alertMeta}>
        {opts.metaChips.map((c, i) => (
          <View key={i} style={styles.metaChip}>
            <Ionicons name={c.icon as any} size={12} color={COLORS.textTertiary} />
            <Text style={styles.metaText}>{c.text}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: UnifiedAlert }) => {
    if (item.kind === "staff") return renderStaffAlert(item.data);
    if (item.kind === "evidence") {
      return renderSimpleAlert({
        icon: "camera-outline",
        color: COLORS.errorText,
        bg: COLORS.errorBg,
        title: "Sin evidencia hoy",
        description: `${formatName(item.petName)} no tiene foto/video registrado hoy.`,
        onPress: () =>
          router.push(`/admin/reservation/${item.reservationId}` as any),
        metaChips: [
          { icon: "paw", text: formatName(item.petName) },
          { icon: "person-outline", text: formatName(item.ownerName) },
        ],
      });
    }
    // vaccine
    const expires = new Date(item.expiresAt).toLocaleDateString("es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return renderSimpleAlert({
      icon: "medical-outline",
      color: COLORS.warningText,
      bg: COLORS.warningBg,
      title: "Vacuna por vencer",
      description: `${item.vaccineName} de ${formatName(item.petName)} vence el ${expires}.`,
      onPress: () => router.push(`/pet/${item.petId}` as any),
      metaChips: [
        { icon: "paw", text: formatName(item.petName) },
        { icon: "person-outline", text: formatName(item.ownerName) },
        { icon: "calendar-outline", text: expires },
      ],
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key as "unresolved" | "resolved")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === t.key && styles.tabTextActive,
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!showResolved && (
        <FilterTabsUnderline
          tabs={CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: c.count }))}
          activeTab={category}
          onSelect={(key) => setCategory(key as CategoryKey)}
          justified
          progress={tabProgress}
        />
      )}

      {showResolved ? (
        <FlatList
          data={resolvedAlerts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons
                name="archive-outline"
                size={48}
                color={COLORS.border}
              />
              <Text style={styles.emptyText}>No hay alertas resueltas</Text>
            </View>
          }
        />
      ) : (
        <Animated.ScrollView
          ref={pagerRef as any}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onPagerMomentumEnd}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
          contentOffset={{
            x: Math.max(0, CATEGORY_KEYS.indexOf(category)) * pageWidth,
            y: 0,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {CATEGORY_KEYS.map((k) => (
            <View key={k} style={{ width: pageWidth }}>
              <FlatList
                data={alertsByCategory[k]}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                refreshControl={
                  <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                  />
                }
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={48}
                      color={COLORS.border}
                    />
                    <Text style={styles.emptyText}>
                      No hay alertas pendientes
                    </Text>
                  </View>
                }
              />
            </View>
          ))}
        </Animated.ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 14, fontWeight: "600", color: COLORS.textTertiary },
  tabTextActive: { color: COLORS.primary },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
    textAlign: "center",
  },
  alertCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  alertIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  alertHeaderInfo: {
    flex: 1,
  },
  alertType: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  alertDate: {
    fontSize: 12,
    color: COLORS.textDisabled,
    marginTop: 1,
  },
  resolveBtnFull: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.successText,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 2,
    marginBottom: 4,
  },
  resolveBtnFullText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "700",
  },
  resolvedLabel: {
    fontSize: 11,
    color: COLORS.successText,
    fontWeight: "600",
  },
  alertDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  alertMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
});
