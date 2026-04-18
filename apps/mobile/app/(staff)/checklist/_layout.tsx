import { COLORS } from "@/constants/colors";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ChecklistLayout() {
  const router = useRouter();
  const { reservationId } = useLocalSearchParams<{ reservationId?: string }>();

  const backButton = () => (
    <TouchableOpacity
      onPress={() =>
        reservationId
          ? router.navigate(`/(staff)/stay/${reservationId}` as any)
          : router.navigate("/(staff)/stays" as any)
      }
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
      <Stack.Screen name="[reservationId]" options={{ title: "Checklist diario", headerLeft: backButton }} />
    </Stack>
  );
}
