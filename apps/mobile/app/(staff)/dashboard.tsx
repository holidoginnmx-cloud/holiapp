import { COLORS } from "@/constants/colors";
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

export default function StaffDashboard() {
  const router = useRouter();
  const firstName = useAuthStore((s) => s.firstName);

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
        <Text style={styles.greeting}>Hola, {firstName}</Text>
        <Text style={styles.date}>{formatDate()}</Text>
      </View>

      {/* Stats row 1 */}
      <View style={styles.statsRow}>
        <StatCard
          label="Hospedados"
          value={activeStays?.length ?? 0}
          icon="paw"
          color={COLORS.successText}
        />
        <View style={{ width: 12 }} />
        <StatCard
          label="Alertas"
          value={totalAlerts}
          icon="alert-circle"
          color={totalAlerts > 0 ? COLORS.warningText : COLORS.successText}
        />
      </View>

      {/* Stats row 2 — check-ins/outs hoy + progreso reportes */}
      <View style={styles.statsRow}>
        <StatCard
          label="Check-ins hoy"
          value={checkInsToday.length}
          icon="log-in-outline"
          color={COLORS.infoText}
        />
        <View style={{ width: 12 }} />
        <StatCard
          label="Check-outs hoy"
          value={checkOutsToday.length}
          icon="log-out-outline"
          color={COLORS.warningText}
        />
        <View style={{ width: 12 }} />
        <StatCard
          label="Reportes"
          value={`${reportsDone}/${reportsTotal}`}
          icon="document-text"
          color={reportsDone === reportsTotal && reportsTotal > 0
            ? COLORS.successText
            : COLORS.primary}
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

      {/* Alertas — medicación + reportes faltantes + baños */}
      {totalAlerts > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alertas</Text>
          {staysWithMedication.map((stay) => (
            <AlertItem
              key={`med-${stay.id}`}
              icon="medkit-outline"
              text={`${stay.pet.name} — Medicamento: ${stay.medicationNotes}`}
              severity="error"
              onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
            />
          ))}
          {staysWithoutChecklist.map((stay) => (
            <AlertItem
              key={`checklist-${stay.id}`}
              icon="document-text-outline"
              text={`${stay.pet.name} — Falta reporte diario`}
              severity="warning"
              onPress={() =>
                router.push(`/(staff)/checklist/${stay.id}` as any)
              }
            />
          ))}
          {staysWithBath.map((stay) => {
            const bath = stay.addons?.find(
              (a) => a.variant.serviceType.code === "BATH" && !a.completedAt
            );
            if (!bath) return null;
            const extras: string[] = [];
            if (bath.variant.deslanado) extras.push("Deslanado");
            if (bath.variant.corte) extras.push("Corte");
            const detail = extras.length > 0 ? ` (${extras.join(" + ")})` : "";
            return (
              <AlertItem
                key={`bath-${stay.id}`}
                icon="water-outline"
                text={`${stay.pet.name} — Baño pendiente${detail}`}
                severity="info"
                onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
              />
            );
          })}
        </View>
      )}

      {/* Estancias activas — con foto de mascota y room */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Estancias activas</Text>
        {(activeStays ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No hay estancias activas</Text>
        ) : (
          (activeStays ?? []).map((stay) => (
            <TouchableOpacity
              key={stay.id}
              style={styles.stayCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
            >
              <Image
                source={
                  stay.pet.photoUrl
                    ? { uri: stay.pet.photoUrl }
                    : require("../../assets/pet-placeholder.png")
                }
                style={styles.petPhoto}
              />
              <View style={styles.stayInfo}>
                <Text style={styles.stayPetName}>{stay.pet.name}</Text>
                <Text style={styles.stayOwnerName}>
                  {stay.owner.firstName} {stay.owner.lastName}
                </Text>
                <View style={styles.stayMeta}>
                  {stay.room && (
                    <View style={styles.metaChip}>
                      <Ionicons name="bed-outline" size={12} color={COLORS.textTertiary} />
                      <Text style={styles.metaText}>{stay.room.name}</Text>
                    </View>
                  )}
                  {stay.medicationNotes && (
                    <View style={[styles.metaChip, { backgroundColor: COLORS.errorBg }]}>
                      <Ionicons name="medkit" size={12} color={COLORS.errorText} />
                      <Text style={[styles.metaText, { color: COLORS.errorText }]}>Medicamento</Text>
                    </View>
                  )}
                  {stay.checklists.length === 0 && (
                    <View style={[styles.metaChip, { backgroundColor: COLORS.warningBg }]}>
                      <Ionicons name="document-text" size={12} color={COLORS.warningText} />
                      <Text style={[styles.metaText, { color: COLORS.warningText }]}>Sin reporte</Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.border} />
            </TouchableOpacity>
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
              text={`${stay.pet.name} — ${stay.status === "CHECKED_IN" ? "Hospedado" : "Confirmada"} sin responsable`}
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
            <TouchableOpacity
              key={stay.id}
              style={styles.stayCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/(staff)/stay/${stay.id}` as any)}
            >
              <Image
                source={
                  stay.pet.photoUrl
                    ? { uri: stay.pet.photoUrl }
                    : require("../../assets/pet-placeholder.png")
                }
                style={styles.petPhoto}
              />
              <View style={styles.stayInfo}>
                <Text style={styles.stayPetName}>{stay.pet.name}</Text>
                <Text style={styles.stayOwnerName}>
                  {stay.owner.firstName} {stay.owner.lastName}
                </Text>
                <View style={styles.stayMeta}>
                  {stay.room && (
                    <View style={styles.metaChip}>
                      <Ionicons name="bed-outline" size={12} color={COLORS.textTertiary} />
                      <Text style={styles.metaText}>{stay.room.name}</Text>
                    </View>
                  )}
                  <View style={styles.metaChip}>
                    <Ionicons name="calendar-outline" size={12} color={COLORS.textTertiary} />
                    <Text style={styles.metaText}>
                      {stay.checkIn ? new Date(stay.checkIn).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "—"}
                    </Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.border} />
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
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
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  petPhoto: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.bgSection,
  },
  stayInfo: {
    flex: 1,
    marginLeft: 12,
  },
  stayPetName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  stayOwnerName: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  stayMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  metaText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
});
