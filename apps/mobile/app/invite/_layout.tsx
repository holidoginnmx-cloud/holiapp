import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Invitaciones para compartir una mascota. Se llega aquí de dos formas:
//   /invite           → "Tengo un código": se teclea el código de 8 caracteres.
//   /invite/<token>   → la liga del sitio ("Abrir en la app") o el código ya
//                       tecleado. expo-router enruta solo `holidoginn://invite/…`.
export default function InviteLayout() {
  const router = useRouter();

  // Se puede llegar en frío desde la liga, sin nada detrás en el stack.
  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/pets" as any);
  };
  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { fontFamily: "PlusJakartaSans_700Bold" },
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Código de invitación", headerLeft: backButton }} />
      <Stack.Screen name="[token]" options={{ title: "Invitación", headerLeft: backButton }} />
    </Stack>
  );
}
