import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function PetLayout() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/pets" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen name="[id]" options={{ title: "Detalle de mascota", headerLeft: backButton }} />
      <Stack.Screen name="create" options={{ title: "Nueva mascota", headerLeft: backButton }} />
      <Stack.Screen name="history" options={{ title: "Historial", headerLeft: backButton }} />
      <Stack.Screen name="incidents/[id]" options={{ title: "Incidentes", headerLeft: backButton }} />
      <Stack.Screen name="renew-cartilla/[id]" options={{ title: "Renovar cartilla", headerLeft: backButton }} />
    </Stack>
  );
}
