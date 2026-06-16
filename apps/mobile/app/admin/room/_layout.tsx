import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function AdminRoomLayout() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/admin/rooms" as any);
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
      <Stack.Screen name="[id]" options={{ title: "Detalle del cuarto", headerLeft: backButton }} />
      <Stack.Screen name="edit" options={{ title: "Editar cuarto", headerLeft: backButton }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
