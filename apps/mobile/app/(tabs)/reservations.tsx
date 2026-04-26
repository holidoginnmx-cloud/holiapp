import { COLORS } from "@/constants/colors";
import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Linking,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getReservations } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";
import { FilterTabsUnderline } from "@/components/FilterTabsUnderline";
import { buildWhatsappUrl } from "@/constants/business";
import type { ReservationListItem } from "@/lib/api";

type GroupedReservation = {
  id: string;
  groupId: string | null;
  petNames: string;
  roomNames: string | null;
  status: string;
  reservationType?: "STAY" | "BATH";
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
      petNames: items.map((i) => i.pet.name).join(", "),
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
    });
  }

  for (const r of singles) {
    result.push({
      id: r.id,
      groupId: null,
      petNames: r.pet.name,
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
    });
  }

  return result;
}

const TABS = [
  { key: "CHECKED_IN", label: "Activas" },
  { key: "CONFIRMED", label: "Confirmadas" },
  { key: "PENDING", label: "Pendientes" },
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
  PENDING: {
    icon: "time-outline",
    message: "No tienes solicitudes pendientes",
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
  PENDING: {
    icon: "time-outline",
    message: "No tienes solicitudes de baño pendientes",
  },
  history: {
    icon: "archive-outline",
    message: "Aún no tienes baños en tu historial",
    cta: "Reservar baño",
    ctaHref: "/bath/create",
  },
};

export default function ReservationsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState(tab ?? "CHECKED_IN");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("STAY");

  useFocusEffect(
    useCallback(() => {
      if (tab && tab !== activeTab) setActiveTab(tab);
    }, [tab])
  );

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

  const grouped = reservations ? groupReservations(reservations) : [];

  const byType = grouped.filter((r) => (r.reservationType ?? "STAY") === typeFilter);

  const tabCounts: Record<string, number> = {
    CHECKED_IN: byType.filter((r) => r.status === "CHECKED_IN").length,
    CONFIRMED: byType.filter((r) => r.status === "CONFIRMED").length,
    PENDING: byType.filter((r) => r.status === "PENDING").length,
    history: byType.filter(
      (r) => r.status === "CHECKED_OUT" || r.status === "CANCELLED"
    ).length,
  };
  const tabsWithCounts = TABS.map((t) => ({ ...t, count: tabCounts[t.key] ?? 0 }));

  const filtered = byType.filter((r) => {
    if (activeTab === "history")
      return r.status === "CHECKED_OUT" || r.status === "CANCELLED";
    return r.status === activeTab;
  });

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
        <Text style={styles.errorText}>Error al cargar reservaciones</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const emptyState =
    typeFilter === "BATH" ? EMPTY_STATES_BATH[activeTab] : EMPTY_STATES[activeTab];

  return (
    <View style={styles.container} testID="reservations-screen">
      {/* Action buttons */}
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push("/reservation/create")}
          activeOpacity={0.8}
          testID="reservations-new-button"
        >
          <Ionicons name="add-circle" size={18} color={COLORS.white} />
          <Text style={styles.primaryButtonText}>Nueva reservación</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.whatsappButton}
          onPress={() => Linking.openURL(buildWhatsappUrl())}
          activeOpacity={0.8}
          testID="reservations-whatsapp-button"
        >
          <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
          <Text style={styles.whatsappButtonText}>WhatsApp</Text>
        </TouchableOpacity>
      </View>

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
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.groupId ?? item.id}
        renderItem={({ item }) => (
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
            onPress={() => {
              router.push(`/(tabs)/reservation/${item.id}` as any);
            }}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons
              name={emptyState?.icon ?? "calendar-outline"}
              size={48}
              color={COLORS.border}
            />
            <Text style={styles.emptyText}>
              {emptyState?.message ?? "No tienes reservaciones en esta categoría"}
            </Text>
            {emptyState?.cta && (
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() =>
                  router.push((emptyState.ctaHref ?? "/reservation/create") as any)
                }
              >
                <Text style={styles.emptyButtonText}>{emptyState.cta}</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.white,
  },
  whatsappButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#25D366",
    borderRadius: 10,
    paddingVertical: 12,
  },
  whatsappButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.white,
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
    marginTop: 12,
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
    paddingBottom: 32,
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
