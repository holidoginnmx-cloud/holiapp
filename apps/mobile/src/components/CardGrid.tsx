import { Children, ReactNode } from "react";
import { View, StyleProp, ViewStyle } from "react-native";

interface CardGridProps {
  children: ReactNode;
  /** Número de columnas. 1 = stack vertical idéntico al de teléfono. */
  columns: number;
  /** Separación entre celdas (horizontal y vertical). */
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Rejilla flex-wrap. Cada hijo se envuelve en una celda de ancho
 * (100/columns)% con padding horizontal gap/2; el contenedor lleva margin
 * negativo para alinear los bordes. El ritmo VERTICAL entre filas lo aporta el
 * `marginBottom` propio de cada tarjeta (StayCard/BathCard/AlertItem/
 * ReservationCard ya lo tienen), así queda idéntico al del teléfono. Como las
 * tarjetas internas usan flex:1, llenan cada celda sin cambios. Con columns=1
 * es un simple stack vertical. A diferencia de FlatList numColumns, reflowea al
 * rotar sin necesidad de remount.
 */
export function CardGrid({ children, columns, gap = 12, style }: CardGridProps) {
  const items = Children.toArray(children);

  if (columns <= 1) {
    // Camino de teléfono: stack vertical sin envoltorios extra.
    return <View style={style}>{children}</View>;
  }

  const cellWidth = `${100 / columns}%` as const;

  return (
    <View
      style={[
        { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -gap / 2 },
        style,
      ]}
    >
      {items.map((child, i) => (
        <View key={i} style={{ width: cellWidth, paddingHorizontal: gap / 2 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
