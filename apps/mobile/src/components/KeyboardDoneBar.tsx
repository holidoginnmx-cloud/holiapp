import { COLORS } from "@/constants/colors";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

/**
 * Barra con "Listo" encima del teclado numérico (iOS).
 *
 * El teclado de números NO trae tecla de retorno, así que un campo de dinero
 * deja al usuario sin salida: el teclado tapa media pantalla —incluido el botón
 * de guardar— y no hay nada que tocar para bajarlo. Esta barra es la salida.
 *
 * Se usa en pareja: se monta una vez por pantalla y cada TextInput numérico
 * apunta a ella con `inputAccessoryViewID={KEYBOARD_DONE_ID}`.
 *
 * En Android no existe `InputAccessoryView` (ni hace falta: el botón "atrás"
 * del sistema baja el teclado), así que no pinta nada.
 */
export const KEYBOARD_DONE_ID = "hdi-teclado-listo";

export function KeyboardDoneBar() {
  if (Platform.OS !== "ios") return null;

  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={styles.bar}>
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          hitSlop={12}
          accessibilityRole="button"
          testID="keyboard-done"
        >
          <Text style={styles.done}>Listo</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  done: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
});
