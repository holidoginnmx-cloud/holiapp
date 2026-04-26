import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getPetsByOwner } from "@/lib/api";
import { PetCard } from "@/components/PetCard";

export default function PetsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();

  const { data: pets, isLoading, error, refetch } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
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
        <Text style={styles.errorText}>Error al cargar mascotas</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="pets-screen">
      <FlatList
        testID="pets-list"
        data={pets}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PetCard
            pet={item}
            onPress={() => router.push(`/pet/${item.id}`)}
            onReserveHotel={() => router.push("/reservation/create")}
            onReserveBath={() =>
              router.push({ pathname: "/bath/create", params: { petId: item.id } })
            }
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer} testID="pets-empty-state">
            <View style={styles.emptyIconCircle}>
              <Ionicons name="paw" size={40} color={COLORS.primary} />
            </View>
            <Text style={styles.emptyTitle}>Bienvenido a la familia HDI</Text>
            <Text style={styles.emptySubtitle}>
              Registra a tu peludito para comenzar a reservar experiencias
              cuidadas y con seguimiento constante.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push("/pet/create")}
              testID="pets-empty-create-button"
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle" size={18} color={COLORS.white} />
              <Text style={styles.emptyButtonText}>Registrar mascota</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/pet/create")}
        activeOpacity={0.8}
        testID="pets-create-fab"
      >
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  list: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 80,
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
    paddingTop: 40,
    paddingHorizontal: 12,
    gap: 10,
  },
  emptyIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 300,
  },
  emptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  emptyButtonText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 15,
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
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
