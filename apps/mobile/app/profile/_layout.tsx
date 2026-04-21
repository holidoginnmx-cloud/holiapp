import { Stack } from "expo-router";
import { COLORS } from "@/constants/colors";

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
      }}
    >
      <Stack.Screen name="credit-history" options={{ title: "Saldo a favor" }} />
      <Stack.Screen name="account" options={{ title: "Mi cuenta" }} />
    </Stack>
  );
}
