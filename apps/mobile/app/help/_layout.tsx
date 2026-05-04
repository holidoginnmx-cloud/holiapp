import { Stack, useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function HelpLayout() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/home" as any);
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
      }}
    >
      <Stack.Screen
        name="refund-policy"
        options={{ title: "Política de reembolsos", headerLeft: backButton }}
      />
    </Stack>
  );
}
