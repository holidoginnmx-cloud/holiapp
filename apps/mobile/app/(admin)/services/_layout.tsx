import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function ServicesLayout() {
  const router = useRouter();

  const handleBack = () => {
    router.replace("/(admin)/settings" as any);
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
        headerTintColor: COLORS.primary,
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Servicios y precios", headerLeft: backButton }}
      />
    </Stack>
  );
}
