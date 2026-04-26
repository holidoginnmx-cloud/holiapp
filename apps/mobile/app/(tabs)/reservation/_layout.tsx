import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function TabsReservationLayout() {
  const router = useRouter();

  const handleBackToReservations = () => {
    router.replace("/(tabs)/reservations" as any);
  };

  const backButton = () => (
    <TouchableOpacity onPress={handleBackToReservations} style={{ marginLeft: 8 }}>
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
    </Stack>
  );
}
