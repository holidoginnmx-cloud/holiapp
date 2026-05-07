import { COLORS } from "@/constants/colors";
import { useMemo } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getStaffStays, getStaffStaysUnassigned, getStaffBaths } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { AlertItem } from "@/components/AlertItem";
import { formatName } from "@/lib/format";
import { useDashboardSeen } from "@/lib/dashboardSeen";

export default function StaffDashboard() {
  const router = useRouter();
  const firstName = useAuthStore((s) => s.firstName);
  const userId = useAuthStore((s) => s.userId);

  const {
    data: activeStays,
    isLoading: loadingActive,
    refetch: refetchActive,
  } = useQuery({
    queryKey: ["staff", "stays", "CHECKED_IN"],
    queryFn: () => getStaffStays("CHECKED_IN"),
    refetchInterval: 60_000,
  });

  const {
    data: confirmedStays,
    isLoading: loadingConfirmed,
    refetch: refetchConfirmed,
  } = useQuery({
    queryKey: ["staff", "stays", "CONFIRMED"],
    queryFn: () => getStaffStays("CONFIRMED"),
    refetchInterval: 60_000,
  });

  const {
    data: unassignedStays,
    refetch: refetchUnassigned,
  } = useQuery({
    queryKey: ["staff", "stays", "unassigned"],
    queryFn: getStaffStaysUnassigned,
    refetchInterval: 60_000,
  });

  const {
    data: bathsToday,
    refetch: refetchBaths,
  } = useQuery({
    queryKey: ["staff-baths", "today"],
    queryFn: () => getStaffBaths(),
    refetchInterval: 60_000,
  });

  const pendingBaths = (bathsToday?.baths ?? []).filter(
    (b) => b.status !== "CHECKED_OUT",
  );
  const doneBaths = (bathsToday?.baths ?? []).filter(
    (b) => b.status === "CHECKED_OUT",
  );

  const isLoading = loadingActive || loadingConfirmed;

  const onRefresh = () => {
    refetchActive();
    refetchConfirmed();
    refetchUnassigned();
    refetchBaths();
  };

  // ── Derived data ──────────────────────────────────────────

  const staysWithoutChecklist = (activeStays ?? []).filter(
    (s) => s.checklists.length === 0
  );

  const staysWithMedication = (activeStays ?? []).filter(
    (s) => s.medicationNotes && s.medicationNotes.trim().length > 0
  );

  const staysWithBath = [...(activeStays ?? []), ...(confirmedStays ?? [])].filter(
    (s) => s.addons?.some((a) => a.variant.serviceType.code === "BATH" && !a.completedAt)
  );

  const totalAlerts =
    staysWithoutChecklist.length + staysWithBath.length + staysWithMedication.length;

  // Check-ins/outs programados hoy
  const todayStr = new Date().toISOString().slice(0, 10);
  const checkInsToday = (confirmedStays ?? []).filter(
    (s) => s.checkIn && new Date(s.checkIn).toISOString().slice(0, 10) === todayStr
  );
  const checkOutsToday = (activeStays ?? []).filter(
    (s) => s.checkOut && new Date(s.checkOut).toISOString().slice(0, 10) === todayStr
  );

  // Progreso de reportes
  const reportsDone = (activeStays ?? []).filter((s) => s.checklists.length > 0).length;
  const reportsTotal = activeStays?.length ?? 0;

  const formatDate = () =>
    new Date().toLocaleDateString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

  // Counts que llevan badge "nuevos desde la última visita".
  const counts = useMemo(
    () => ({
      alerts: totalAlerts,
      checkins: checkInsToday.length,
      checkouts: checkOutsToday.length,
    }),
    [totalAlerts, checkInsToday.length, checkOutsToday.length]
  );
  const { badges, markSeen } = useDashboardSeen(userId, counts);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={COLORS.primary} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola, {formatName(firstName)}</Text>
        <Text style={styles.date}>{formatDate()}</Text>
      </View>

      {/* Stats row 1 */}
      <View style={styles.statsRow}>
        <StatCard
          label="Hospedados"
          value={activeStays?.length ?? 0}
          icon="paw"
          color={COLORS.successText}
          onPress={() => router.push("/staff-list/hospedados" as any)}
        />
        <View style={{ width: 12 }} />
        <StatCard
          label="Alertas"
          value={totalAlerts}
          icon="alert-circle"
          color={totalAlerts > 0 ? COLORS.warningText : COLORS.successText}
          badge={badges.alerts}
          onPress={() => {
            markSeen("alerts");
            router.push("/staff-list/alertas" as any);
          }}
        />
      </View>

      {/* Stats row 2 — check-ins/outs hoy + progreso reportes */}
      <View style={styles.statsRow}>
        <StatCard
          label="Check-ins hoy"
          value={checkInsToday.length}
          icon="log-in-outline"
          color={COLORS.infoText}
          badge={badges.checkins}
          onPress={() => {
            markSeen("checkins");
            router.push("/staff-list/checkins" as any);
          }}
        />
        <View style={{ width: 12 }} />
        <StatCard
          label="Check-outs hoy"
          value={checkOutsToday.length}
          icon="log-out-outline"
          color={COLORS.warningText}
          badge={badges.checkouts}
          onPress={() => {
            markSeen("checkouts");
            router.push("/staff-list/checkouts" as any);
          }}
        />
        <View style={{ width: 12 }} />
        <StatCard
          label="Reportes"
          value={`${reportsDone}/${reportsTotal}`}
          icon="document-text"
          color={reportsDone === reportsTotal && reportsTotal > 0
            ? COLORS.successText
            : COLORS.primary}
          onPress={() => router.push("/staff-list/reportes" as any)}
        />
      </View>

      {/* Baños de hoy — acceso rápido */}
      {(bathsToday?.baths.length ?? 0) > 0 && (
        <TouchableOpacity
          style={styles.bathSummary}
          activeOpacity={0.7}
          onPress={() => router.push("/(staff)/baths" as any)}
        >
          <View style={styles.bathIconBubble}>
            <Ionicons name="water" size={22} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bathSummaryTitle}>Baños de hoy</Text>
            <Text style={styles.bathSummaryMeta}>
              {pendingBaths.length} pendientes · {doneBaths.length} completados
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
        </TouchableOpacity>
      )}

      {/* Estancias activas — con foto de mascota y room */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Estancias activas</Text>
        {(activeStays ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No hay estancias activas</Text>
        ) : (
          (activeStays ?? []).map((stay) => (
            <StayCard
              key={stay.id}
              stay={stay}
              statusLabel="Hospedado"
              statusBg={COLORS.successBg}
              statusColor={COLORS.successText}
              accentColor={COLORS.successText}
              onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
              variant="active"
            />
          ))
        )}
      </View>

      {/* Sin asignar */}
      {(unassignedStays ?? []).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sin staff asignado</Text>
          {(unassignedStays ?? []).map((stay) => (
            <AlertItem
              key={stay.id}
              icon="person-add-outline"
              text={`${formatName(stay.pet.name)} — ${stay.status === "CHECKED_IN" ? "Hospedado" : "Confirmada"} sin responsable`}
              severity="info"
              onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
            />
          ))}
        </View>
      )}

      {/* Próximas llegadas — con foto */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Próximas llegadas</Text>
        {(confirmedStays ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No hay llegadas próximas</Text>
        ) : (
          (confirmedStays ?? []).map((stay) => (
            <StayCard
              key={stay.id}
              stay={stay}
              statusLabel="Confirmada"
              statusBg={COLORS.infoBg}
              statusColor={COLORS.infoText}
              accentColor={COLORS.infoText}
              onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
              variant="upcoming"
            />
          ))
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ── Stay card del dashboard staff ────────────────────────────────
// Se mantiene local en este archivo (solo lo usa el dashboard) y respeta
// la jerarquía visual de ReservationCard del admin/owner: barra de acento
// por status, foto prominente, status pill, meta chips redondos.
type StayCardStay = {
  id: string;
  checkIn: string | Date | null;
  checkOut: string | Date | null;
  checklists: { id: string }[];
  medicationNotes?: string | null;
  pet: { name: string; photoUrl: string | null };
  owner: { firstName: string; lastName: string };
  room: { name: string } | null;
  addons?: Array<{
    completedAt?: string | Date | null;
    variant?: { serviceType?: { code?: string | null } | null } | null;
  }>;
};

function shortDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function dayDelta(a: Date, b: Date): number {
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bUtc - aUtc) / 86_400_000);
}

function StayCard({
  stay,
  statusLabel,
  statusBg,
  statusColor,
  accentColor,
  onPress,
  variant,
}: {
  stay: StayCardStay;
  statusLabel: string;
  statusBg: string;
  statusColor: string;
  accentColor: string;
  onPress: () => void;
  variant: "active" | "upcoming";
}) {
  const checkInDate = stay.checkIn ? new Date(stay.checkIn) : null;
  const checkOutDate = stay.checkOut ? new Date(stay.checkOut) : null;
  const totalNights =
    checkInDate && checkOutDate ? Math.max(1, dayDelta(checkInDate, checkOutDate)) : null;

  const today = new Date();
  // Para "active": en qué día de la estancia estamos (1-based, cap a totalNights+1).
  const dayInStay =
    variant === "active" && checkInDate
      ? Math.min(
          (totalNights ?? 1) + 1,
          Math.max(1, dayDelta(checkInDate, today) + 1)
        )
      : null;
  const checkOutToday =
    checkOutDate && dayDelta(today, checkOutDate) === 0;

  // Para "upcoming": cuántos días faltan al check-in.
  const daysUntilCheckIn =
    variant === "upcoming" && checkInDate
      ? Math.max(0, dayDelta(today, checkInDate))
      : null;

  const hasPendingBath = (stay.addons ?? []).some(
    (a) => a.variant?.serviceType?.code === "BATH" && !a.completedAt
  );

  return (
    <TouchableOpacity
      style={styles.stayCard}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={[styles.stayAccent, { backgroundColor: accentColor }]} />
      <View style={styles.stayBody}>
        {/* Top row */}
        <View style={styles.stayTopRow}>
          <Image
            source={
              stay.pet.photoUrl
                ? { uri: stay.pet.photoUrl }
                : require("../../assets/pet-placeholder.png")
            }
            style={styles.petPhoto}
          />
          <View style={styles.stayInfo}>
            <View style={styles.stayHeader}>
              <Text style={styles.stayPetName} numberOfLines={1}>
                {formatName(stay.pet.name)}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
                <Text style={[styles.statusPillText, { color: statusColor }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <Text style={styles.stayOwnerName} numberOfLines={1}>
              {formatName(stay.owner.firstName)} {formatName(stay.owner.lastName)}
            </Text>
            <View style={styles.stayMeta}>
              {stay.room && (
                <View style={styles.metaChip}>
                  <Ionicons name="bed-outline" size={12} color={COLORS.textTertiary} />
                  <Text style={styles.metaText}>{stay.room.name}</Text>
                </View>
              )}
              {hasPendingBath && (
                <View style={[styles.metaChip, { backgroundColor: COLORS.infoBg }]}>
                  <Ionicons name="water" size={12} color={COLORS.infoText} />
                  <Text style={[styles.metaText, { color: COLORS.infoText }]}>
                    Baño pendiente
                  </Text>
                </View>
              )}
              {stay.medicationNotes && (
                <View style={[styles.metaChip, { backgroundColor: COLORS.errorBg }]}>
                  <Ionicons name="medkit" size={12} color={COLORS.errorText} />
                  <Text style={[styles.metaText, { color: COLORS.errorText }]}>
                    Medicamento
                  </Text>
                </View>
              )}
              {variant === "active" && stay.checklists.length === 0 && (
                <View style={[styles.metaChip, { backgroundColor: COLORS.warningBg }]}>
                  <Ionicons name="document-text" size={12} color={COLORS.warningText} />
                  <Text style={[styles.metaText, { color: COLORS.warningText }]}>
                    Sin reporte
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Date strip */}
        {checkInDate && checkOutDate && (
          <View style={styles.dateStrip}>
            <View style={styles.dateBlock}>
              <Text style={styles.dateBlockLabel}>ENTRADA</Text>
              <Text style={styles.dateBlockValue}>{shortDate(checkInDate)}</Text>
            </View>
            <View style={styles.dateConnector}>
              <View style={styles.connectorLine} />
              <View style={styles.nightsBadge}>
                <Ionicons name="moon" size={10} color={COLORS.primary} />
                <Text style={styles.nightsText}>
                  {totalNights} {totalNights === 1 ? "noche" : "noches"}
                </Text>
              </View>
              <View style={styles.connectorLine} />
            </View>
            <View style={styles.dateBlock}>
              <Text style={styles.dateBlockLabel}>SALIDA</Text>
              <Text
                style={[
                  styles.dateBlockValue,
                  checkOutToday && { color: COLORS.warningText },
                ]}
              >
                {shortDate(checkOutDate)}
              </Text>
            </View>
          </View>
        )}

        {/* Progress / countdown row */}
        {variant === "active" && totalNights && dayInStay && (
          <View style={styles.progressRow}>
            <Ionicons
              name={checkOutToday ? "log-out-outline" : "time-outline"}
              size={13}
              color={checkOutToday ? COLORS.warningText : COLORS.primary}
            />
            <Text
              style={[
                styles.progressText,
                checkOutToday && { color: COLORS.warningText },
              ]}
            >
              {checkOutToday
                ? "Sale hoy"
                : `Día ${dayInStay} de ${totalNights + 1}`}
            </Text>
          </View>
        )}

        {variant === "upcoming" && daysUntilCheckIn !== null && (
          <View style={styles.progressRow}>
            <Ionicons
              name={daysUntilCheckIn === 0 ? "log-in-outline" : "calendar-outline"}
              size={13}
              color={daysUntilCheckIn === 0 ? COLORS.successText : COLORS.primary}
            />
            <Text
              style={[
                styles.progressText,
                daysUntilCheckIn === 0 && { color: COLORS.successText },
              ]}
            >
              {daysUntilCheckIn === 0
                ? "Llega hoy"
                : daysUntilCheckIn === 1
                ? "Llega mañana"
                : `Llega en ${daysUntilCheckIn} días`}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.chevronWrap}>
        <Ionicons name="chevron-forward" size={20} color={COLORS.border} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  bathSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  bathIconBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  bathSummaryTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  bathSummaryMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  header: {
    padding: 20,
    paddingBottom: 8,
  },
  greeting: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  date: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 4,
    textTransform: "capitalize",
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingVertical: 20,
  },
  // ── Stay card with photo ──
  stayCard: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  stayAccent: {
    width: 4,
    alignSelf: "stretch",
  },
  stayBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  stayTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  petPhoto: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.bgSection,
  },
  stayInfo: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  stayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stayPetName: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  stayOwnerName: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
  stayMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  // Date strip (entrada → salida)
  dateStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
  },
  dateBlock: {
    alignItems: "center",
    minWidth: 60,
  },
  dateBlockLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  dateBlockValue: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  dateConnector: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  connectorLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderLight,
  },
  nightsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    marginHorizontal: 4,
  },
  nightsText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.primary,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },
  progressText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },
  chevronWrap: {
    justifyContent: "center",
    paddingRight: 12,
    paddingLeft: 4,
  },
});
