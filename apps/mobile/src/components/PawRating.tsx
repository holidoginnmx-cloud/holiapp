import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { View, TouchableOpacity, StyleSheet } from "react-native";

/**
 * Las 5 patitas de la calificación. Existía copiada en cuatro pantallas (el
 * modal, la pantalla suelta, el detalle de la reservación y la tarjeta), cada
 * una con su propio tamaño y su propio color de "vacía".
 *
 * Interactiva si recibe `onChange`; sólo lectura si no.
 */
export function PawRating({
  value,
  onChange,
  size = 40,
  gap = 10,
  align = "center",
  emptyColor = COLORS.border,
}: {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  gap?: number;
  align?: "center" | "flex-start";
  /** Color de las patitas vacías; en fondos de color hace falta subirle. */
  emptyColor?: string;
}) {
  const readOnly = !onChange;

  return (
    <View style={[styles.row, { gap, justifyContent: align }]}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= value;
        const paw = (
          <Ionicons
            name={filled ? "paw" : "paw-outline"}
            size={size}
            color={filled ? COLORS.primary : emptyColor}
          />
        );
        if (readOnly) return <View key={i}>{paw}</View>;
        return (
          <TouchableOpacity
            key={i}
            onPress={() => onChange(i)}
            activeOpacity={0.7}
            // El área táctil de una patita de 40px sigue siendo chica para un
            // pulgar; sin esto se falla de calificación con facilidad.
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${i} ${i === 1 ? "patita" : "patitas"}`}
          >
            {paw}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export const RATING_LABELS: Record<number, string> = {
  0: "Toca las patitas para calificar",
  1: "Malo",
  2: "Regular",
  3: "Bueno",
  4: "Muy bueno",
  5: "Excelente",
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
