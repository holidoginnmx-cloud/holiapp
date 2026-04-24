import { COLORS } from "@/constants/colors";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { TouchableOpacity } from "react-native";
import { useAuth, useClerk } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/store/authStore";
import { getPendingCartillasCount } from "@/lib/api";

export default function AdminLayout() {
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

  // Role guard: only ADMIN can access this area
  useEffect(() => {
    if (role && role !== "ADMIN") {
      router.replace("/(tabs)/home");
    }
  }, [role]);

  const { data: pendingCartillas } = useQuery({
    queryKey: ["admin", "cartillas", "pending-count"],
    queryFn: getPendingCartillasCount,
    enabled: role === "ADMIN",
    refetchInterval: 30_000,
  });
  const pendingCount = pendingCartillas?.pending ?? 0;

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
        name="reservations"
        options={{
          title: "Reservaciones",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: "Mascotas",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="paw-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rooms"
        options={{
          title: "Cuartos",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bed-outline" size={size} color={color} />
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
        name="cartillas"
        options={{
          title: "Cartillas",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="shield-checkmark-outline" size={size} color={color} />
          ),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: COLORS.errorText,
            color: COLORS.white,
            fontSize: 11,
            fontWeight: "700",
          },
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          href: null,
          title: "Alertas del staff",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace("/(admin)/settings" as any)
              }
              style={{ marginLeft: 16 }}
            >
              <Ionicons name="chevron-back" size={26} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen name="change-requests" options={{ href: null }} />
      <Tabs.Screen name="services" options={{ href: null, headerShown: false }} />
      <Tabs.Screen
        name="bath-config"
        options={{
          href: null,
          title: "Agenda de baños",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace("/(admin)/settings" as any)
              }
              style={{ marginLeft: 16 }}
            >
              <Ionicons name="chevron-back" size={26} color={COLORS.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Ajustes",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Hide detail screens from tab bar — headers handled by nested Stack layouts */}
      <Tabs.Screen name="reservation" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="room" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="users" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="send-notification" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
