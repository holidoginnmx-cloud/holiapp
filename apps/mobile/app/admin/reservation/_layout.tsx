import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTeamBack } from "@/hooks/useTeamBack";

export default function AdminReservationLayout() {

  // Compartida con el staff: ver useTeamBack.
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
      <Stack.Screen name="create" options={{ title: "Crear reservación", headerLeft: backButton }} />
      <Stack.Screen name="[id]" options={{ title: "Detalle de reservación", headerLeft: backButton }} />
      <Stack.Screen name="edit-dates" options={{ title: "Modificar fechas", headerLeft: backButton }} />
      <Stack.Screen name="edit-appointment" options={{ title: "Reagendar baño", headerLeft: backButton }} />
      <Stack.Screen name="add-addon" options={{ title: "Agregar servicio", headerLeft: backButton }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
