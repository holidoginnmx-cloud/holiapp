import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useClerk } from "@clerk/clerk-expo";
import Constants from "expo-constants";
import { useAuthStore } from "@/store/authStore";
import { formatName } from "@/lib/format";

export default function AdminAccount() {
  const { signOut } = useClerk();
  const router = useRouter();
  const firstName = useAuthStore((s) => s.firstName);
  const lastName = useAuthStore((s) => s.lastName);
  const email = useAuthStore((s) => s.email);

  const handleSignOut = async () => {
    await signOut();
    useAuthStore.getState().logout();
    router.replace("/(auth)/login");
  };

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? "1.0.0";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile header */}
      <View style={styles.headerCard}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(firstName?.[0] ?? "A").toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.name}>
          {formatName(firstName)} {formatName(lastName)}
        </Text>
        <Text style={styles.email}>{email}</Text>
        <View style={styles.roleBadge}>
          <Ionicons name="ribbon" size={11} color={COLORS.primary} />
          <Text style={styles.roleText}>ADMIN</Text>
        </View>
      </View>

      {/* Cuenta */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionIconWrap}>
            <Ionicons name="settings" size={16} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Cuenta</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.menuRow}
          activeOpacity={0.7}
          onPress={() => router.push("/profile/edit" as any)}
        >
          <View
            style={[
              styles.menuIconWrap,
              { backgroundColor: `${COLORS.primary}15` },
            ]}
          >
            <Ionicons name="person-outline" size={16} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>Editar mi información</Text>
            <Text style={styles.menuSubtitle}>Nombre, teléfono y datos</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.border} />
        </TouchableOpacity>

        <View style={[styles.menuRow, styles.menuRowLast]}>
          <View
            style={[styles.menuIconWrap, { backgroundColor: COLORS.bgSection }]}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={COLORS.textTertiary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>Versión de la app</Text>
            <Text style={styles.menuSubtitle}>v{appVersion}</Text>
          </View>
        </View>
      </View>

      {/* Cerrar sesión */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <View style={styles.signOutIconWrap}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.errorText} />
        </View>
        <Text style={styles.signOutText}>Cerrar sesión</Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
  },
  // Header card
  headerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarWrap: {
    marginBottom: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 30,
    fontWeight: "800",
  },
  name: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  email: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 3,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 10,
  },
  roleText: {
    color: COLORS.primary,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.6,
  },
  // Section card
  sectionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  sectionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  // Menu
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  menuSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  // Sign out
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  signOutIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.errorBg,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: {
    color: COLORS.errorText,
    fontSize: 15,
    fontWeight: "700",
  },
});
