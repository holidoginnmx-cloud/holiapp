import { COLORS } from "@/constants/colors";
import { Stack } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useTeamBack } from "@/hooks/useTeamBack";

export default function UsersLayout() {

  // Compartida con el staff: ver useTeamBack.
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
      <Stack.Screen name="index" options={{ title: "Usuarios", headerLeft: backButton }} />
      <Stack.Screen name="create" options={{ title: "Nuevo cliente" }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
