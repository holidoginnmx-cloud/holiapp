import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function AdminRoomLayout() {
  const router = useRouter();

  const handleBack = () => {
    router.replace("/(admin)/rooms" as any);
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
      }}
    >
      <Stack.Screen name="edit" options={{ title: "Editar cuarto", headerLeft: backButton }} />
    </Stack>
  );
}
