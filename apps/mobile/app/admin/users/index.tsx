import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getUsers, updateUser, type AdminUserListItem } from "@/lib/api";
import { useOptimisticMutation } from "@/hooks/useOptimisticMutation";
import type { User } from "@holidoginn/shared";
import { formatName, displayEmail, NO_EMAIL_LABEL } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

type RoleFilter = "OWNER" | "STAFF" | "ADMIN";

const ROLE_CONFIG: Record<
  RoleFilter,
  {
    label: string;
    pluralLabel: string;
    bg: string;
    color: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  OWNER: {
    label: "Cliente",
    pluralLabel: "Clientes",
    bg: COLORS.bgSection,
    color: COLORS.textTertiary,
    icon: "person-outline",
  },
  STAFF: {
    label: "Staff",
    pluralLabel: "Staff",
    bg: COLORS.infoBg,
    color: COLORS.infoText,
    icon: "construct-outline",
  },
  ADMIN: {
    label: "Admin",
    pluralLabel: "Admins",
    bg: COLORS.primaryLight,
    color: COLORS.primary,
    icon: "shield-checkmark-outline",
  },
};

const FILTER_ORDER: RoleFilter[] = ["OWNER", "STAFF", "ADMIN"];
const ALL_ROLES = ["OWNER", "STAFF", "ADMIN"] as const;

