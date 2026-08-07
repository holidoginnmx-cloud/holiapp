import type { ReactNode } from "react";
import { Stack } from "expo-router";
import { COLORS } from "@/constants/colors";

// ── Header de una pestaña ────────────────────────────────────────────────────
// El tab bar nativo (NativeTabs) no dibuja headers: a diferencia del navegador
// de Tabs de react-navigation, no tiene ninguna opción de header. Así que cada
// pestaña monta su propio Stack de un solo screen, que es quien pone el título
// y el headerRight. Esto replica exactamente el header que antes venía del
// `screenOptions` de <Tabs>.

interface TabStackProps {
  /** Título del header (equivale al `title` del antiguo Tabs.Screen). */
  title: string;
  /** Contenido a la derecha del header (píldora de crédito, botón de cuenta…). */
  headerRight?: () => ReactNode;
}

export function TabStack({ title, headerRight }: TabStackProps) {
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
      <Stack.Screen name="index" options={{ title, headerRight }} />
    </Stack>
  );
}
