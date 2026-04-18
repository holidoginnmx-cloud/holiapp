import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useClerk } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  color?: string;
}

function MenuItem({
  icon,
  label,
  subtitle,
  onPress,
  color = COLORS.textPrimary,
}: MenuItemProps) {
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={22} color={color} />
      <View style={styles.menuTextGroup}>
        <Text style={[styles.menuLabel, { color }]}>{label}</Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
    </TouchableOpacity>
  );
}

export default function AdminSettings() {
  const router = useRouter();
  const { signOut } = useClerk();
  const firstName = useAuthStore((s) => s.firstName);
  const lastName = useAuthStore((s) => s.lastName);
  const email = useAuthStore((s) => s.email);

  const handleLogout = () => {
    Alert.alert("Cerrar sesion", "¿Estas seguro?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesion",
        style: "destructive",
        onPress: () => {
          signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      {/* Profile */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(firstName?.[0] ?? "A").toUpperCase()}
          </Text>
        </View>
        <View>
          <Text style={styles.profileName}>
            {firstName} {lastName}
          </Text>
          <Text style={styles.profileEmail}>{email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>ADMIN</Text>
          </View>
        </View>
      </View>

      {/* Menu */}
      <View style={styles.menuSection}>
        <MenuItem
          icon="people-outline"
          label="Gestionar usuarios"
          subtitle="Ver, cambiar roles y activar/desactivar"
          onPress={() => router.push("/(admin)/users" as any)}
        />
        <MenuItem
          icon="notifications-outline"
          label="Enviar notificacion"
          subtitle="Notificar a clientes individuales o todos"
          onPress={() => router.push("/(admin)/send-notification" as any)}
        />
        <MenuItem
          icon="pricetags-outline"
          label="Servicios y precios"
          subtitle="Administrar servicios, variantes y precios"
          onPress={() => router.push("/(admin)/services" as any)}
        />
      </View>

      <View style={styles.menuSection}>
        <MenuItem
          icon="log-out-outline"
          label="Cerrar sesion"
          onPress={handleLogout}
          color={COLORS.errorText}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
    padding: 16,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    gap: 14,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: "700",
  },
  profileName: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  roleBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },
  menuSection: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  menuTextGroup: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  menuSubtitle: {
    fontSize: 12,
    color: COLORS.textDisabled,
    marginTop: 2,
  },
});
