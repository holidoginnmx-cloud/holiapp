import { COLORS } from "@/constants/colors";
import { Stack, useRouter } from "expo-router";
import { HeaderBackButton } from "@/components/HeaderBackButton";

const TYPE_TITLES: Record<string, string> = {
  hospedados: "Hospedados",
  alertas: "Alertas",
  checkins: "Check-ins de hoy",
  checkouts: "Check-outs de hoy",
  reportes: "Reportes pendientes",
};

export default function StaffListLayout() {
  const router = useRouter();

  // Como esta pantalla vive a nivel root (sobre el Tabs container del staff),
  // router.back() pop al tab de origen y anima naturalmente con slide.
  // Si no hay history (deep link), fallback al dashboard.
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(staff)/dashboard" as any);
    }
  };

  const backButton = () => <HeaderBackButton onPress={handleBack} />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
        animationTypeForReplace: "pop",
      }}
    >
      <Stack.Screen
        name="[type]"
        options={({ route }) => {
          const type = (route.params as { type?: string } | undefined)?.type;
          return {
            title: (type && TYPE_TITLES[type]) ?? "Detalles",
            headerLeft: backButton,
          };
        }}
      />
    </Stack>
  );
}
