import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTeamBack } from "@/hooks/useTeamBack";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function AdminPetsLayout() {

  // Compartida con el staff: ver useTeamBack.
  const handleBack = useTeamBack("/(admin)/clients");

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontFamily: "PlusJakartaSans_700Bold" },
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen
        name="owner"
        options={{ title: "Nueva mascota", headerLeft: backButton }}
      />
      <Stack.Screen
        name="co-owners"
        options={{ title: "Dueños", headerLeft: backButton }}
      />
    </Stack>
  );
}
