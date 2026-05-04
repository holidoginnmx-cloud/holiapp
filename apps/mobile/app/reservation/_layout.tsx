import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function ReservationLayout() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/reservations" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
      }}
    >
      <Stack.Screen name="[id]" options={{ title: "Detalle de reservación", headerLeft: backButton }} />
      <Stack.Screen name="create" options={{ title: "Nueva reservación", headerLeft: backButton }} />
      <Stack.Screen name="modify/[id]" options={{ title: "Modificar fechas", headerLeft: backButton }} />
      <Stack.Screen name="success" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}
