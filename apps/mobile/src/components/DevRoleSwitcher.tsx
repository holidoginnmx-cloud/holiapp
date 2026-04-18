import { COLORS } from "@/constants/colors";
import { useState } from "react";
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useAuthStore } from "@/store/authStore";
import { updateMyRole } from "@/lib/api";

if (!__DEV__) {
  // eslint-disable-next-line no-console
  console.log("[DevRoleSwitcher] Not in dev mode, component disabled");
}

const ROLE_CYCLE = ["OWNER", "STAFF", "ADMIN"] as const;
type Role = (typeof ROLE_CYCLE)[number];

const ROLE_CONFIG: Record<Role, { label: string; bg: string; color: string }> = {
  ADMIN: { label: "ADM", bg: COLORS.primaryLight, color: COLORS.primary },
  STAFF: { label: "STA", bg: COLORS.infoBg, color: COLORS.infoText },
  OWNER: { label: "OWN", bg: COLORS.bgSection, color: COLORS.textTertiary },
};

export function DevRoleSwitcher() {
  if (!__DEV__) return null;

  const role = useAuthStore((s) => s.role) as Role | null;
  const dbUserId = useAuthStore((s) => s.dbUserId);
  const syncUser = useAuthStore((s) => s.syncUser);
  const [loading, setLoading] = useState(false);

  if (!role || !dbUserId) return null;

  const currentIndex = ROLE_CYCLE.indexOf(role);
  const nextRole = ROLE_CYCLE[(currentIndex + 1) % ROLE_CYCLE.length];
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.OWNER;

  const handleSwitch = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await updateMyRole(nextRole);
      await syncUser();
    } catch (e) {
      console.warn("[DevRoleSwitcher] Failed to switch role:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.fab, { backgroundColor: config.bg, borderColor: config.color }]}
      onPress={handleSwitch}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color={config.color} />
      ) : (
        <>
          <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
          <Text style={[styles.arrow, { color: config.color }]}>→</Text>
          <Text style={[styles.label, { color: config.color }]}>
            {ROLE_CONFIG[nextRole].label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 90,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    zIndex: 9999,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  arrow: {
    fontSize: 11,
    fontWeight: "600",
  },
});
