import { COLORS } from "@/constants/colors";
import { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getStaffDaycares, type StaffDaycare } from "@/lib/api";
import { formatCurrency, formatWeekdayDayShort } from "@/lib/format";
import { ReservationCard } from "@/components/ReservationCard";
import { ErrorState } from "@/components/ErrorState";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";

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
  const label = formatWeekdayDayShort(date, { timeZone: "UTC" });
  if (diffDays === 0) return `Hoy · ${label}`;
  if (diffDays === 1) return `Mañana · ${label}`;
  return label;
}

// Saldo pendiente = total − pagos PAID.
function balanceOf(d: StaffDaycare): number {
  const paid = d.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return Math.max(0, Number(d.totalAmount) - paid);
}

function isConcluded(d: StaffDaycare): boolean {
  return d.status === "CHECKED_OUT";
}

type Row =
  | { type: "header"; title: string; count: number }
  | { type: "item"; daycare: StaffDaycare };

// Pendientes agrupados por día (Hermosillo); concluidos al final.
function buildRows(daycares: StaffDaycare[]): Row[] {
  const pending = daycares.filter((d) => !isConcluded(d));
  const done = daycares.filter(isConcluded);
  const out: Row[] = [];
  const byDay = new Map<string, StaffDaycare[]>();
  for (const d of pending) {
    const ymd = d.appointmentAt ? localYMD(d.appointmentAt) : "—";
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd)!.push(d);
  }
  for (const ymd of Array.from(byDay.keys()).sort()) {
    const items = byDay.get(ymd)!;
    out.push({ type: "header", title: formatDayHeader(ymd), count: items.length });
    for (const d of items) out.push({ type: "item", daycare: d });
  }
  if (done.length > 0) {
    out.push({ type: "header", title: "Concluidas", count: done.length });
    for (const d of done) out.push({ type: "item", daycare: d });
  }
  return out;
}

export default function StaffDaycares() {
  const router = useRouter();
  const { isTablet } = useResponsive();

  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["staff-daycares", "upcoming"],
    queryFn: () => getStaffDaycares(),
    refetchInterval: 60_000,
  });

  const daycares = data?.daycares ?? [];
  const pending = useMemo(() => daycares.filter((d) => !isConcluded(d)), [daycares]);
  const revenue = useMemo(
    () => daycares.reduce((sum, d) => sum + Number(d.totalAmount), 0),
    [daycares],
  );
  const rows = useMemo(() => buildRows(daycares), [daycares]);

  const renderItem = ({ item }: { item: Row }) => {
    if (item.type === "header") {
      return (
        <Text style={styles.sectionHeader}>
          {item.title} · {item.count}
        </Text>
      );
    }
    const d = item.daycare;
    const balance = balanceOf(d);
    return (
      <View style={styles.block}>
        <ReservationCard
          petName={d.pet?.name ?? "—"}
          roomName={null}
          status={d.status}
          reservationType="DAYCARE"
          appointmentAt={d.appointmentAt}
          checkInTime={d.checkInTime}
          checkOutTime={d.checkOutTime}
          totalAmount={Number(d.totalAmount)}
          ownerName={
            `${d.owner?.firstName ?? ""} ${d.owner?.lastName ?? ""}`.trim() ||
            "Sin dueño"
          }
          paymentType={d.paymentType}
          hasBalance={balance > 0}
          onPress={() => router.push(`/staff/daycare/${d.id}` as any)}
        />
        {balance > 0 && !isConcluded(d) && (
          <View style={styles.balanceRow}>
            <Ionicons name="cash-outline" size={13} color={COLORS.warningText} />
            <Text style={styles.balanceText}>
              Saldo pendiente {formatCurrency(balance)}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Guardería</Text>
        <Text style={styles.topSub}>
          {pending.length} pendiente{pending.length === 1 ? "" : "s"}
          {" · "}
          {formatCurrency(revenue)} en total
        </Text>
      </View>

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList<Row>
          data={rows}
          keyExtractor={(item, i) =>
            item.type === "item" ? item.daycare.id : `${item.type}-${i}`
          }
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            isTablet && { maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", width: "100%" },
          ]}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="sunny-outline" size={32} color={COLORS.border} />
              <Text style={styles.emptyText}>No hay guarderías próximas</Text>
            </View>
          }
        />
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
  topTitle: { fontSize: 17, fontWeight: "800", color: COLORS.textPrimary },
  topSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
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
  block: { marginBottom: 4 },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.warningBg,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: -4,
    marginBottom: 8,
  },
  balanceText: { fontSize: 12, fontWeight: "700", color: COLORS.warningText },
  emptyCard: { alignItems: "center", padding: 24, gap: 8 },
  emptyText: { fontSize: 13, color: COLORS.textDisabled },
});
