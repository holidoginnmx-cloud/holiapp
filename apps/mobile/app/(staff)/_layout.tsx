import { COLORS } from "@/constants/colors";
import { useRouter } from "expo-router";
import {
  NativeTabs,
  Icon,
  Label,
  Badge,
  VectorIcon,
} from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { getNotifications } from "@/lib/api";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function StaffLayout() {
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
    // Tab bar NATIVO (UITabBar real). El header de cada pestaña ya no vive aquí:
    // NativeTabs no dibuja headers, así que cada tab monta su propio Stack
    // (ver src/components/TabStack.tsx).
    <NativeTabs
      tintColor={COLORS.primary}
      iconColor={COLORS.textDisabled}
      backgroundColor={COLORS.white}
      badgeBackgroundColor={COLORS.dangerText}
      // iOS 26: minimize-on-scroll nativo. Sustituye al que antes se hacía a
      // mano en JS reportando el onScroll de cada lista.
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="dashboard">
        <Icon src={<VectorIcon family={Ionicons} name="grid-outline" />} />
        <Label>Panel</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="stays">
        <Icon src={<VectorIcon family={Ionicons} name="paw-outline" />} />
        <Label>Estancias</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="baths">
        <Icon src={<VectorIcon family={Ionicons} name="water-outline" />} />
        <Label>Baños</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="daycares">
        <Icon src={<VectorIcon family={Ionicons} name="sunny-outline" />} />
        <Label>Guardería</Label>
      </NativeTabs.Trigger>

      {/* El badge va por `options` y no como <Badge> condicional: setOptions
          mergea, así que una clave que desaparece deja el badge pegado. */}
      <NativeTabs.Trigger
        name="notifications"
        options={{
          badgeValue: unreadCount > 0 ? String(Math.min(unreadCount, 99)) : undefined,
        }}
      >
        <Icon src={<VectorIcon family={Ionicons} name="notifications-outline" />} />
        <Label>Avisos</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Icon src={<VectorIcon family={Ionicons} name="person-outline" />} />
        <Label>Perfil</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
