import { COLORS } from "@/constants/colors";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useClerk } from "@clerk/clerk-expo";
import { useAuthStore } from "@/store/authStore";
import { getNotifications } from "@/lib/api";
import { CreditBalancePill } from "@/components/CreditBalancePill";

export default function TabsLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const role = useAuthStore((s) => s.role);
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

  // Role-based routing: once role is loaded, redirect staff/admin to their area
  useEffect(() => {
    console.log("=== TABS ROLE EFFECT ===", { role, isLoaded, isSignedIn });
    if (!role) return;
    if (role === "ADMIN") {
      router.replace("/(admin)/dashboard" as any);
    } else if (role === "STAFF") {
      router.replace("/(staff)/dashboard" as any);
    }
  }, [role]);

  const { data: notifications } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const unreadCount =
    notifications?.filter((n) => !n.isRead).length ?? 0;

  if (!isLoaded) return <View style={{ flex: 1, backgroundColor: "#fff" }} />;
  if (!isSignedIn) return null;

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
        headerRight: () => <CreditBalancePill />,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Inicio",
          tabBarButtonTestID: "tabbar-home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                signOut();
                router.replace("/(auth)/login");
              }}
              style={{ marginLeft: 16 }}
              testID="tabs-signout-button"
            >
              <Ionicons name="chevron-back" size={26} color={COLORS.primary} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginRight: 16 }}>
              <CreditBalancePill />
              <TouchableOpacity
                onPress={() => router.push("/profile/account")}
                testID="tabs-account-button"
              >
                <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="pets"
        options={{
          title: "Mis Mascotas",
          tabBarButtonTestID: "tabbar-pets",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="paw" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reservations"
        options={{
          title: "Reservaciones",
          tabBarButtonTestID: "tabbar-reservations",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notificaciones",
          tabBarButtonTestID: "tabbar-notifications",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
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
        name="help"
        options={{
          title: "Ayuda",
          tabBarButtonTestID: "tabbar-help",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="help-circle" size={size} color={color} />
          ),
        }}
      />
      {/* Hidden detail screen */}
      <Tabs.Screen name="reservation" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
