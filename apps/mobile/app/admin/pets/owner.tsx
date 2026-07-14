import { COLORS } from "@/constants/colors";
import { useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { ErrorState } from "@/components/ErrorState";
import { getUsers } from "@/lib/api";
import type { AdminUserListItem } from "@/lib/api";
import {
  formatName,
  formatFullName,
  formatPhoneInput,
  displayEmail,
  NO_EMAIL_LABEL,
} from "@/lib/format";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

/**
 * Paso 1 del alta de mascota desde el admin: ¿de quién es el perro?
 *
 * Se elige un cliente que ya existe o se crea uno nuevo (que al terminar
 * regresa aquí mismo, encadenado al paso 2). El paso 2 es la pantalla de
 * mascota de siempre (`/pet/create`), a la que le pasamos el ownerId: solo
 * un ADMIN puede crear una mascota para otro dueño (lo valida el backend).
 */
export default function AdminPetOwnerScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const {
    data: users,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  // Solo clientes activos: staff/admin no son dueños, y los desactivados son
  // los duplicados que ya se consolidaron — colgarles una mascota los
  // resucitaría en la lista.
  const clients = useMemo(
    () => (users ?? []).filter((u) => u.role === "OWNER" && u.isActive !== false),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    const digits = q.replace(/\D/g, "");
    return clients.filter((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      const phoneDigits = (u.phone ?? "").replace(/\D/g, "");
      return (
        name.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && phoneDigits.includes(digits))
      );
    });
  }, [clients, search]);

  const goToPetForm = (user: AdminUserListItem) => {
    const ownerName = formatFullName(user.firstName, user.lastName);
    router.push(
      `/pet/create?ownerId=${user.id}&ownerName=${encodeURIComponent(
        ownerName,
      )}` as any,
    );
  };

  const renderClient = ({ item }: { item: AdminUserListItem }) => {
    const email = displayEmail(item.email);
    return (
      <TouchableOpacity
        style={styles.clientRow}
        activeOpacity={0.7}
        onPress={() => goToPetForm(item)}
        testID={`pet-owner-${item.id}`}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.firstName?.[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <View style={styles.clientInfo}>
          <Text style={styles.clientName} numberOfLines={1}>
            {formatName(item.firstName)} {formatName(item.lastName)}
          </Text>
          <Text style={styles.clientSub} numberOfLines={1}>
            {item.phone
              ? formatPhoneInput(item.phone)
              : email || NO_EMAIL_LABEL}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.introCard}>
        <Ionicons name="paw" size={20} color={COLORS.primary} />
        <Text style={styles.introText}>
          ¿De quién es la mascota? Elige al cliente y en el siguiente paso
          capturas los datos del perro.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.newClientBtn}
        activeOpacity={0.8}
        onPress={() => router.push("/admin/users/create?next=pet" as any)}
        testID="pet-owner-new-client"
      >
        <Ionicons name="person-add" size={18} color={COLORS.white} />
        <Text style={styles.newClientBtnText}>Cliente nuevo</Text>
      </TouchableOpacity>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar cliente por nombre o teléfono..."
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          testID="pet-owner-search"
        />
        {search.length > 0 && (
          <Ionicons
            name="close-circle"
            size={18}
            color={COLORS.textDisabled}
            onPress={() => setSearch("")}
          />
        )}
      </View>

      {isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={renderClient}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={44} color={COLORS.border} />
              <Text style={styles.emptyText}>
                {search
                  ? "Ningún cliente coincide. Si es nuevo, créalo arriba."
                  : "Todavía no hay clientes registrados."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  introCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 12,
    margin: 16,
    marginBottom: 12,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  newClientBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginHorizontal: 16,
  },
  newClientBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.white,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    margin: 16,
    marginBottom: 0,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  list: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "800",
  },
  clientInfo: {
    flex: 1,
    minWidth: 0,
  },
  clientName: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  clientSub: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textDisabled,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 20,
  },
});
