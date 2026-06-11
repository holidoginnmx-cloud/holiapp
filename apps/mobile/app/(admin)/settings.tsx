import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useClerk } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/store/authStore";
import { getPendingCartillasCount } from "@/lib/api";
import { formatName } from "@/lib/format";

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  iconTint?: string;
  iconBg?: string;
  badge?: number;
  isLast?: boolean;
  destructive?: boolean;
}

function MenuItem({
  icon,
  label,
  subtitle,
  onPress,
  iconTint = COLORS.primary,
  iconBg,
  badge,
  isLast,
  destructive,
}: MenuItemProps) {
  const tint = destructive ? COLORS.errorText : iconTint;
  const bg = iconBg ?? (destructive ? COLORS.errorBg : `${tint}15`);
  return (
    <TouchableOpacity
      style={[styles.menuItem, isLast && styles.menuItemLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={styles.menuTextGroup}>
        <Text
          style={[
            styles.menuLabel,
            destructive && { color: COLORS.errorText },
          ]}
        >
          {label}
        </Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
      {badge !== undefined && badge > 0 && (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>
            {badge > 99 ? "99+" : badge}
          </Text>
        </View>
      )}
      {!destructive && (
        <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
      )}
    </TouchableOpacity>
  );
}

export default function AdminSettings() {
  const router = useRouter();
  const { signOut } = useClerk();
  const firstName = useAuthStore((s) => s.firstName);
  const lastName = useAuthStore((s) => s.lastName);
  const email = useAuthStore((s) => s.email);

  const { data: cartillasPending } = useQuery({
    queryKey: ["admin", "cartillas", "pending-count"],
    queryFn: getPendingCartillasCount,
    refetchInterval: 60_000,
  });
  const cartillasCount = cartillasPending?.pending ?? 0;

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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(firstName?.[0] ?? "A").toUpperCase()}
          </Text>
        </View>
        <View>
          <Text style={styles.profileName}>
            {formatName(firstName)} {formatName(lastName)}
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
          iconTint={COLORS.primary}
          label="Gestionar usuarios"
          subtitle="Ver, cambiar roles y activar/desactivar"
          onPress={() => router.push("/admin/users" as any)}
        />
        <MenuItem
          icon="notifications-outline"
          iconTint={COLORS.infoText}
          label="Enviar notificacion"
          subtitle="Notificar a clientes individuales o todos"
          onPress={() => router.push("/admin/send-notification" as any)}
        />
        <MenuItem
          icon="pricetags-outline"
          iconTint={COLORS.primary}
          label="Servicios y precios"
          subtitle="Administrar servicios, variantes y precios"
          onPress={() => router.push("/admin/services" as any)}
        />
        <MenuItem
          icon="bed-outline"
          iconTint={COLORS.primary}
          label="Cuartos"
          subtitle="Ver ocupación, alta, edición y disponibilidad"
          onPress={() => router.push("/admin/rooms" as any)}
        />
        <MenuItem
          icon="water-outline"
          iconTint={COLORS.infoText}
          label="Agenda de baños"
          subtitle="Horario, duración del slot y capacidad simultánea"
          onPress={() => router.push("/admin/bath-config" as any)}
        />
        <MenuItem
          icon="car-outline"
          iconTint={COLORS.primary}
          label="Servicio a domicilio"
          subtitle="Tarifa base y precio por km del servicio a domicilio"
          onPress={() => router.push("/admin/delivery-config" as any)}
        />
        <MenuItem
          icon="warning-outline"
          iconTint={COLORS.warningText}
          label="Alertas"
          subtitle="Incidentes, salud, comportamiento y vacunas por vencer"
          onPress={() => router.push("/admin/alerts" as any)}
        />
        <MenuItem
          icon="shield-checkmark-outline"
          iconTint={COLORS.successText}
          label="Cartillas"
          subtitle={
            cartillasCount > 0
              ? `${cartillasCount} pendiente${cartillasCount === 1 ? "" : "s"} de revisar`
              : "Revisar y aprobar cartillas de vacunación"
          }
          badge={cartillasCount}
          onPress={() => router.push("/admin/cartillas" as any)}
        />
        <MenuItem
          icon="cash-outline"
          iconTint={COLORS.successText}
          label="Ingresos"
          subtitle="Resumen de ingresos del mes y desglose"
          onPress={() => router.push("/admin/revenue" as any)}
          isLast
        />
      </View>

      <View style={styles.menuSection}>
        <MenuItem
          icon="log-out-outline"
          label="Cerrar sesion"
          onPress={handleLogout}
          destructive
          isLast
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    gap: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: "800",
  },
  profileName: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  profileEmail: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  menuSection: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  menuSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  menuBadge: {
    backgroundColor: COLORS.errorText,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  menuBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.white,
  },
});
