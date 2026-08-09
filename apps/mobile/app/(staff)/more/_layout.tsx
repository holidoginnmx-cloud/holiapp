import { Stack } from "expo-router";
import { COLORS } from "@/constants/colors";

// ── Stack de la pestaña "Más" ────────────────────────────────────────────────
// El tab bar de Apple solo pinta 5 items: con 6 pestañas visibles iOS fabricaba
// solo su pantalla "More" (UIKit), que no se puede rediseñar. Así que dejamos 4
// pestañas reales + esta, y las secciones que salieron del tab bar viven aquí
// dentro como screens normales: se llega con router.push, con el tab bar puesto
// y con el diseño de la app.
//
// OJO: no valía con marcar las pestañas como `hidden` en NativeTabs — una ruta
// oculta NO se monta (expo-router la filtra de los children) y navegar a ella
// revienta en dev y cae en la primera pestaña visible en producción.
export default function StaffMoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.white },
        headerTitleStyle: {
          color: COLORS.textPrimary,
          fontFamily: "PlusJakartaSans_700Bold",
        },
        headerTintColor: COLORS.primary,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Más" }} />
      <Stack.Screen name="notifications" options={{ title: "Avisos" }} />
      <Stack.Screen name="profile" options={{ title: "Perfil" }} />
    </Stack>
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
