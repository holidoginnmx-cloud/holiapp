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
  checkIn: string | Date | null;
  checkOut: string | Date | null;
  status: string;
  totalAmount: number | string;
  reservationType?: "STAY" | "BATH" | "DAYCARE";
  appointmentAt?: string | Date | null;
  paymentType?: string | null;
  hasBalance?: boolean;
  hasPendingChangeRequest?: boolean;
  lastUpdateAt?: string | null;
  hasReview?: boolean;
  reviewRating?: number | null;
  hasDeslanado?: boolean;
  hasCorte?: boolean;
  /** Hospedaje que incluye un baño (servicio en el checkout). */
  hasBath?: boolean;
  pet: { id: string; name: string; breed?: string | null; photoUrl?: string | null };
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
  /** Si true, las cards se pintan en modo admin (reemplaza "Deja tu reseña" por "Aún sin reseña"). */
  adminView?: boolean;
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
  adminView = false,
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
  const { cells, dayMap } = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Map: dateKey → reservations on that day
    const map: Record<string, CalendarReservation[]> = {};
    for (const r of reservations) {
      // Baño: aparece sólo en el día de la cita.
      if (r.reservationType === "BATH") {
        if (!r.appointmentAt) continue;
        const apt = new Date(r.appointmentAt);
        if (apt.getFullYear() === year && apt.getMonth() === month) {
          const key = toDateKey(apt);
          if (!map[key]) map[key] = [];
          map[key].push(r);
        }
        continue;
      }
      // Hospedaje: aparece en todos los días entre checkIn y checkOut.
      if (!r.checkIn || !r.checkOut) continue;
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
    }

    // Build grid cells (nulls for offset)
    const grid: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) grid.push(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(d);

    return { cells: grid, dayMap: map };
  }, [year, month, reservations]);

  // Reservations for selected day
  const selectedReservations = dayMap[selectedDate] ?? [];
  const selectedStays = selectedReservations.filter(
    (r) => r.reservationType !== "BATH"
  );
  const selectedBaths = selectedReservations.filter(
    (r) => r.reservationType === "BATH"
  );
  const hasBothTypes = selectedStays.length > 0 && selectedBaths.length > 0;

  const renderCard = (r: CalendarReservation) => (
    <ReservationCard
      key={r.id}
      petName={r.pet?.name ?? "—"}
      roomName={r.room?.name ?? null}
      status={r.status}
      checkIn={r.checkIn}
      checkOut={r.checkOut}
      reservationType={r.reservationType}
      appointmentAt={r.appointmentAt}
      hasBath={r.hasBath}
      totalAmount={Number(r.totalAmount)}
      paymentType={r.paymentType}
      hasBalance={r.hasBalance}
      hasPendingChangeRequest={r.hasPendingChangeRequest}
      lastUpdateAt={r.lastUpdateAt}
      hasReview={r.hasReview}
      reviewRating={r.reviewRating}
      adminView={adminView}
      hasDeslanado={r.hasDeslanado}
      hasCorte={r.hasCorte}
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
  );

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

          // Dots: tipo + status (color). Hospedaje = relleno, baño = anillo.
          const stayDots = [
            ...new Set(
              dayReservations
                .filter((r) => r.reservationType !== "BATH")
                .map((r) => STATUS_DOT[r.status])
                .filter(Boolean)
            ),
          ].slice(0, 2);
          const bathDots = [
            ...new Set(
              dayReservations
                .filter((r) => r.reservationType === "BATH")
                .map((r) => STATUS_DOT[r.status])
                .filter(Boolean)
            ),
          ].slice(0, 2);

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
                {stayDots.map((color, di) => (
                  <View
                    key={`s-${di}`}
                    style={[styles.dot, { backgroundColor: color }]}
                  />
                ))}
                {bathDots.map((color, di) => (
                  <View
                    key={`b-${di}`}
                    style={[
                      styles.dot,
                      styles.dotBath,
                      { borderColor: color },
                    ]}
                  />
                ))}
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
              {status === "CONFIRMED" ? "Confirmada" :
               status === "CHECKED_IN" ? "Hospedado" :
               status === "CHECKED_OUT" ? "Finalizada" : "Cancelada"}
            </Text>
          </View>
        ))}
        <View style={styles.legendDivider} />
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: COLORS.textTertiary }]}
          />
          <Text style={styles.legendText}>Hospedaje</Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendDot,
              styles.dotBath,
              { borderColor: COLORS.textTertiary },
            ]}
          />
          <Text style={styles.legendText}>Baño</Text>
        </View>
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
        ) : hasBothTypes ? (
          <>
            <View style={styles.groupHeader}>
              <Ionicons name="bed-outline" size={16} color={COLORS.primary} />
              <Text style={styles.groupHeaderText}>Hospedajes</Text>
              <View style={styles.groupCountBadge}>
                <Text style={styles.groupCountText}>{selectedStays.length}</Text>
              </View>
            </View>
            {selectedStays.map(renderCard)}

            <View style={[styles.groupHeader, { marginTop: 12 }]}>
              <Ionicons name="water-outline" size={16} color={COLORS.primary} />
              <Text style={styles.groupHeaderText}>Baños</Text>
              <View style={styles.groupCountBadge}>
                <Text style={styles.groupCountText}>{selectedBaths.length}</Text>
              </View>
            </View>
            {selectedBaths.map(renderCard)}
          </>
        ) : (
          selectedReservations.map(renderCard)
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
  dotBath: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
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
  legendDivider: {
    width: 1,
    height: 12,
    backgroundColor: COLORS.borderLight,
    marginHorizontal: 4,
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
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  groupHeaderText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  },
  groupCountBadge: {
    minWidth: 20,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  groupCountText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },
});
