import { COLORS } from "@/constants/colors";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { TouchableOpacity } from "react-native";
import { useAuth } from "@clerk/clerk-expo";

import { useAuthStore } from "@/store/authStore";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function AdminLayout() {
  const { isSignedIn, isLoaded } = useAuth();
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

  if (!isLoaded || !isSignedIn) return null;

  return (
    <Tabs
      screenOptions={{
        // `animation: "shift"` dejaba el contenido del tab en blanco al cambiar
        // de pestaña. Quitarla = cambio instantáneo, estable.
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
              onPress={() => router.push("/admin/account" as any)}
              style={{ marginRight: 16 }}
              testID="admin-account-button"
            >
              <Ionicons
                name="person-circle-outline"
                size={28}
                color={COLORS.primary}
              />
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
        name="baths"
        options={{
          title: "Baños",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="water-outline" size={size} color={color} />
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
    </Tabs>
  );
}
