import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function StaffRootLayout() {
  const router = useRouter();

  // Como las pantallas viven a nivel root (sobre el Tabs container del staff),
  // router.back() pop al tab de origen y anima naturalmente con slide-from-right.
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(staff)/dashboard" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
        headerLeft: backButton,
      }}
    >
      {/* Subdirectorios con su propio _layout.tsx — el Stack root no muestra header */}
      <Stack.Screen name="bath" options={{ headerShown: false }} />
      <Stack.Screen name="stay" options={{ headerShown: false }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
