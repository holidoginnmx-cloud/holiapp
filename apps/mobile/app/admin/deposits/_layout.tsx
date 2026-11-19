import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTeamBack } from "@/hooks/useTeamBack";

// Anticipos sin reserva («Por asignar»): solo ADMIN, desde Ingresos del mes.
export default function AdminDepositsLayout() {
  const handleBack = useTeamBack("/admin/revenue");
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
      <Stack.Screen name="index" options={{ title: "Anticipos por asignar", headerLeft: backButton }} />
      <Stack.Screen name="new" options={{ title: "Anticipo sin reserva", headerLeft: backButton }} />
      <Stack.Screen name="assign" options={{ title: "Asignar anticipo", headerLeft: backButton }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
