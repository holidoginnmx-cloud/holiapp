import { COLORS } from "@/constants/colors";
import { TabFab } from "@/components/TabFab";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Linking,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getPetsByOwner } from "@/lib/api";
import { PetCard } from "@/components/PetCard";
import { SkeletonList } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { buildWhatsappUrl } from "@/constants/business";

export default function PetsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const router = useRouter();

  const { data: pets, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <View style={styles.container} testID="pets-screen">
        <SkeletonList count={4} />
      </View>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    // La lista es la RAÍZ de la pantalla (sin View envolviéndola): iOS 26 solo
    // engancha el minimize del tab bar al scroll que es primera subvista del
    // view controller. El FAB va de hermano, en absoluto, dentro del fragmento.
    <>
      <FlatList
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        testID="pets-list"
        // Escotilla manual: la lista se queda fresca 5 min y no refetchea al
        // volver a la pestaña, así que cuando el equipo comparte una mascota
        // esto es lo que la trae al momento (el push PET_SHARED hace el resto).
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        data={pets ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PetCard
            pet={item}
            viewerId={userId}
            onPress={() => router.push(`/pet/${item.id}`)}
            onReserveHotel={() => router.push("/reservation/create")}
            onReserveBath={() =>
              router.push({ pathname: "/bath/create", params: { petId: item.id } })
            }
            onAddCartilla={() =>
              router.push({
                pathname: "/pet/create",
                params: { editId: item.id, focus: "cartilla" },
              } as any)
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

            {/* Media familia comparte perro: si lo registró la pareja, el perro
                está en la otra cuenta y esta pantalla se ve igual que la de
                alguien nuevo. Sin este aviso, el siguiente paso natural es
                registrarlo otra vez — y quedan dos perros, dos cartillas por
                revisar y el historial partido. Vincular las cuentas lo hace el
                equipo, así que aquí lo mandamos con ellos. */}
            <TouchableOpacity
              style={styles.emptyLink}
              onPress={() =>
                Linking.openURL(
                  buildWhatsappUrl(
                    "Hola 👋 Mi perro ya está registrado en la cuenta de alguien de mi familia y quiero verlo también en la mía."
                  )
                )
              }
              testID="pets-empty-shared-help"
              activeOpacity={0.7}
            >
              <Ionicons name="logo-whatsapp" size={16} color={COLORS.primary} />
              <Text style={styles.emptyLinkText}>
                ¿Tu perro ya lo registró alguien de tu familia? Escríbenos y lo
                vinculamos a tu cuenta.
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* FAB */}
      <TabFab
        style={styles.fab}
        onPress={() => router.push("/pet/create")}
        testID="pets-create-fab"
      >
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TabFab>
    </>
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
    paddingBottom: 88,
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
  },
  emptyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primaryLight,
    maxWidth: 330,
  },
  emptyLinkText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
    lineHeight: 18,
  },
  fab: {
    position: "absolute",
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
