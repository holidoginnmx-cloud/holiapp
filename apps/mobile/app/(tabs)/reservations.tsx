import { COLORS } from "@/constants/colors";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Linking,
  ScrollView,
  useWindowDimensions,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getReservations } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";
import { FilterTabsUnderline } from "@/components/FilterTabsUnderline";
import { SkeletonList } from "@/components/Skeleton";
import { buildWhatsappUrl } from "@/constants/business";
import type { ReservationListItem } from "@/lib/api";

type GroupedReservation = {
  id: string;
  groupId: string | null;
  petNames: string;
  roomNames: string | null;
  status: string;
  reservationType?: "STAY" | "BATH" | "DAYCARE";
  appointmentAt?: string | Date | null;
  checkIn: string | Date | null;
  checkOut: string | Date | null;
  totalAmount: number;
  reservationIds: string[];
  petCount: number;
  paymentType: string | null;
  hasBalance: boolean;
  hasPendingChangeRequest: boolean;
  lastUpdateAt: string | null;
  hasReview: boolean;
  reviewRating: number | null;
  hasDeslanado: boolean;
  hasCorte: boolean;
};

function groupReservations(list: ReservationListItem[]): GroupedReservation[] {
  const groups = new Map<string, ReservationListItem[]>();
  const singles: ReservationListItem[] = [];

  for (const r of list) {
    if (r.groupId) {
      const existing = groups.get(r.groupId) || [];
      existing.push(r);
      groups.set(r.groupId, existing);
    } else {
      singles.push(r);
    }
  }

  const result: GroupedReservation[] = [];

  for (const [groupId, items] of groups) {
    const updateDates = items
      .map((i) => i.lastUpdateAt)
      .filter(Boolean) as string[];

    result.push({
      id: items[0].id,
      groupId,
      petNames: items.map((i) => i.pet?.name ?? "—").join(", "),
      roomNames:
        [...new Set(items.map((i) => i.room?.name).filter(Boolean))].join(", ") || null,
      status: items[0].status,
      checkIn: items[0].checkIn,
      checkOut: items[0].checkOut,
      totalAmount: items.reduce((sum, i) => sum + Number(i.totalAmount), 0),
      reservationIds: items.map((i) => i.id),
      petCount: items.length,
      paymentType: items[0].paymentType,
      reservationType: items[0].reservationType,
      hasBalance: items.some((i) => i.hasBalance),
      hasPendingChangeRequest: items.some((i) => i.hasPendingChangeRequest),
      lastUpdateAt: updateDates.sort().reverse()[0] ?? null,
      hasReview: items.every((i) => i.hasReview),
      reviewRating: (() => {
        const ratings = items
          .map((i) => i.reviewRating)
          .filter((r): r is number => typeof r === "number");
        if (ratings.length === 0) return null;
        return Math.round(
          ratings.reduce((sum, r) => sum + r, 0) / ratings.length
        );
      })(),
      hasDeslanado: items.some((i) => i.hasDeslanado),
      hasCorte: items.some((i) => i.hasCorte),
    });
  }

  for (const r of singles) {
    result.push({
      id: r.id,
      groupId: null,
      petNames: r.pet?.name ?? "—",
      roomNames: r.room?.name ?? null,
      status: r.status,
      reservationType: r.reservationType,
      appointmentAt: r.appointmentAt,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      totalAmount: Number(r.totalAmount),
      reservationIds: [r.id],
      petCount: 1,
      paymentType: r.paymentType,
      hasBalance: r.hasBalance,
      hasPendingChangeRequest: r.hasPendingChangeRequest,
      lastUpdateAt: r.lastUpdateAt,
      hasReview: r.hasReview,
      reviewRating: r.reviewRating,
      hasDeslanado: r.hasDeslanado,
      hasCorte: r.hasCorte,
    });
  }

  return result;
}

const TABS = [
  { key: "CHECKED_IN", label: "Activas" },
  { key: "CONFIRMED", label: "Confirmadas" },
  { key: "history", label: "Historial" },
];

type TypeFilter = "STAY" | "BATH";

const TYPE_FILTERS: { key: TypeFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "STAY", label: "Hotel", icon: "bed-outline" },
  { key: "BATH", label: "Baños", icon: "water-outline" },
];

