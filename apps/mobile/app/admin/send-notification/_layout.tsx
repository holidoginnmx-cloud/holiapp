import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function SendNotificationLayout() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(admin)/settings" as any);
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
      <Stack.Screen name="index" options={{ title: "Notificación", headerLeft: backButton }} />
    </Stack>
  );
}