export default function AdminUsers() {
  const router = useRouter();
  const [filter, setFilter] = useState<RoleFilter>("OWNER");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  const counts = useMemo(() => {
    const c: Record<RoleFilter, number> = { OWNER: 0, STAFF: 0, ADMIN: 0 };
    for (const u of data ?? []) {
      if (u.role === "OWNER" || u.role === "STAFF" || u.role === "ADMIN") {
        c[u.role]++;
      }
    }
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    const byRole = (data ?? []).filter((u) => u.role === filter);
    const q = search.trim().toLowerCase();
    if (!q) return byRole;
    return byRole.filter((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      const phone = (u.phone ?? "").toLowerCase();
      return name.includes(q) || email.includes(q) || phone.includes(q);
    });
  }, [data, filter, search]);

  // Optimista: el badge/toggle cambia en el mismo frame del tap; si el server
  // rechaza se revierte y se muestra el error. onSettled reconcilia la lista.
  const mutation = useOptimisticMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<User> }) =>
      updateUser(id, data),
    patches: [
      {
        queryKey: ["admin", "users"],
        updater: (old, { id, data }) =>
          (old as AdminUserListItem[]).map((u) =>
            u.id === id ? { ...u, ...data } : u
          ),
      },
    ],
    invalidateKeys: [["admin", "users"]],
    errorTitle: "No se pudo actualizar",
  });

  // Fila con mutación en vuelo → deshabilitada (evita doble tap mientras
  // el server confirma el cambio ya visible).
  const pendingUserId = mutation.isPending ? mutation.variables?.id : null;

  const handleToggleActive = (user: User) => {
    const newState = !user.isActive;
    Alert.alert(
      newState ? "Activar usuario" : "Desactivar usuario",
      `¿${newState ? "Activar" : "Desactivar"} a ${formatName(user.firstName)} ${formatName(user.lastName)}?`,
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
    const alternatives = ALL_ROLES.filter((r) => r !== user.role);
    const currentLabel = ROLE_CONFIG[user.role]?.label ?? user.role;

    Alert.alert(
      "Cambiar rol",
      `${formatName(user.firstName)} ${formatName(user.lastName)} es ${currentLabel}. ¿A qué rol cambiar?`,
      [
        ...alternatives.map((role) => ({
          text: `Cambiar a ${ROLE_CONFIG[role].label}`,
          onPress: () =>
            mutation.mutate({ id: user.id, data: { role: role as any } }),
        })),
        { text: "Cancelar", style: "cancel" as const },
      ]
    );
  };

  const renderUser = ({ item }: { item: AdminUserListItem }) => {
    const roleConfig = ROLE_CONFIG[item.role] || ROLE_CONFIG.OWNER;
    const pending = item.id === pendingUserId;

    return (
      <View style={[styles.userCard, !item.isActive && styles.userCardInactive]}>
        <View style={styles.userInfo}>
          <View style={styles.userHeader}>
            <Text style={styles.userName}>
              {formatName(item.firstName)} {formatName(item.lastName)}
            </Text>
            {!item.isActive && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>Inactivo</Text>
              </View>
            )}
          </View>
          <Text
            style={[styles.userEmail, !displayEmail(item.email) && styles.userEmailMuted]}
          >
            {displayEmail(item.email) || NO_EMAIL_LABEL}
          </Text>
          <View style={styles.badgeRow}>
            <TouchableOpacity
              onPress={() => handleChangeRole(item)}
              disabled={pending}
              style={[
                styles.roleBadge,
                { backgroundColor: roleConfig.bg },
                pending && styles.pendingControl,
              ]}
            >
              <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
                {roleConfig.label}
              </Text>
              {pending ? (
                <ActivityIndicator size={12} color={roleConfig.color} />
              ) : (
                <Ionicons name="swap-horizontal" size={12} color={roleConfig.color} />
              )}
            </TouchableOpacity>
            {item.role === "OWNER" && (
              <View
                style={[
                  styles.appBadge,
                  item.hasApp ? styles.appBadgeOn : styles.appBadgeOff,
                ]}
              >
                <Ionicons
                  name={item.hasApp ? "phone-portrait" : "phone-portrait-outline"}
                  size={11}
                  color={item.hasApp ? COLORS.successText : COLORS.textTertiary}
                />
                <Text
                  style={[
                    styles.appBadgeText,
                    { color: item.hasApp ? COLORS.successText : COLORS.textTertiary },
                  ]}
                >
                  {item.hasApp ? "Tiene app" : "Sin registrar"}
                </Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => handleToggleActive(item)}
          disabled={pending}
          style={[styles.toggleButton, pending && styles.pendingControl]}
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

      <View style={styles.filterRow}>
        {FILTER_ORDER.map((key) => {
          const cfg = ROLE_CONFIG[key];
          const isActive = filter === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.filterPill,
                {
                  backgroundColor: isActive ? cfg.color : cfg.bg,
                  borderColor: isActive ? cfg.color : "transparent",
                },
              ]}
              onPress={() => setFilter(key)}
              activeOpacity={0.85}
            >
              <Ionicons
                name={cfg.icon}
                size={16}
                color={isActive ? COLORS.white : cfg.color}
              />
              <Text
                style={[
                  styles.filterPillText,
                  { color: isActive ? COLORS.white : cfg.color },
                ]}
              >
                {cfg.pluralLabel}
              </Text>
              <View
                style={[
                  styles.filterCountBubble,
                  {
                    backgroundColor: isActive
                      ? "rgba(255,255,255,0.25)"
                      : COLORS.white,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterCountText,
                    { color: isActive ? COLORS.white : cfg.color },
                  ]}
                >
                  {counts[key]}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={COLORS.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, correo o teléfono"
          placeholderTextColor={COLORS.textDisabled}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={COLORS.textDisabled} />
          </TouchableOpacity>
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
              <Ionicons
                name={ROLE_CONFIG[filter].icon}
                size={36}
                color={COLORS.textDisabled}
              />
              <Text style={styles.emptyText}>
                No hay {ROLE_CONFIG[filter].pluralLabel.toLowerCase()}
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
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  filterPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  filterCountBubble: {
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: "800",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },
  list: {
    paddingBottom: 32,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  appBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  appBadgeOn: {
    backgroundColor: COLORS.successBg,
  },
  appBadgeOff: {
    backgroundColor: COLORS.bgSection,
  },
  appBadgeText: {
    fontSize: 12,
    fontWeight: "700",
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
  userEmailMuted: {
    fontStyle: "italic",
    color: COLORS.textDisabled,
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
  pendingControl: {
    opacity: 0.5,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textDisabled,
    fontWeight: "600",
  },
});
