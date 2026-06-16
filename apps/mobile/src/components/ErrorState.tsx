import { COLORS } from "@/constants/colors";
import { getErrorMessage } from "@/lib/errorMessages";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

type ErrorStateProps = {
  /** Error capturado (de useQuery, mutaciones, etc.). Se traduce con getErrorMessage. */
  error?: unknown;
  /** Mensaje explícito; tiene prioridad sobre `error`. */
  message?: string;
  /** Callback de reintento (p.ej. el `refetch` de la query). */
  onRetry?: () => void;
  /** Variante compacta para usar dentro de secciones o tarjetas pequeñas. */
  compact?: boolean;
};

/**
 * Estado de error consistente para pantallas/secciones que cargan datos.
 * Sustituye la pantalla en blanco que aparecía cuando una `useQuery` fallaba:
 * muestra un mensaje amigable en español y, si se provee `onRetry`, un botón
 * para reintentar.
 *
 * Para crashes de render (no de datos) usa `ScreenErrorBoundary`.
 */
export function ErrorState({ error, message, onRetry, compact }: ErrorStateProps) {
  const text = message ?? getErrorMessage(error);

  return (
    <View style={[styles.container, compact && styles.compact]}>
      <Ionicons
        name="cloud-offline-outline"
        size={compact ? 36 : 52}
        color={COLORS.textTertiary}
      />
      <Text style={styles.title}>No pudimos cargar la información</Text>
      <Text style={styles.message}>{text}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.button} onPress={onRetry} activeOpacity={0.85}>
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
    gap: 8,
  },
  compact: {
    flex: 0,
    paddingVertical: 32,
    backgroundColor: "transparent",
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 4,
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
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
