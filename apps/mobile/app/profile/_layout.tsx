import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

export default function ProfileLayout() {
  const router = useRouter();

  const backButton = () => (
    <TouchableOpacity
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      style={{ marginLeft: 16 }}
      testID="profile-back-button"
    >
      <Ionicons name="chevron-back" size={26} color={COLORS.primary} />
    </TouchableOpacity>
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
    </Stack>
  );
}
