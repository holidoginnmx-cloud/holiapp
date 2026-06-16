import { COLORS } from "@/constants/colors";
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getPetHistory } from "@/lib/api";
import { BehaviorTagPill } from "@/components/BehaviorTagPill";
import { ErrorState } from "@/components/ErrorState";
import { formatName, formatDayShort, formatDayShortYear } from "@/lib/format";
import { cloudinaryResized } from "@/lib/cloudinary";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  CHECKED_IN: "En estancia",
  CHECKED_OUT: "Finalizada",
  CANCELLED: "Cancelada",
};

export default function PetHistoryScreen() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  const router = useRouter();
  const [historyFilter, setHistoryFilter] = useState<"stays" | "baths">("stays");

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["pet", "history", petId],
    queryFn: () => getPetHistory(petId!),
    enabled: !!petId,
  });

  if (isError) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.emptyText}>No se encontró información</Text>
      </View>
    );
  }

  const { pet, reservations, behaviorTags } = data;

  // Los baños son citas, no estancias: se separan en su propio filtro.
  const stays = reservations.filter((r) => r.reservationType !== "BATH");
  const baths = reservations.filter((r) => r.reservationType === "BATH");
  const list = historyFilter === "stays" ? stays : baths;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      {/* Pet header */}
      <View style={styles.petHeader}>
        <Image
          source={
            pet.photoUrl
              ? { uri: pet.photoUrl }
              : require("../../assets/pet-placeholder.png")
          }
          style={styles.petPhoto}
        />
        <Text style={styles.petName}>{formatName(pet.name)}</Text>
        {pet.breed && <Text style={styles.petBreed}>{pet.breed}</Text>}
      </View>

      {/* Stats summary */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{stays.length}</Text>
          <Text style={styles.statLabel}>Estancias</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {reservations.reduce((sum, r) => sum + (r.totalDays ?? 0), 0)}
          </Text>
          <Text style={styles.statLabel}>Noches</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {reservations.reduce(
              (sum, r) => sum + (r.updates?.length || 0),
              0
            )}
          </Text>
          <Text style={styles.statLabel}>Fotos</Text>
        </View>
      </View>

      {/* Incidentes — link a pantalla dedicada */}
      <TouchableOpacity
        style={styles.incidentsCard}
        onPress={() => router.push(`/pet/incidents/${pet.id}` as any)}
        activeOpacity={0.85}
        testID="pet-history-incidents-link"
      >
        <View style={styles.incidentsIcon}>
          <Ionicons
            name="alert-circle-outline"
            size={22}
            color={COLORS.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.incidentsTitle}>Incidentes</Text>
          <Text style={styles.incidentsSubtitle}>
            Reportes del staff de todas las estancias
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textTertiary} />
      </TouchableOpacity>

      {/* Behavior tags */}
      {behaviorTags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personalidad observada</Text>
          <View style={styles.tagsRow}>
            {behaviorTags.map((bt) => (
              <BehaviorTagPill key={bt.id} tag={bt.tag} />
            ))}
          </View>
        </View>
      )}

      {/* Timeline */}
      <Text style={styles.sectionTitle}>Historial</Text>

      <View style={styles.historyFilterRow}>
        {([
          { key: "stays" as const, label: "Estancias", count: stays.length },
          { key: "baths" as const, label: "Baños", count: baths.length },
        ]).map((f) => {
          const active = historyFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.historyChip, active && styles.historyChipActive]}
              onPress={() => setHistoryFilter(f.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.historyChipText,
                  active && styles.historyChipTextActive,
                ]}
              >
                {f.label} ({f.count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {list.length === 0 ? (
        <Text style={styles.emptyText}>
          {historyFilter === "stays"
            ? "Aún no tiene estancias registradas"
            : "Aún no tiene baños registrados"}
        </Text>
      ) : (
        list.map((res, index) => (
          <View key={res.id} style={styles.timelineItem}>
            {/* Timeline connector */}
            <View style={styles.timelineLeft}>
              <View style={styles.timelineDot} />
              {index < list.length - 1 && (
                <View style={styles.timelineLine} />
              )}
            </View>

            {/* Content */}
            <View style={styles.timelineCard}>
              <View style={styles.timelineHeader}>
                <Text style={styles.timelineDates}>
                  {res.reservationType === "BATH" && res.appointmentAt
                    ? formatDayShortYear(res.appointmentAt) + " · Baño"
                    : `${res.checkIn ? formatDayShort(res.checkIn) : "—"} - ${res.checkOut ? formatDayShortYear(res.checkOut) : "—"}`}
                </Text>
                <Text style={styles.timelineStatus}>
                  {STATUS_LABEL[res.status] || res.status}
                </Text>
              </View>

              {res.room && (
                <View style={styles.timelineInfoRow}>
                  <Ionicons name="bed-outline" size={14} color={COLORS.textTertiary} />
                  <Text style={styles.timelineInfo}>{res.room.name}</Text>
                </View>
              )}

              {res.totalDays != null && (
                <View style={styles.timelineInfoRow}>
                  <Ionicons name="moon-outline" size={14} color={COLORS.textTertiary} />
                  <Text style={styles.timelineInfo}>
                    {res.totalDays} noche{res.totalDays > 1 ? "s" : ""}
                  </Text>
                </View>
              )}

              {/* Photo thumbnails */}
              {res.updates && res.updates.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.photosScroll}
                >
                  {res.updates.map((u) => (
                    <Image
                      key={u.id}
                      source={{ uri: cloudinaryResized(u.mediaUrl, 180, "fill") }}
                      style={styles.thumbnail}
                    />
                  ))}
                </ScrollView>
              )}

              {/* Review */}
              {res.review && (
                <View style={styles.reviewRow}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Ionicons
                      key={i}
                      name={i <= res.review!.rating ? "paw" : "paw-outline"}
                      size={16}
                      color={i <= res.review!.rating ? COLORS.primary : COLORS.border}
                    />
                  ))}
                </View>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  contentContainer: { padding: 16, paddingBottom: 40 },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  emptyText: { fontSize: 14, color: COLORS.textDisabled, textAlign: "center" },
  petHeader: {
    alignItems: "center",
    marginBottom: 20,
  },
  petPhoto: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
    backgroundColor: COLORS.bgSection,
  },
  petName: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary },
  petBreed: { fontSize: 14, color: COLORS.textTertiary, marginTop: 2 },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  statValue: { fontSize: 22, fontWeight: "800", color: COLORS.primary },
  statLabel: { fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  section: { marginBottom: 20 },
  historyFilterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  historyChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: COLORS.bgSection,
  },
  historyChipActive: {
    backgroundColor: COLORS.primary,
  },
  historyChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  historyChipTextActive: {
    color: COLORS.white,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  timelineItem: {
    flexDirection: "row",
    marginBottom: 4,
  },
  timelineLeft: {
    width: 24,
    alignItems: "center",
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
    marginTop: 4,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.borderLight,
    marginTop: 4,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginLeft: 10,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    gap: 6,
  },
  timelineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timelineDates: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  timelineStatus: { fontSize: 12, fontWeight: "600", color: COLORS.textTertiary },
  timelineInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timelineInfo: { fontSize: 13, color: COLORS.textTertiary },
  photosScroll: { marginTop: 6 },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 6,
    backgroundColor: COLORS.bgSection,
  },
  reviewRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 4,
  },
  incidentsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  incidentsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  incidentsTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  incidentsSubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
});
