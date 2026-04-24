import { COLORS } from "@/constants/colors";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { TouchableOpacity } from "react-native";
import { useAuth, useClerk } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { getNotifications } from "@/lib/api";

export default function StaffLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const userId = useAuthStore((s) => s.userId);
  const syncUser = useAuthStore((s) => s.syncUser);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/(auth)/login");
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (isSignedIn && !userId) {
      syncUser();
    }
  }, [isSignedIn, userId]);

  // Role guard: only STAFF can access this area
  useEffect(() => {
    if (role && role !== "STAFF") {
      router.replace("/(tabs)/home");
    }
  }, [role]);

  const { data: notifications } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    refetchInterval: 30_000,
  });
  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  if (!isLoaded || !isSignedIn) return null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textDisabled,
        tabBarStyle: {
          borderTopColor: COLORS.bgSection,
          paddingBottom: 4,
        },
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Panel",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => {
                signOut();
                router.replace("/(auth)/login");
              }}
              style={{ marginRight: 16 }}
            >
              <Ionicons name="log-out-outline" size={24} color={COLORS.textDisabled} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="stays"
        options={{
          title: "Estancias",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="paw-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="baths"
        options={{
          title: "Baños",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="water-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Avisos",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: COLORS.dangerText,
            fontSize: 11,
            fontWeight: "700",
          },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Hide detail screens from tab bar — headers handled by nested Stack layouts */}
      <Tabs.Screen name="stay" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="checklist" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
