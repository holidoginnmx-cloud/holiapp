import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function UsersLayout() {
  const router = useRouter();

  const handleBack = () => {
    router.replace("/(admin)/settings" as any);
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Usuarios", headerLeft: backButton }} />
    </Stack>
  );
}
