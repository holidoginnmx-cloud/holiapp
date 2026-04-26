import { Stack } from "expo-router";

export default function WelcomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
      <Stack.Screen name="tour" />
    </Stack>
  );
}
