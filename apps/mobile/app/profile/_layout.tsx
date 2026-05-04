import { Stack, useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function ProfileLayout() {
  const router = useRouter();

  const backButton = () => (
    <HeaderBackButton
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      testID="profile-back-button"
    />
  );

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
        headerLeft: backButton,
      }}
    >
      <Stack.Screen name="credit-history" options={{ title: "Saldo a favor" }} />
      <Stack.Screen name="account" options={{ title: "Mi cuenta" }} />
      <Stack.Screen name="edit" options={{ title: "Editar perfil" }} />
    </Stack>
  );
}
