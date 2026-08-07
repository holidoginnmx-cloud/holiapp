import { COLORS } from "@/constants/colors";
import { View, Text, Switch, StyleSheet } from "react-native";

/**
 * Interruptor nativo con etiqueta (y pista opcional) para las opciones sí/no de
 * un formulario. Sustituye al par de botones "No / Sí" cuando la opción es un
 * simple encendido: se lee de un vistazo y ocupa un renglón.
 */

type Props = {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Sub-opción de otro switch: se dibuja indentada y más chica. */
  nested?: boolean;
  testID?: string;
};

export function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  nested,
  testID,
}: Props) {
  return (
    <View style={[styles.row, nested && styles.rowNested]}>
      <View style={styles.textCol}>
        <Text style={[styles.label, nested && styles.labelNested]}>{label}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
        thumbColor={value ? COLORS.primary : COLORS.textDisabled}
        style={nested ? styles.switchNested : undefined}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
  },
  // Sub-opción: indentada, más compacta y con el switch a escala menor, para
  // que se lea como dependiente del switch de arriba y no como un hermano.
  rowNested: {
    marginLeft: 20,
    marginTop: 0,
    marginBottom: 4,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: COLORS.bgSection,
  },
  textCol: { flex: 1 },
  label: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  labelNested: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_500Medium",
    color: COLORS.textSecondary,
  },
  switchNested: { transform: [{ scale: 0.85 }] },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
});
