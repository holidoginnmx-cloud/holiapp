import { ReactNode } from "react";
import {
  View,
  ScrollView,
  StyleProp,
  ViewStyle,
  ScrollViewProps,
} from "react-native";
import { COLORS } from "@/constants/colors";
import { useResponsive, CONTENT_MAX_WIDTH } from "@/lib/responsive";

interface ScreenContainerProps {
  children: ReactNode;
  /** Si es true renderiza un ScrollView interno; si no, un View flex:1. */
  scroll?: boolean;
  /** Ancho máximo del contenido centrado en tablet. Default CONTENT_MAX_WIDTH (760). */
  maxWidth?: number;
  /** Color de fondo de la página (y de los márgenes laterales en tablet). */
  backgroundColor?: string;
  /** Estilo del contenedor externo (a pantalla completa). */
  style?: StyleProp<ViewStyle>;
  /** contentContainerStyle del ScrollView interno (solo en modo scroll). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** RefreshControl del ScrollView interno (solo en modo scroll). */
  refreshControl?: ScrollViewProps["refreshControl"];
  /** Props extra que se pasan tal cual al ScrollView interno. */
  scrollProps?: ScrollViewProps;
}

/**
 * Envoltorio que centra el contenido con un ancho máximo en iPad y es un no-op
 * en teléfono (donde `isTablet` es false → maxWidth undefined = ancho completo).
 * Mantiene intacto el markup interno de cada pantalla: solo reemplaza el
 * `<ScrollView>`/`<View flex:1>` de nivel superior.
 */
export function ScreenContainer({
  children,
  scroll = false,
  maxWidth = CONTENT_MAX_WIDTH,
  backgroundColor = COLORS.bgPage,
  style,
  contentContainerStyle,
  refreshControl,
  scrollProps,
}: ScreenContainerProps) {
  const { isTablet } = useResponsive();
  const cappedWidth = isTablet ? maxWidth : undefined;

  if (scroll) {
    return (
      <View style={[{ flex: 1, alignItems: "center", backgroundColor }, style]}>
        <ScrollView
          style={{ flex: 1, width: "100%", maxWidth: cappedWidth }}
          contentContainerStyle={contentContainerStyle}
          refreshControl={refreshControl}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, alignItems: "center", backgroundColor }, style]}>
      <View style={{ flex: 1, width: "100%", maxWidth: cappedWidth }}>
        {children}
      </View>
    </View>
  );
}
