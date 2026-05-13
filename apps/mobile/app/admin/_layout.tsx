import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

export default function AdminRootLayout() {
  const router = useRouter();

  // Como las pantallas viven a nivel root (sobre el Tabs container del admin),
  // router.back() pop al tab de origen y anima naturalmente con slide-from-right.
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(admin)/dashboard" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" },
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
        headerLeft: backButton,
      }}
    >
      <Stack.Screen name="cartillas" options={{ title: "Cartillas" }} />
      <Stack.Screen name="alerts" options={{ title: "Alertas" }} />
      <Stack.Screen
        name="change-requests"
        options={{ title: "Solicitudes de cambio" }}
      />
      <Stack.Screen name="checkins" options={{ title: "Check-ins de hoy" }} />
      <Stack.Screen
        name="checkouts"
        options={{ title: "Check-outs de hoy" }}
      />
      <Stack.Screen name="revenue" options={{ title: "Ingresos del mes" }} />
      <Stack.Screen
        name="revenue-breakdown"
        options={{ title: "Por método de pago" }}
      />
      <Stack.Screen
        name="bath-config"
        options={{ title: "Agenda de baños" }}
      />
      <Stack.Screen name="rooms" options={{ title: "Cuartos" }} />
      {/* Subdirectorios con su propio _layout.tsx — el Stack root no muestra header */}
      <Stack.Screen name="services" options={{ headerShown: false }} />
      <Stack.Screen name="users" options={{ headerShown: false }} />
      <Stack.Screen
        name="send-notification"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="reservation" options={{ headerShown: false }} />
      <Stack.Screen name="room" options={{ headerShown: false }} />
    </Stack>
  );
}
