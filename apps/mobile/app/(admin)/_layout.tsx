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
import { useAuth } from "@clerk/clerk-expo";

import { useAuthStore } from "@/store/authStore";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function AdminLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const userId = useAuthStore((s) => s.userId);
  const syncUser = useAuthStore((s) => s.syncUser);
  const { unreadCount } = useUnreadNotifications();

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
      <NativeTabs.Trigger name="dashboard">
        <Icon src={<VectorIcon family={Ionicons} name="grid-outline" />} />
        <Label>Panel</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reservations">
        <Icon src={<VectorIcon family={Ionicons} name="calendar-outline" />} />
        <Label>Reservaciones</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="clients">
        <Icon src={<VectorIcon family={Ionicons} name="paw-outline" />} />
        <Label>Mascotas</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="baths">
        <Icon src={<VectorIcon family={Ionicons} name="water-outline" />} />
        <Label>Baños</Label>
      </NativeTabs.Trigger>

      {/* Avisos vive dentro de Ajustes (el tab bar ya está lleno; con seis
          triggers visibles UIKit pinta cinco y genera su propia pantalla
          "More"). El badge de no leídos se hereda aquí para que el aviso no se
          pierda cuando el admin está en otra pestaña. Va por `options` y no
          como <Badge> condicional: setOptions mergea, así que una clave que
          desaparece dejaría el badge pegado. */}
      <NativeTabs.Trigger
        name="settings"
        options={{
          badgeValue:
            unreadCount > 0 ? String(Math.min(unreadCount, 99)) : undefined,
        }}
      >
        <Icon src={<VectorIcon family={Ionicons} name="settings-outline" />} />
        <Label>Ajustes</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
