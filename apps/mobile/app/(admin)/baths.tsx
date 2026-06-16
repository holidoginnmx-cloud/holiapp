import { COLORS } from "@/constants/colors";
import { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
  Dimensions,
  PanResponder,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStaffBaths, type StaffBath } from "@/lib/api";
import { formatName } from "@/lib/format";
import { ReservationCard } from "@/components/ReservationCard";
import { FilterTabsUnderline } from "@/components/FilterTabsUnderline";
import { ErrorState } from "@/components/ErrorState";

type BathTypeFilter = "loose" | "stay";

const TZ_OFFSET_HOURS = 7; // Hermosillo UTC-7

function localYMD(value: string | Date): string {
  const d = new Date(value);
  const local = new Date(d.getTime() - TZ_OFFSET_HOURS * 3600 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function todayYMD(): string {
  return localYMD(new Date());
}

function formatDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const today = todayYMD();
  const diffDays = Math.round(
    (date.getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) /
      (24 * 3600 * 1000),
  );
  const label = date.toLocaleDateString("es-MX", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (diffDays === 0) return `Hoy · ${label}`;
  if (diffDays === 1) return `Mañana · ${label}`;
  return label;
}

function getBathAddon(bath: StaffBath) {
  return bath.addons.find((a) => a.variant?.serviceType?.code === "BATH");
}

function isBathDone(bath: StaffBath): boolean {
  if (bath.reservationType === "BATH") return bath.status === "CHECKED_OUT";
  return !!getBathAddon(bath)?.completedAt;
}

type Row =
  | { type: "header"; title: string; count: number }
  | { type: "item"; bath: StaffBath };

function buildRows(baths: StaffBath[]): Row[] {
  const pending = baths.filter((b) => !isBathDone(b));
  const done = baths.filter((b) => isBathDone(b));
  const out: Row[] = [];
  const byDay = new Map<string, StaffBath[]>();
  for (const b of pending) {
    const ymd = b.appointmentAt ? localYMD(b.appointmentAt) : "—";
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd)!.push(b);
  }
  const sortedDays = Array.from(byDay.keys()).sort();
  for (const ymd of sortedDays) {
    const items = byDay.get(ymd)!;
    out.push({
      type: "header",
      title: formatDayHeader(ymd),
      count: items.length,
    });
    for (const b of items) out.push({ type: "item", bath: b });
  }
  if (done.length > 0) {
    out.push({ type: "header", title: "Completados", count: done.length });
    for (const b of done) out.push({ type: "item", bath: b });
  }
  return out;
}

export default function AdminBaths() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<BathTypeFilter>("loose");
  const typeFilterRef = useRef<BathTypeFilter>(typeFilter);
  typeFilterRef.current = typeFilter;

  // Animated.Value para sincronizar underline + contenido durante el swipe.
  const tabProgress = useRef(new Animated.Value(0)).current;
  const [contentWidth, setContentWidth] = useState(
    Dimensions.get("window").width,
  );
  const contentWidthRef = useRef(contentWidth);
  contentWidthRef.current = contentWidth;

  function snapToTab(target: BathTypeFilter) {
    Animated.spring(tabProgress, {
      toValue: target === "loose" ? 0 : 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start();
  }

  function selectTab(target: BathTypeFilter) {
    if (target !== typeFilterRef.current) setTypeFilter(target);
    snapToTab(target);
  }

  const swipePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
      },
      onPanResponderMove: (_e, g) => {
        const w = contentWidthRef.current;
        if (w <= 0) return;
        const base = typeFilterRef.current === "loose" ? 0 : 1;
        const next = Math.max(0, Math.min(1, base + -g.dx / w));
        tabProgress.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const threshold = 50;
        let target = typeFilterRef.current;
        if (g.dx <= -threshold && typeFilterRef.current === "loose") {
          target = "stay";
        } else if (g.dx >= threshold && typeFilterRef.current === "stay") {
          target = "loose";
        }
        selectTab(target);
      },
      onPanResponderTerminate: () => {
        snapToTab(typeFilterRef.current);
      },
    }),
  ).current;

  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["admin-baths", "upcoming"],
    queryFn: () => getStaffBaths(),
    refetchInterval: 60_000,
  });

  const allBaths = data?.baths ?? [];

  const counts = useMemo(() => {
    return {
      loose: allBaths.filter((b) => b.reservationType === "BATH").length,
      stay: allBaths.filter((b) => b.reservationType === "STAY").length,
    };
  }, [allBaths]);

  const looseBaths = useMemo(
    () => allBaths.filter((b) => b.reservationType === "BATH"),
    [allBaths],
  );
  const stayBaths = useMemo(
    () => allBaths.filter((b) => b.reservationType === "STAY"),
    [allBaths],
  );
  const activeBaths = typeFilter === "loose" ? looseBaths : stayBaths;
  const pending = useMemo(
    () => activeBaths.filter((b) => !isBathDone(b)),
    [activeBaths],
  );
  const revenue = useMemo(
    () => activeBaths.reduce((sum, b) => sum + Number(b.totalAmount), 0),
    [activeBaths],
  );

  const rowsLoose = useMemo(() => buildRows(looseBaths), [looseBaths]);
  const rowsStay = useMemo(() => buildRows(stayBaths), [stayBaths]);


  const renderBath = ({ item }: { item: StaffBath }) => {
    const bathAddon = getBathAddon(item);
    const hasDeslanado = bathAddon?.variant?.deslanado ?? false;
    const hasCorte = bathAddon?.variant?.corte ?? false;

    return (
      <View testID={`admin-bath-${item.id}`} style={styles.bathBlock}>
        <ReservationCard
          petName={item.pet.name}
          roomName={null}
          status={item.status}
          checkIn={item.checkIn}
          checkOut={item.checkOut}
          reservationType={item.reservationType}
          appointmentAt={item.appointmentAt}
          totalAmount={Number(item.totalAmount)}
          ownerName={`${item.owner.firstName} ${item.owner.lastName}`}
          paymentType={item.paymentType}
          hasBalance={false}
          hasReview={(item as any).hasReview}
          reviewRating={(item as any).reviewRating}
          adminView
          hasDeslanado={hasDeslanado}
          hasCorte={hasCorte}
          onPress={() => router.push(`/admin/reservation/${item.id}` as any)}
        />
      </View>
    );
  };


  return (
    <View style={styles.container}>
      {/* Top bar con título y resumen */}
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Próximos baños</Text>
        <Text style={styles.topSub}>
          {pending.length} pendiente{pending.length === 1 ? "" : "s"}
          {" · "}
          ${revenue.toLocaleString("es-MX")} en total
        </Text>
      </View>

      {/* Filtro por tipo con underline animado */}
      <FilterTabsUnderline
        tabs={[
          { key: "loose", label: "Suelto", count: counts.loose },
          { key: "stay", label: "Hospedaje", count: counts.stay },
        ]}
        activeTab={typeFilter}
        onSelect={(k) => selectTab(k as BathTypeFilter)}
        justified
        progress={tabProgress}
      />

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <View
          style={styles.swipeWrap}
          onLayout={(e) => setContentWidth(e.nativeEvent.layout.width)}
          {...swipePan.panHandlers}
        >
          <Animated.View
            style={[
              styles.swipeTrack,
              {
                width: contentWidth * 2,
                transform: [
                  {
                    translateX: tabProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -contentWidth],
                      extrapolate: "clamp",
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={{ width: contentWidth }}>
              <FlatList<Row>
                data={rowsLoose}
                keyExtractor={(item, i) =>
                  item.type === "item" ? item.bath.id : `${item.type}-${i}`
                }
                renderItem={({ item }) => {
                  if (item.type === "header") {
                    return (
                      <Text style={styles.sectionHeader}>
                        {item.title} · {item.count}
                      </Text>
                    );
                  }
                  return renderBath({ item: item.bath });
                }}
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyCard}>
                    <Ionicons name="water-outline" size={32} color={COLORS.border} />
                    <Text style={styles.emptyText}>No hay baños sueltos</Text>
                  </View>
                }
              />
            </View>
            <View style={{ width: contentWidth }}>
              <FlatList<Row>
                data={rowsStay}
                keyExtractor={(item, i) =>
                  item.type === "item" ? item.bath.id : `${item.type}-${i}`
                }
                renderItem={({ item }) => {
                  if (item.type === "header") {
                    return (
                      <Text style={styles.sectionHeader}>
                        {item.title} · {item.count}
                      </Text>
                    );
                  }
                  return renderBath({ item: item.bath });
                }}
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
                }
                ListEmptyComponent={
                  <View style={styles.emptyCard}>
                    <Ionicons name="water-outline" size={32} color={COLORS.border} />
                    <Text style={styles.emptyText}>No hay baños de hospedaje</Text>
                  </View>
                }
              />
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  topSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
  swipeWrap: { flex: 1, overflow: "hidden" },
  swipeTrack: { flex: 1, flexDirection: "row" },
  listContent: { padding: 16, paddingBottom: 40 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  bathBlock: {
    marginBottom: 4,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: -4,
    marginBottom: 12,
  },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  callBtnText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 13, color: COLORS.textDisabled },
});
