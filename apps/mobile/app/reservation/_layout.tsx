import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";


const FROM_TO_PATH: Record<string, string> = {
  home: "/(tabs)/home",
  reservations: "/(tabs)/reservations",
  notifications: "/(tabs)/notifications",
};

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function ReservationLayout() {
  const router = useRouter();

  const handleBack = (from?: string) => {
    if (from && FROM_TO_PATH[from]) {
      router.replace(FROM_TO_PATH[from] as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/reservations" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={() => handleBack()} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen
        name="detail/[id]"
        options={({ route }) => {
          const from = (route.params as { from?: string } | undefined)?.from;
          return {
            title: "Detalle de reservación",
            headerLeft: () => (
              <HeaderBackButton onPress={() => handleBack(from)} />
            ),
          };
        }}
      />
      <Stack.Screen name="create" options={{ title: "Nueva reservación", headerLeft: backButton }} />
      <Stack.Screen name="modify/[id]" options={{ title: "Modificar fechas", headerLeft: backButton }} />
      <Stack.Screen name="checklists/[id]" options={{ title: "Reportes diarios", headerLeft: backButton }} />
      <Stack.Screen name="success" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}
