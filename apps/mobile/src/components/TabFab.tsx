import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── FAB que despeja el tab bar nativo ────────────────────────────────────────
// Sustituye a LiquidFab (que se encogía junto a la pastilla flotante custom).
// Con NativeTabs el contenido scrolleable ya lo insetea UIKit solo, pero un FAB
// vive en posición absoluta FUERA del scroll, así que su separación sí hay que
// calcularla. No existe API para leer la altura de la barra nativa
// (react-native-screens no expone useBottomTabBarHeight ni monta
// BottomTabBarHeightContext), de ahí la constante.

/**
 * Alto aproximado de la barra de tabs nativa, sin safe area.
 * iOS clásica ≈ 49, iOS 26 flotante ≈ 54, Android BottomNavigationView = 56.
 */
export const NATIVE_TAB_BAR_HEIGHT = 56;

const FAB_GAP = 16;

export function TabFab({
  style,
  onPress,
  testID,
  accessibilityLabel,
  children,
}: {
  /** Estilo del FAB SIN `bottom`: se calcula aquí sobre la barra nativa. */
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        style,
        { bottom: insets.bottom + NATIVE_TAB_BAR_HEIGHT + FAB_GAP },
        styles.center,
        pressed && { opacity: 0.85 },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
