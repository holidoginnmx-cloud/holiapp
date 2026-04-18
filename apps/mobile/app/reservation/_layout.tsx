import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ReservationLayout() {
  const router = useRouter();
  console.log("📋 [ReservationLayout] MOUNTED");

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
      <Stack.Screen name="[id]" options={{ title: "Detalle de reservación", headerLeft: backButton }} />
      <Stack.Screen name="create" options={{ title: "Nueva reservación", headerLeft: backButton }} />
      <Stack.Screen name="modify/[id]" options={{ title: "Modificar fechas", headerLeft: backButton }} />
    </Stack>
  );
}
