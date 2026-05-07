import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function ServicesLayout() {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(admin)/settings" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Servicios y precios", headerLeft: backButton }}
      />
      <Stack.Screen name="baths" options={{ title: "Baños" }} />
      <Stack.Screen name="hospedajes" options={{ title: "Hospedajes" }} />
    </Stack>
  );
}
