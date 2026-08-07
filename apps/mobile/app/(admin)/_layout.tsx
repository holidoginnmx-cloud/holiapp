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
    // Tab bar NATIVO (UITabBar real). El header de cada pestaña vive ahora en el
    // Stack de cada tab (ver src/components/TabStack.tsx), porque NativeTabs no
    // dibuja headers.
    <NativeTabs
      tintColor={COLORS.primary}
      iconColor={COLORS.textDisabled}
      backgroundColor={COLORS.white}
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

      <NativeTabs.Trigger name="settings">
        <Icon src={<VectorIcon family={Ionicons} name="settings-outline" />} />
        <Label>Ajustes</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
