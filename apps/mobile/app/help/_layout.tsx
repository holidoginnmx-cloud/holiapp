import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

export default function HelpLayout() {
  const router = useRouter();

  const backButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 8 }}>
      <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
    </TouchableOpacity>
  );

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
