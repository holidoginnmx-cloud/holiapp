import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

export default function DaycareLayout() {
  const router = useRouter();

  const backButton = () => (
    <HeaderBackButton
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      testID="daycare-back-button"
    />
  );

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen
        name="create"
        options={{ title: "Reservar guardería", headerLeft: backButton }}
      />
    </Stack>
  );
}
