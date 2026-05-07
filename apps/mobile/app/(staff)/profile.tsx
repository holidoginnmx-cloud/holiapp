import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useClerk } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useAuthStore } from "@/store/authStore";
import { formatName } from "@/lib/format";
import { getStaffStats } from "@/lib/api";

export default function StaffProfile() {
  const { signOut } = useClerk();
  const router = useRouter();
  const firstName = useAuthStore((s) => s.firstName);
  const lastName = useAuthStore((s) => s.lastName);
  const email = useAuthStore((s) => s.email);

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["staff", "me", "stats"],
    queryFn: getStaffStats,
  });

  const handleSignOut = async () => {
    await signOut();
    useAuthStore.getState().logout();
    router.replace("/(auth)/login");
  };

  const memberSinceLabel = stats?.memberSince
    ? new Date(stats.memberSince).toLocaleDateString("es-MX", {
        month: "long",
        year: "numeric",
      })
    : null;

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? "1.0.0";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Profile header */}
      <View style={styles.headerCard}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(firstName?.[0] ?? "S").toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.name}>
          {formatName(firstName)} {formatName(lastName)}
        </Text>
        <Text style={styles.email}>{email}</Text>
        <View style={styles.roleBadge}>
          <Ionicons name="ribbon" size={11} color={COLORS.primary} />
          <Text style={styles.roleText}>STAFF</Text>
        </View>
      </View>

      {/* Mis números */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionIconWrap}>
            <Ionicons name="trophy" size={16} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Mis números</Text>
            <Text style={styles.sectionSubtitle}>
              Resumen de tu trabajo en HDI
            </Text>
          </View>
        </View>

        {loadingStats ? (
          <View style={styles.statsLoading}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : (
          <View style={styles.statsGrid}>
            <StatTile
              icon="paw"
              tint={COLORS.primary}
              value={stats?.totalStays ?? 0}
              label="Estancias atendidas"
            />
            <StatTile
              icon="calendar"
              tint={COLORS.successText}
              value={stats?.monthStays ?? 0}
              label="Este mes"
            />
            <StatTile
              icon="document-text"
              tint={COLORS.infoText}
              value={stats?.checklists ?? 0}
              label="Reportes diarios"
            />
            <StatTile
              icon="camera"
              tint={COLORS.primary}
              value={stats?.updates ?? 0}
              label="Evidencias subidas"
            />
            <StatTile
              icon="warning"
              tint={COLORS.warningText}
              value={stats?.alertsReported ?? 0}
              label="Alertas reportadas"
            />
            <StatTile
              icon="checkmark-circle"
              tint={COLORS.successText}
              value={stats?.alertsResolved ?? 0}
              label="Alertas resueltas"
            />
          </View>
        )}
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

        {memberSinceLabel && (
          <View style={[styles.menuRow, styles.menuRowReadonly]}>
            <View
              style={[
                styles.menuIconWrap,
                { backgroundColor: `${COLORS.successText}15` },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={16}
                color={COLORS.successText}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Miembro desde</Text>
              <Text style={styles.menuSubtitle}>
                {memberSinceLabel.charAt(0).toUpperCase() +
                  memberSinceLabel.slice(1)}
              </Text>
            </View>
          </View>
        )}

        <View style={[styles.menuRow, styles.menuRowReadonly, styles.menuRowLast]}>
          <View
            style={[
              styles.menuIconWrap,
              { backgroundColor: COLORS.bgSection },
            ]}
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

function StatTile({
  icon,
  tint,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIconWrap, { backgroundColor: `${tint}15` }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
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
  // Section cards (Mis números + Cuenta)
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
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  statsLoading: {
    paddingVertical: 24,
    alignItems: "center",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statTile: {
    width: "31.5%",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
  },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 13,
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
  menuRowReadonly: {
    opacity: 1,
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
