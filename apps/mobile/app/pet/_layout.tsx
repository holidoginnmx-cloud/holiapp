import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function PetLayout() {
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
      }}
    >
      <Stack.Screen name="[id]" options={{ title: "Detalle de mascota", headerLeft: backButton }} />
      <Stack.Screen name="create" options={{ title: "Nueva mascota", headerLeft: backButton }} />
      <Stack.Screen name="history" options={{ title: "Historial", headerLeft: backButton }} />
    </Stack>
  );
}
