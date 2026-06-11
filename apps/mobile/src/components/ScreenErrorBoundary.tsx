import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

/**
 * Red de seguridad de render. Expo Router monta este componente cuando una
 * pantalla hija lanza una excepción durante el render, en lugar de dejar la
 * app en blanco (no hay overlay de error en producción).
 *
 * Se re-exporta como `ErrorBoundary` desde cada `_layout.tsx` de grupo para
 * contener el fallo al stack correspondiente y permitir reintentar.
 *
 * Expo Router pasa `{ error, retry }` a este export.
 */
export function ScreenErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={56} color={COLORS.errorText} />
      <Text style={styles.title}>Algo salió mal</Text>
      <Text style={styles.message}>
        No pudimos mostrar esta pantalla. Intenta de nuevo; si el problema
        persiste, avísanos.
      </Text>
      {!!error?.message && (
        <Text style={styles.detail} numberOfLines={3}>
          {error.message}
        </Text>
      )}
      {retry && (
        <TouchableOpacity style={styles.button} onPress={retry} activeOpacity={0.85}>
          <Ionicons name="refresh" size={18} color={COLORS.white} />
          <Text style={styles.buttonText}>Reintentar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: COLORS.bgPage,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  message: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  detail: {
    fontSize: 12,
    color: COLORS.textDisabled,
    textAlign: "center",
    marginTop: 2,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 10,
    marginTop: 12,
  },
  buttonText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 15,
  },
});
