import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ReservationCard } from "./ReservationCard";

// ─── Status → dot color ──────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  PENDING: COLORS.warningText,
  CONFIRMED: COLORS.infoText,
  CHECKED_IN: COLORS.successText,
  CHECKED_OUT: COLORS.textDisabled,
  CANCELLED: COLORS.errorText,
};

const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ─── Types ───────────────────────────────────────────────
export interface CalendarReservation {
  id: string;
  checkIn: string | Date;
  checkOut: string | Date;
  status: string;
  totalAmount: number | string;
  pet: { id: string; name: string; breed?: string; photoUrl?: string | null };
  room: { id: string; name: string } | null;
  owner?: { id: string; firstName: string; lastName: string };
  staff?: { id: string; firstName: string; lastName: string } | null;
  checklists?: { date: string | Date }[];
}

interface Props {
  reservations: CalendarReservation[];
  onPressReservation: (id: string) => void;
  showOwnerName?: boolean;
  showStaffName?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateInRange(day: Date, checkIn: Date, checkOut: Date): boolean {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const ci = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate()).getTime();
  const co = new Date(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate()).getTime();
  return d >= ci && d <= co;
}

function formatTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

// ─── Component ───────────────────────────────────────────
export function CalendarView({
  reservations,
  onPressReservation,
  showOwnerName = false,
  showStaffName = false,
  refreshing = false,
  onRefresh,
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(toDateKey(today));

  // Navigate months
  const goBack = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const goForward = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(toDateKey(today));
  };

  // Build calendar grid
  const { cells, dayMap, checklistDays } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Map: dateKey → reservations on that day
    const map: Record<string, CalendarReservation[]> = {};
    // Track which days have checklists for active stays
    const checklistDays = new Set<string>();
    for (const r of reservations) {
      const ci = new Date(r.checkIn);
      const co = new Date(r.checkOut);
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(year, month, d);
        if (dateInRange(day, ci, co)) {
          const key = toDateKey(day);
          if (!map[key]) map[key] = [];
          map[key].push(r);
        }
      }
      // Mark days with completed checklists
      if (r.checklists) {
        for (const c of r.checklists) {
          checklistDays.add(toDateKey(new Date(c.date)));
        }
      }
    }

    // Build grid cells (nulls for offset)
    const grid: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) grid.push(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(d);

    return { cells: grid, dayMap: map, checklistDays };
  }, [year, month, reservations]);

  // Reservations for selected day
  const selectedReservations = dayMap[selectedDate] ?? [];

  const todayKey = toDateKey(today);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        ) : undefined
      }
    >
      {/* ── Month Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToday}>
          <Text style={styles.monthTitle}>
            {MONTH_NAMES[month]} {year}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goForward} hitSlop={12}>
          <Ionicons name="chevron-forward" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* ── Weekday Headers ── */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={styles.weekCell}>
            <Text style={[styles.weekText, i === 0 && styles.weekendText]}>
              {d}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Day Grid ── */}
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) {
            return <View key={`empty-${i}`} style={styles.dayCell} />;
          }

          const key = toDateKey(new Date(year, month, day));
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          const dayReservations = dayMap[key] ?? [];

          // Unique status colors for dots (max 3)
          const dots = [
            ...new Set(dayReservations.map((r) => STATUS_DOT[r.status]).filter(Boolean)),
          ].slice(0, 3);

          // Checklist indicator: has active stays on this day?
          const hasActiveStays = dayReservations.some((r) => r.status === "CHECKED_IN");
          const hasChecklist = checklistDays.has(key);
          const dayIsInPast = new Date(year, month, day).getTime() < today.getTime();
          // Show checkmark if checklist done, warning if active stay with no checklist (past/today only)
          const showChecklistIcon = hasActiveStays && (dayIsInPast || key === todayKey);

          return (
            <TouchableOpacity
              key={key}
              style={styles.dayCell}
              onPress={() => setSelectedDate(key)}
              activeOpacity={0.6}
            >
              <View
                style={[
                  styles.dayNumber,
                  isToday && styles.todayCircle,
                  isSelected && styles.selectedCircle,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    isToday && !isSelected && styles.todayText,
                    isSelected && styles.selectedText,
                  ]}
                >
                  {day}
                </Text>
              </View>
              <View style={styles.dotsRow}>
                {dots.map((color, di) => (
                  <View
                    key={di}
                    style={[styles.dot, { backgroundColor: color }]}
                  />
                ))}
                {showChecklistIcon && (
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: hasChecklist
                          ? COLORS.successText
                          : COLORS.warningText,
                        width: 7,
                        height: 7,
                        borderRadius: 3.5,
                      },
                    ]}
                  />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Legend ── */}
      <View style={styles.legend}>
        {Object.entries(STATUS_DOT).map(([status, color]) => (
          <View key={status} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>
              {status === "PENDING" ? "Pendiente" :
               status === "CONFIRMED" ? "Confirmada" :
               status === "CHECKED_IN" ? "Hospedado" :
               status === "CHECKED_OUT" ? "Finalizada" : "Cancelada"}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Selected Day Reservations ── */}
      <View style={styles.dayList}>
        <Text style={styles.dayListTitle}>
          {selectedDate === todayKey
            ? "Hoy"
            : new Date(selectedDate + "T12:00:00").toLocaleDateString("es-MX", {
                day: "numeric",
                month: "long",
              })}
          {" "}
          <Text style={styles.dayListCount}>
            ({selectedReservations.length})
          </Text>
        </Text>

        {selectedReservations.length === 0 ? (
          <Text style={styles.emptyDay}>Sin reservaciones este día</Text>
        ) : (
          selectedReservations.map((r) => (
            <ReservationCard
              key={r.id}
              petName={r.pet.name}
              roomName={r.room?.name ?? null}
              status={r.status}
              checkIn={r.checkIn}
              checkOut={r.checkOut}
              totalAmount={Number(r.totalAmount)}
              ownerName={
                showOwnerName && r.owner
                  ? `${r.owner.firstName} ${r.owner.lastName}`
                  : undefined
              }
              staffName={
                showStaffName
                  ? r.staff
                    ? `${r.staff.firstName} ${r.staff.lastName}`
                    : null
                  : undefined
              }
              onPress={() => onPressReservation(r.id)}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────
const DAY_SIZE = 40;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  // Weekday row
  weekRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  weekCell: {
    flex: 1,
    alignItems: "center",
  },
  weekText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  weekendText: {
    color: COLORS.errorText,
  },
  // Grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
  },
  dayCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 4,
    minHeight: DAY_SIZE + 12,
  },
  dayNumber: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderRadius: DAY_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  todayCircle: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  todayText: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  selectedCircle: {
    backgroundColor: COLORS.primary,
  },
  selectedText: {
    color: COLORS.white,
    fontWeight: "700",
  },
  // Dots
  dotsRow: {
    flexDirection: "row",
    gap: 3,
    marginTop: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // Legend
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  // Day list
  dayList: {
    padding: 16,
  },
  dayListTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  dayListCount: {
    fontWeight: "400",
    color: COLORS.textTertiary,
  },
  emptyDay: {
    fontSize: 14,
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingVertical: 24,
  },
});
