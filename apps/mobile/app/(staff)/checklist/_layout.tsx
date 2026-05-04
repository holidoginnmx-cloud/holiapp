import { COLORS } from "@/constants/colors";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function ChecklistLayout() {
  const router = useRouter();
  const { reservationId } = useLocalSearchParams<{ reservationId?: string }>();

  const handleBack = () => {
    if (reservationId) {
      router.replace(`/(staff)/stay/${reservationId}` as any);
    } else {
      router.replace("/(staff)/stays" as any);
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
      <Stack.Screen name="[reservationId]" options={{ title: "Checklist diario", headerLeft: backButton }} />
    </Stack>
  );
}
