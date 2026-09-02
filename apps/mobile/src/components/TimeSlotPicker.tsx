import { COLORS } from "@/constants/colors";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatTimeHHmm } from "@/lib/format";
import { useTrackedModal } from "@/lib/modalPresentation";

/**
 * Selector de hora por slots de 30 min dentro del horario del hotel
 * (9:00 am – 6:00 pm). Se usa para la hora estimada de llegada/recogida de
 * una reserva: el valor es un string "HH:mm" (hora local del hotel).
 *
 * Viene en dos piezas a propósito:
 *  - `TimeSlotGrid`: solo el contenido. Sirve para incrustarlo en una hoja que
 *    ya existe, SIN presentar un segundo modal encima.
 *  - `TimeSlotPicker`: el grid dentro de su propio `Modal`, para las pantallas
 *    que lo abren desde un formulario normal.
 *
 * El porqué de la separación: anidar este modal dentro de otro (como hacía el
 * recordatorio de horarios) obliga a UIKit a descartar dos view controllers
 * encadenados. Mientras eso pasa, Stripe no puede presentar su hoja de pago y
 * la promesa de `presentPaymentSheet` se queda colgada para siempre.
 */

// 09:00, 09:30, ..., 18:00
export const HOTEL_TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 9; h <= 18; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 18) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
})();

type GridProps = {
  title: string;
  subtitle?: string;
  value: string | null;
  /** Selección (o null al borrar). El caller decide si cierra. */
  onSelect: (value: string | null) => void;
  onClose: () => void;
  /** Slots >= esta hora muestran la etiqueta de advertencia (p.ej. guardería). */
  warnFrom?: string;
  warnLabel?: string;
  /** Slots "HH:mm" a ofrecer. Default: horario del hotel (9:00–18:00). */
  slots?: string[];
};

export function TimeSlotGrid({
  title,
  subtitle,
  value,
  onSelect,
  onClose,
  warnFrom,
  warnLabel,
  slots = HOTEL_TIME_SLOTS,
}: GridProps) {
  return (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={22} color={COLORS.textTertiary} />
        </TouchableOpacity>
      </View>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <ScrollView style={styles.slotsScroll}>
        <View style={styles.grid}>
          {slots.map((slot) => {
            const selected = value === slot;
            const warned = !!warnFrom && slot > warnFrom;
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => onSelect(slot)}
                activeOpacity={0.8}
                testID={`time-slot-${slot}`}
              >
                <Text
                  style={[styles.chipText, selected && styles.chipTextSelected]}
                >
                  {formatTimeHHmm(slot)}
                </Text>
                {warned && warnLabel && (
                  <Text
                    style={[styles.chipWarn, selected && styles.chipTextSelected]}
                  >
                    {warnLabel}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {value && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => onSelect(null)}
          activeOpacity={0.8}
        >
          <Ionicons name="close-circle-outline" size={16} color={COLORS.textTertiary} />
          <Text style={styles.clearBtnText}>Quitar hora</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

type Props = GridProps & { visible: boolean };

export function TimeSlotPicker({ visible, ...grid }: Props) {
  const onDismiss = useTrackedModal(visible);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={grid.onClose}
      onDismiss={onDismiss}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={grid.onClose}
      >
        <TouchableOpacity
          style={styles.sheet}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          <TimeSlotGrid {...grid} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
    maxHeight: "75%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 12,
    lineHeight: 18,
  },
  slotsScroll: {
    flexGrow: 0,
    // Encogible: dentro de una hoja con alto acotado (el recordatorio lo tiene)
    // sin esto la lista desborda en vez de desplazarse.
    flexShrink: 1,
    marginTop: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 8,
  },
  chip: {
    minWidth: "22%",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  chipTextSelected: {
    color: COLORS.white,
  },
  chipWarn: {
    fontSize: 9,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.warningText,
    marginTop: 1,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
  },
  clearBtnText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
});