type EmptyState = {
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
  cta?: string;
  ctaHref?: string;
};

const EMPTY_STATES: Record<string, EmptyState> = {
  CHECKED_IN: {
    icon: "paw-outline",
    message: "No tienes peludos hospedados ahora mismo",
    cta: "Reservar ahora",
  },
  CONFIRMED: {
    icon: "calendar-outline",
    message: "No tienes reservaciones confirmadas por el momento",
    cta: "Nueva reservación",
  },
  history: {
    icon: "archive-outline",
    message: "Aún no tienes estancias en tu historial",
    cta: "Reservar primera estancia",
  },
};

const EMPTY_STATES_BATH: Record<string, EmptyState> = {
  CHECKED_IN: {
    icon: "water-outline",
    message: "No hay baños en proceso ahora mismo",
  },
  CONFIRMED: {
    icon: "water-outline",
    message: "No tienes citas de baño confirmadas",
    cta: "Reservar baño",
    ctaHref: "/bath/create",
  },
  history: {
    icon: "archive-outline",
    message: "Aún no tienes baños en tu historial",
    cta: "Reservar baño",
    ctaHref: "/bath/create",
  },
};

// Fila memoizada: la closure de onPress solo cambia si cambia el item, así el
// memo de ReservationCard sí evita re-renders al scrollear/cambiar de tab.
const ReservationRow = memo(function ReservationRow({
  item,
  onPressItem,
}: {
  item: GroupedReservation;
  onPressItem: (id: string) => void;
}) {
  return (
    <ReservationCard
      petName={item.petNames}
      roomName={item.roomNames}
      status={item.status}
      checkIn={item.checkIn}
      checkOut={item.checkOut}
      reservationType={item.reservationType}
      appointmentAt={item.appointmentAt}
      totalAmount={item.totalAmount}
      petCount={item.petCount}
      paymentType={item.paymentType}
      hasBalance={item.hasBalance}
      hasPendingChangeRequest={item.hasPendingChangeRequest}
      lastUpdateAt={item.lastUpdateAt}
      hasReview={item.hasReview}
      reviewRating={item.reviewRating}
      hasDeslanado={item.hasDeslanado}
      hasCorte={item.hasCorte}
      onPress={() => onPressItem(item.id)}
    />
  );
});

const filterByTab = (list: GroupedReservation[], tabKey: string) =>
  list.filter((r) =>
    tabKey === "history"
      ? r.status === "CHECKED_OUT" || r.status === "CANCELLED"
      : r.status === tabKey
  );

