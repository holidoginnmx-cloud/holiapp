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
  /** Estilo del elemento raíz: el ScrollView en modo scroll, el View si no. */
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
 *
 * En modo `scroll` el ScrollView es la RAÍZ de la pantalla, sin ningún View
 * envolviéndolo: iOS 26 solo engancha el minimize del tab bar
 * (`minimizeBehavior`) al scroll que encuentra como primera subvista del view
 * controller. El centrado de iPad se hace por eso en el contentContainer
 * (maxWidth + alignSelf) y no con un contenedor extra.
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
      <ScrollView
        style={[{ flex: 1, backgroundColor }, style]}
        contentContainerStyle={[
          isTablet && { width: "100%", maxWidth: cappedWidth, alignSelf: "center" },
          contentContainerStyle,
        ]}
        refreshControl={refreshControl}
        // El tab bar nativo entra en el safeArea del view controller y el
        // UIScrollView lo absorbe solo: ya no hacen falta colchones a mano.
        contentInsetAdjustmentBehavior="automatic"
        {...scrollProps}
      >
        {children}
      </ScrollView>
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
