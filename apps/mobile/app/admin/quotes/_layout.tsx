import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTeamBack } from "@/hooks/useTeamBack";

export default function AdminQuotesLayout() {
  // Mismo criterio que la pila de reservaciones: el fallback de "atrás" tiene
  // que llevar al tablero del equipo, nunca a la app del cliente.
  const handleBack = useTeamBack("/(admin)/reservations");
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
      <Stack.Screen name="index" options={{ title: "Cotizaciones", headerLeft: backButton }} />
      <Stack.Screen name="create" options={{ title: "Nueva cotización", headerLeft: backButton }} />
      <Stack.Screen name="[id]" options={{ title: "Cotización", headerLeft: backButton }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
