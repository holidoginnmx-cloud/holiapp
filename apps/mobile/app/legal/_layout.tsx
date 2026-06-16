import { Stack } from "expo-router";
import { COLORS } from "@/constants/colors";

export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        headerTitleStyle: { color: COLORS.textPrimary },
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen name="onboarding" options={{ title: "Consentimientos", headerBackVisible: false }} />
      <Stack.Screen name="tos" options={{ title: "Términos y condiciones" }} />
      <Stack.Screen name="privacy" options={{ title: "Aviso de privacidad" }} />
      <Stack.Screen name="vet-authorization" options={{ title: "Autorización veterinaria" }} />
      <Stack.Screen name="image-consent" options={{ title: "Uso de imagen" }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
