import { COLORS } from "@/constants/colors";
import { useRouter } from "expo-router";
import {
  NativeTabs,
  Icon,
  Label,
  VectorIcon,
} from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import { useAuthStore } from "@/store/authStore";
import { getNotifications } from "@/lib/api";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function TabsLayout() {
  const { isSignedIn, isLoaded } = useAuth();
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
    // Tab bar NATIVO (UITabBar real). El header de cada pestaña vive ahora en el
    // Stack de cada tab (ver src/components/TabStack.tsx), porque NativeTabs no
    // dibuja headers.
    <NativeTabs
      tintColor={COLORS.primary}
      iconColor={COLORS.textDisabled}
      backgroundColor={COLORS.white}
      badgeBackgroundColor={COLORS.dangerText}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="home">
        <Icon src={<VectorIcon family={Ionicons} name="home" />} />
        <Label>Inicio</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="pets">
        <Icon src={<VectorIcon family={Ionicons} name="paw" />} />
        <Label>Mis Mascotas</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reservations">
        <Icon src={<VectorIcon family={Ionicons} name="calendar" />} />
        <Label>Reservaciones</Label>
      </NativeTabs.Trigger>

      {/* El badge va por `options` y no como <Badge> condicional: setOptions
          mergea, así que una clave que desaparece deja el badge pegado. */}
      <NativeTabs.Trigger
        name="notifications"
        options={{
          badgeValue: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : undefined,
        }}
      >
        <Icon src={<VectorIcon family={Ionicons} name="notifications" />} />
        <Label>Notificaciones</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
