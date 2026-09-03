import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getStaffStays } from "@/lib/api";
import { AlertItem } from "@/components/AlertItem";
import { ErrorState } from "@/components/ErrorState";
import { ScreenContainer } from "@/components/ScreenContainer";
import { CardGrid } from "@/components/CardGrid";
import { useResponsive, WIDE_MAX_WIDTH } from "@/lib/responsive";
import { formatName, formatTimeHHmm } from "@/lib/format";

type ListType = "hospedados" | "alertas" | "checkins" | "checkouts" | "reportes";

const COPY: Record<
  ListType,
  { title: string; emptyTitle: string; emptySubtitle: string; emptyIcon: keyof typeof Ionicons.glyphMap }
> = {
  hospedados: {
    title: "Perros hospedados ahora mismo",
    emptyTitle: "No hay perros hospedados",
    emptySubtitle: "Cuando alguien haga check-in, aparecerá aquí.",
    emptyIcon: "paw-outline",
  },
  alertas: {
    title: "Atenciones pendientes",
    emptyTitle: "Todo en orden",
    emptySubtitle: "No hay reportes faltantes, baños ni medicaciones pendientes.",
    emptyIcon: "shield-checkmark-outline",
  },
  checkins: {
    title: "Estancias programadas para hoy",
    emptyTitle: "No hay check-ins programados hoy",
    emptySubtitle: "Las próximas estancias aparecerán cuando se acerque la fecha.",
    emptyIcon: "log-in-outline",
  },
  checkouts: {
    title: "Estancias que terminan hoy",
    emptyTitle: "No hay check-outs hoy",
    emptySubtitle: "Las salidas programadas aparecerán cuando se acerque la fecha.",
    emptyIcon: "log-out-outline",
  },
  reportes: {
    title: "Estancias sin reporte de hoy",
    emptyTitle: "Todos los reportes al día",
    emptySubtitle: "Cada perro hospedado tiene su reporte registrado.",
    emptyIcon: "checkmark-done-circle-outline",
  },
};