export default function ReservationsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const { width: pageWidth } = useWindowDimensions();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState(tab ?? "CHECKED_IN");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("STAY");
  const pagerRef = useRef<ScrollView>(null);
  // Sigue al pager scroll para que el underline siga al dedo en tiempo real.
  const scrollX = useRef(new Animated.Value(0)).current;

  // Progreso del underline derivado en el árbol de Animated (0..tabs-1) —
  // antes un listener JS corría en CADA frame de scroll haciendo setValue.
  const tabProgress = useMemo(
    () => Animated.divide(scrollX, new Animated.Value(Math.max(1, pageWidth))),
    [scrollX, pageWidth]
  );

  useFocusEffect(
    useCallback(() => {
      if (tab && tab !== activeTab) setActiveTab(tab);
    }, [tab])
  );

  // Sincroniza el pager cuando cambia activeTab (tap en pestaña o param de URL).
  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === activeTab);
    if (idx >= 0) {
      pagerRef.current?.scrollTo({ x: idx * pageWidth, animated: true });
    }
  }, [activeTab, pageWidth]);

  const onPagerMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    const next = TABS[idx]?.key;
    if (next && next !== activeTab) setActiveTab(next);
  };

  const {
    data: reservations,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["reservations", userId],
    queryFn: () => getReservations({ ownerId: userId! }),
    enabled: !!userId,
  });

  // Derivados memoizados: antes se recalculaban (agrupar, filtrar 4 veces,
  // contar) en CADA render de la pantalla.
  const grouped = useMemo(
    () => (reservations ? groupReservations(reservations) : []),
    [reservations]
  );

  const byType = useMemo(
    () => grouped.filter((r) => (r.reservationType ?? "STAY") === typeFilter),
    [grouped, typeFilter]
  );

  const pages = useMemo(
    () => TABS.map((t) => filterByTab(byType, t.key)),
    [byType]
  );

  const tabsWithCounts = useMemo(
    () => TABS.map((t, i) => ({ ...t, count: pages[i]?.length ?? 0 })),
    [pages]
  );

  const onPressItem = useCallback(
    (id: string) => {
      router.push(`/reservation/detail/${id}?from=reservations` as any);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: GroupedReservation }) => (
      <ReservationRow item={item} onPressItem={onPressItem} />
    ),
    [onPressItem]
  );

  if (isLoading) {
    return (
      <View style={styles.container} testID="reservations-screen">
        <SkeletonList count={5} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Error al cargar reservaciones</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const emptyStateFor = (tabKey: string) =>
    typeFilter === "BATH" ? EMPTY_STATES_BATH[tabKey] : EMPTY_STATES[tabKey];

  return (
    <View style={styles.container} testID="reservations-screen">
      {/* Type filter (segmented control) */}
      <View style={styles.segmentedControl}>
        {TYPE_FILTERS.map((opt) => {
          const active = typeFilter === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setTypeFilter(opt.key)}
              activeOpacity={0.7}
            >
              {opt.icon && (
                <Ionicons
                  name={opt.icon}
                  size={14}
                  color={active ? COLORS.primary : COLORS.textTertiary}
                />
              )}
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Status filter (underline tabs) */}
      <View style={styles.underlineFilterWrap}>
        <FilterTabsUnderline
          tabs={tabsWithCounts}
          activeTab={activeTab}
          onSelect={setActiveTab}
          justified
          progress={tabProgress}
        />
      </View>

      {/* Pager con swipe horizontal entre los 3 tabs */}
      <Animated.ScrollView
        ref={pagerRef as any}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerMomentumEnd}
        // Captura el offset horizontal en scrollX; un listener mapea a
        // tabProgress (0..tabs.length-1) para el underline.
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        scrollEventThrottle={16}
        // Arrancar en la página del tab activo sin animar.
        contentOffset={{
          x:
            Math.max(0, TABS.findIndex((t) => t.key === activeTab)) * pageWidth,
          y: 0,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {TABS.map((t, idx) => {
          const pageData = pages[idx];
          const empty = emptyStateFor(t.key);
          return (
            <View key={t.key} style={{ width: pageWidth }}>
              <FlatList
                data={pageData}
                keyExtractor={(item) => item.groupId ?? item.id}
                renderItem={renderItem}
                initialNumToRender={6}
                maxToRenderPerBatch={8}
                windowSize={5}
                contentContainerStyle={styles.list}
                refreshControl={
                  <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                  />
                }
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons
                      name={empty?.icon ?? "calendar-outline"}
                      size={48}
                      color={COLORS.border}
                    />
                    <Text style={styles.emptyText}>
                      {empty?.message ??
                        "No tienes reservaciones en esta categoría"}
                    </Text>
                    {empty?.cta && (
                      <TouchableOpacity
                        style={styles.emptyButton}
                        onPress={() =>
                          router.push(
                            (empty.ctaHref ?? "/reservation/create") as any
                          )
                        }
                      >
                        <Text style={styles.emptyButtonText}>{empty.cta}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                }
              />
            </View>
          );
        })}
      </Animated.ScrollView>

      {/* FAB WhatsApp */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => Linking.openURL(buildWhatsappUrl())}
        activeOpacity={0.85}
        testID="reservations-whatsapp-button"
        accessibilityLabel="Escríbenos por WhatsApp"
      >
        <Ionicons name="logo-whatsapp" size={28} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.whatsapp,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  underlineFilterWrap: {
    marginTop: 8,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: COLORS.bgSection,
    borderRadius: 10,
    padding: 3,
    marginHorizontal: 16,
    marginTop: 16,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 7,
  },
  segmentActive: {
    backgroundColor: COLORS.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  segmentTextActive: {
    color: COLORS.textPrimary,
    fontWeight: "700",
  },
  list: {
    padding: 16,
    paddingBottom: 96,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  emptyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  emptyButtonText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 14,
  },
  errorText: {
    fontSize: 16,
    color: COLORS.dangerText,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 14,
  },
});
