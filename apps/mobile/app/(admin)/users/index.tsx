import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getUsers, updateUser } from "@/lib/api";
import type { User } from "@holidoginn/shared";

const ROLE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  ADMIN: { label: "Admin", bg: COLORS.primaryLight, color: COLORS.primary },
  STAFF: { label: "Staff", bg: COLORS.infoBg, color: COLORS.infoText },
  OWNER: { label: "Cliente", bg: COLORS.bgSection, color: COLORS.textTertiary },
};

const ROLE_CYCLE = ["OWNER", "STAFF", "ADMIN"];

export default function AdminUsers() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  const mutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<User> }) =>
      updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const handleToggleActive = (user: User) => {
    const newState = !user.isActive;
    Alert.alert(
      newState ? "Activar usuario" : "Desactivar usuario",
      `¿${newState ? "Activar" : "Desactivar"} a ${user.firstName} ${user.lastName}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: () =>
            mutation.mutate({ id: user.id, data: { isActive: newState } }),
        },
      ]
    );
  };

  const handleChangeRole = (user: User) => {
    const currentIndex = ROLE_CYCLE.indexOf(user.role);
    const nextRole = ROLE_CYCLE[(currentIndex + 1) % ROLE_CYCLE.length];
    const config = ROLE_CONFIG[nextRole];

    Alert.alert(
      "Cambiar rol",
      `¿Cambiar rol de ${user.firstName} a ${config.label}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: `Cambiar a ${config.label}`,
          onPress: () =>
            mutation.mutate({ id: user.id, data: { role: nextRole as any } }),
        },
      ]
    );
  };

  const renderUser = ({ item }: { item: User }) => {
    const roleConfig = ROLE_CONFIG[item.role] || ROLE_CONFIG.OWNER;

    return (
      <View style={[styles.userCard, !item.isActive && styles.userCardInactive]}>
        <View style={styles.userInfo}>
          <View style={styles.userHeader}>
            <Text style={styles.userName}>
              {item.firstName} {item.lastName}
            </Text>
            {!item.isActive && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>Inactivo</Text>
              </View>
            )}
          </View>
          <Text style={styles.userEmail}>{item.email}</Text>
          <TouchableOpacity
            onPress={() => handleChangeRole(item)}
            style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}
          >
            <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
              {roleConfig.label}
            </Text>
            <Ionicons name="swap-horizontal" size={12} color={roleConfig.color} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => handleToggleActive(item)}
          style={styles.toggleButton}
        >
          <Ionicons
            name={item.isActive ? "checkmark-circle" : "close-circle"}
            size={28}
            color={item.isActive ? COLORS.successText : COLORS.errorText}
          />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Usuarios</Text>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
          renderItem={renderUser}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No hay usuarios</Text>
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
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  backText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "600",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  list: {
    paddingBottom: 32,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  userCardInactive: {
    opacity: 0.6,
  },
  userInfo: {
    flex: 1,
    gap: 4,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  userEmail: {
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  inactiveBadge: {
    backgroundColor: COLORS.errorBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.errorText,
  },
  toggleButton: {
    padding: 6,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
  },
});
