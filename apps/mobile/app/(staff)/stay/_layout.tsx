import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function StayLayout() {
  const router = useRouter();

  const backButton = () => (
    <TouchableOpacity
      onPress={() => router.navigate("/(staff)/stays" as any)}
      style={{ marginLeft: 8 }}
    >
      <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
    </TouchableOpacity>
  );

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
      }}
    >
      <Stack.Screen name="[id]" options={{ title: "Detalle de estancia", headerLeft: backButton }} />
    </Stack>
  );
}
