import { COLORS } from "@/constants/colors";
import { buildWhatsappUrl } from "@/constants/business";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Linking,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getReservations } from "@/lib/api";
import { ReservationCard } from "@/components/ReservationCard";

export default function HomeScreen() {
  const firstName = useAuthStore((s) => s.firstName);
  const userId = useAuthStore((s) => s.userId);
  const role = useAuthStore((s) => s.role);
  const email = useAuthStore((s) => s.email);
  const router = useRouter();

  console.log("🏠 [HomeScreen] store:", { firstName, userId, role, email });

  const {
    data: activeReservations,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservations", userId, "CHECKED_IN"],
    queryFn: () => getReservations({ ownerId: userId!, status: "CHECKED_IN" }),
    enabled: !!userId,
  });

  const { data: upcomingReservations } = useQuery({
    queryKey: ["reservations", userId, "CONFIRMED"],
    queryFn: () => getReservations({ ownerId: userId!, status: "CONFIRMED" }),
    enabled: !!userId,
  });

  const hasActiveStays = (activeReservations?.length ?? 0) > 0;

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
        <Text style={styles.errorText}>Error al cargar datos</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="home-screen"
    >
      <Text style={styles.greeting}>Hola, {firstName} 👋</Text>

      {/* Acciones primarias */}
      <View style={styles.primaryActions}>
        <TouchableOpacity
          style={styles.reserveButton}
          onPress={() => router.push("/reservation/create")}
          activeOpacity={0.8}
          testID="home-reserve-button"
        >
          <Ionicons name="add-circle" size={18} color={COLORS.white} />
          <Text style={styles.reserveButtonText}>Reservar ahora</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.whatsappButton}
          onPress={() => Linking.openURL(buildWhatsappUrl())}
          activeOpacity={0.8}
          testID="home-whatsapp-button"
        >
          <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
          <Text style={styles.whatsappButtonText}>WhatsApp</Text>
        </TouchableOpacity>
      </View>

      {/* Estancias activas */}
      <Text style={styles.sectionTitle}>
        {hasActiveStays
          ? `Estancias activas (${activeReservations!.length})`
          : "Estancias activas"}
      </Text>
      {hasActiveStays ? (
        activeReservations!.map((res) => (
          <ReservationCard
            key={res.id}
            petName={res.pet.name}
            roomName={res.room?.name ?? null}
            status={res.status}
            checkIn={res.checkIn}
            checkOut={res.checkOut}
            reservationType={res.reservationType}
            appointmentAt={res.appointmentAt}
            totalAmount={Number(res.totalAmount)}
            onPress={() => router.push(`/reservation/${res.id}`)}
          />
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Ionicons name="paw-outline" size={40} color={COLORS.border} />
          <Text style={styles.emptyText}>
            No tienes mascotas hospedadas
          </Text>
        </View>
      )}

      {/* Próximas reservaciones */}
      {upcomingReservations && upcomingReservations.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Próximas reservaciones</Text>
          {upcomingReservations.slice(0, 2).map((res) => (
            <ReservationCard
              key={res.id}
              petName={res.pet.name}
              roomName={res.room?.name ?? null}
              status={res.status}
              checkIn={res.checkIn}
              checkOut={res.checkOut}
              totalAmount={Number(res.totalAmount)}
              onPress={() => router.push(`/reservation/${res.id}`)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
  },
  greeting: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 12,
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
  primaryActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: -16,
    marginBottom: 24,
  },
  reserveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  reserveButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.white,
  },
  whatsappButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#25D366",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  whatsappButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.white,
  },
  quickActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    marginBottom: 8,
  },
  quickAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.reviewBg,
    borderWidth: 1,
    borderColor: COLORS.reviewBorder,
    borderRadius: 10,
    paddingVertical: 10,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
  },
  photoList: {
    paddingRight: 20,
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
