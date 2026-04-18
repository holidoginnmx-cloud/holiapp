import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ServicesLayout() {
  const router = useRouter();

  const backButton = () => (
    <TouchableOpacity
      onPress={() => router.navigate("/(admin)/settings" as any)}
      style={{ marginLeft: 8 }}
    >
      <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
    </TouchableOpacity>
  );

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