function isSameLocalDay(date: Date | string | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function StaffListScreen() {
  const { type } = useLocalSearchParams<{ type: ListType }>();
  const router = useRouter();
  const { columns } = useResponsive();
  const t = (type as ListType) ?? "hospedados";

  const {
    data: activeStays,
    isLoading: loadingActive,
    isError: errorActive,
    error: errorActiveObj,
    isRefetching: refetchingActive,
    refetch: refetchActive,
  } = useQuery({
    // Mismas keys que el dashboard staff: todo el hotel, no solo lo asignado
    // a mí (ver comentario en (staff)/dashboard).
    queryKey: ["staff", "stays", "hotel", "CHECKED_IN"],
    queryFn: () => getStaffStays("CHECKED_IN", { all: true }),
  });

  const {
    data: confirmedStays,
    isLoading: loadingConfirmed,
    isError: errorConfirmed,
    error: errorConfirmedObj,
    isRefetching: refetchingConfirmed,
    refetch: refetchConfirmed,
  } = useQuery({
    queryKey: ["staff", "stays", "hotel", "CONFIRMED"],
    queryFn: () => getStaffStays("CONFIRMED", { all: true }),
  });

  const isLoading = loadingActive || loadingConfirmed;
  const isRefetching = refetchingActive || refetchingConfirmed;
  const refetch = () => {
    refetchActive();
    refetchConfirmed();
  };

  // Solo hospedajes: los baños comparten status CHECKED_IN/CONFIRMED pero son
  // citas, no estancias — no deben aparecer en hospedados/reportes/alertas.
  const active = (activeStays ?? []).filter((s) => s.reservationType !== "BATH");
  const confirmed = (confirmedStays ?? []).filter(
    (s) => s.reservationType !== "BATH"
  );

  // Ordena por la hora estimada; las que todavía no la tienen van al final.
  // Es lo que convierte la lista en una agenda: se lee de arriba abajo en el
  // orden en que va a pasar el día.
  const porHora = (campo: "checkInTime" | "checkOutTime") => (
    a: { checkInTime?: string | null; checkOutTime?: string | null },
    b: { checkInTime?: string | null; checkOutTime?: string | null }
  ) => (a[campo] ?? "99:99").localeCompare(b[campo] ?? "99:99");

  // Derivados
  const checkInsToday = confirmed
    .filter((s) => isSameLocalDay(s.checkIn))
    .sort(porHora("checkInTime"));
  const checkOutsToday = active
    .filter((s) => isSameLocalDay(s.checkOut))
    .sort(porHora("checkOutTime"));
  const staysWithoutChecklist = active.filter((s) => s.checklists.length === 0);
  const staysWithMedication = active.filter(
    (s) => s.medicationNotes && s.medicationNotes.trim().length > 0
  );
  const staysWithBath = [...active, ...confirmed].filter((s) =>
    s.addons?.some(
      (a) => a.variant?.serviceType?.code === "BATH" && !a.completedAt
    )
  );

  if (errorActive || errorConfirmed) {
    return (
      <ErrorState
        error={errorActiveObj ?? errorConfirmedObj}
        onRetry={refetch}
      />
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const copy = COPY[t];

  // Lista común para tipos basados en stays
  const stayList =
    t === "hospedados"
      ? active
      : t === "checkins"
      ? checkInsToday
      : t === "checkouts"
      ? checkOutsToday
      : t === "reportes"
      ? staysWithoutChecklist
      : [];

  const isAlertasEmpty =
    t === "alertas" &&
    staysWithMedication.length === 0 &&
    staysWithoutChecklist.length === 0 &&
    staysWithBath.length === 0;

  const showEmpty =
    (t !== "alertas" && stayList.length === 0) || isAlertasEmpty;

  return (
    <ScreenContainer
      scroll
      maxWidth={WIDE_MAX_WIDTH}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      <Text style={styles.subtitle}>{copy.title}</Text>

      {showEmpty ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name={copy.emptyIcon} size={36} color={COLORS.primary} />
          </View>
          <Text style={styles.emptyTitle}>{copy.emptyTitle}</Text>
          <Text style={styles.emptySubtitle}>{copy.emptySubtitle}</Text>
        </View>
      ) : t === "alertas" ? (
        <CardGrid columns={Math.min(columns, 2)} gap={12}>
          {staysWithMedication.map((stay) => (
            <AlertItem
              key={`med-${stay.id}`}
              icon="medkit-outline"
              text={`${formatName(stay.pet?.name ?? "—")} — Medicamento: ${stay.medicationNotes}`}
              severity="error"
              onPress={() => router.push(`/staff/stay/${stay.id}` as any)}
            />
          ))}
          {staysWithoutChecklist.map((stay) => (
            <AlertItem
              key={`checklist-${stay.id}`}
              icon="document-text-outline"
              text={`${formatName(stay.pet?.name ?? "—")} — Falta reporte diario`}
              severity="warning"
              onPress={() =>
                router.push(`/staff/checklist/${stay.id}` as any)
              }
            />
          ))}
          {staysWithBath.map((stay) => {
            const bath = stay.addons?.find(
              (a) => a.variant?.serviceType?.code === "BATH" && !a.completedAt
            );
            if (!bath) return null;
            const extras: string[] = [];
            if (bath.variant?.deslanado) extras.push("Deslanado");
            if (bath.variant?.corte) extras.push("Corte");
            const detail = extras.length > 0 ? ` (${extras.join(" + ")})` : "";
            return (
              <AlertItem
                key={`bath-${stay.id}`}
                icon="water-outline"
                text={`${formatName(stay.pet?.name ?? "—")} — Baño pendiente${detail}`}
                severity="info"
                onPress={() => router.push(`/staff/stay/${stay.id}` as any)}
              />
            );
          })}
        </CardGrid>
      ) : (
        <CardGrid columns={columns} gap={12}>
          {stayList.map((stay) => (
            <TouchableOpacity
              key={stay.id}
              style={styles.stayCard}
              activeOpacity={0.85}
              onPress={() => router.push(`/staff/stay/${stay.id}` as any)}
            >
              <Image
                source={
                  stay.pet?.photoUrl
                    ? { uri: stay.pet.photoUrl }
                    : require("../../assets/pet-placeholder.png")
                }
                style={styles.petPhoto}
              />
              <View style={styles.stayInfo}>
                <Text style={styles.stayPetName}>
                  {formatName(stay.pet?.name ?? "—")}
                </Text>
                {stay.owner && (
                  <Text style={styles.stayOwnerName}>
                    {formatName(stay.owner?.firstName ?? "")}{" "}
                    {formatName(stay.owner?.lastName ?? "")}
                  </Text>
                )}
                <View style={styles.metaRow}>
                  {stay.room && (
                    <View style={styles.metaChip}>
                      <Ionicons
                        name="bed-outline"
                        size={12}
                        color={COLORS.textTertiary}
                      />
                      <Text style={styles.metaText}>{stay.room.name}</Text>
                    </View>
                  )}
                  {/* La hora ESTIMADA, no la del campo de fecha: `checkIn`
                      guarda el día a las 00:00 UTC, que en Hermosillo son las
                      5:00 p.m. — la lista entera anunciaba esa hora falsa. */}
                  {t === "checkins" && stay.checkIn && (
                    <View
                      style={[
                        styles.metaChip,
                        { backgroundColor: COLORS.infoBg },
                      ]}
                    >
                      <Ionicons
                        name="log-in-outline"
                        size={12}
                        color={COLORS.infoText}
                      />
                      <Text style={[styles.metaText, { color: COLORS.infoText }]}>
                        {stay.checkInTime
                          ? formatTimeHHmm(stay.checkInTime)
                          : "Sin hora"}
                      </Text>
                    </View>
                  )}
                  {t === "checkouts" && stay.checkOut && (
                    <View
                      style={[
                        styles.metaChip,
                        { backgroundColor: COLORS.warningBg },
                      ]}
                    >
                      <Ionicons
                        name="log-out-outline"
                        size={12}
                        color={COLORS.warningText}
                      />
                      <Text
                        style={[styles.metaText, { color: COLORS.warningText }]}
                      >
                        {stay.checkOutTime
                          ? formatTimeHHmm(stay.checkOutTime)
                          : "Sin hora"}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.textTertiary}
              />
            </TouchableOpacity>
          ))}
        </CardGrid>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 12,
  },
  stayCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  petPhoto: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.bgSection,
  },
  stayInfo: { flex: 1, gap: 2 },
  stayPetName: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  stayOwnerName: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  metaText: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
  empty: {
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 24,
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
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 18,
  },
});
