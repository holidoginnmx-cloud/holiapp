import { useWindowDimensions } from "react-native";

// ── Responsividad tablet (iPad) ──────────────────────────────────
// El iPhone queda bloqueado en vertical (Info.plist), así que su ancho nunca
// llega a TABLET_BREAKPOINT → nunca recibe estilos de tablet. El iPad soporta
// vertical y horizontal, y como todo se deriva de useWindowDimensions() el
// layout reflowea solo al rotar.

/** Ancho mínimo (pt) para tratar la pantalla como tablet. iPad vertical ≈ 768–834. */
export const TABLET_BREAKPOINT = 768;

/** Medida de lectura cómoda para una sola columna (detalle, formularios, listas 1-col). */
export const CONTENT_MAX_WIDTH = 760;

/** Tope más ancho para tableros y listas con rejilla (que quepan 2–3 tarjetas por fila). */
export const WIDE_MAX_WIDTH = 1100;

export interface Responsive {
  width: number;
  height: number;
  /** true en iPad (cualquier orientación). */
  isTablet: boolean;
  /** Columnas sugeridas para rejillas de tarjetas: 1 en teléfono, 2 en iPad vertical, 3 en horizontal/12.9". */
  columns: number;
  /** Separación base entre tarjetas (coincide con los marginBottom/gap existentes). */
  gutter: number;
  /** Ancho de contenido centrado para una columna (min(width, CONTENT_MAX_WIDTH)). */
  contentWidth: number;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  const columns = !isTablet ? 1 : width >= 1024 ? 3 : 2;
  const gutter = 12;
  const contentWidth = Math.min(width, CONTENT_MAX_WIDTH);
  return { width, height, isTablet, columns, gutter, contentWidth };
}
