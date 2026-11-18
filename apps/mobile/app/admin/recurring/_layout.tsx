import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTeamBack } from "@/hooks/useTeamBack";

// Citas recurrentes: las usan ADMIN (Ajustes) y STAFF (Más → Registrar).
export default function AdminRecurringLayout() {
  const handleBack = useTeamBack("/(admin)/settings");
  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { fontFamily: "PlusJakartaSans_700Bold" },
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Citas recurrentes", headerLeft: backButton }} />
      <Stack.Screen name="[id]" options={{ title: "Cita recurrente", headerLeft: backButton }} />
      <Stack.Screen name="form" options={{ title: "Nueva cita recurrente", headerLeft: backButton }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
