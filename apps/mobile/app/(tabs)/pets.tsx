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

  console.log("🐾 [PetsScreen] userId:", userId);

  const { data: pets, isLoading, error, refetch } = useQuery({
    queryKey: ["pets", userId],
    queryFn: async () => {
      console.log("🐾 [PetsScreen] Fetching pets for userId:", userId);
      const result = await getPetsByOwner(userId!);
      console.log("🐾 [PetsScreen] Got pets:", result?.length, result?.map(p => p.name));
      return result;
    },
    enabled: !!userId,
  });

  if (error) {
    console.log("🐾 [PetsScreen] Error:", error);
  }

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
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer} testID="pets-empty-state">
            <Ionicons name="paw-outline" size={48} color={COLORS.border} />
            <Text style={styles.emptyText}>No tienes mascotas registradas</Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push("/pet/create")}
              testID="pets-empty-create-button"
            >
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
    paddingBottom: 80,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
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
