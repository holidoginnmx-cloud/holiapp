import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { SyncStatus } from "@/store/authStore";

type Props = {
  status: SyncStatus;
  /** Mensaje del servidor si rechazó la cuenta (4xx); null = fallo de red. */
  errorMessage?: string | null;
  onRetry: () => void;
  onSignOut?: () => void;
};

/**
 * Pantalla puente mientras no sabemos el ROL del usuario.
 *
 * Antes, si `/users/me` fallaba al arrancar, el equipo aterrizaba en la app de
 * CLIENTE (inicio vacío, sin nombre) y así se quedaba hasta matar la app. Ahora
 * (tabs)/_layout muestra esto en su lugar: spinner mientras se sincroniza y,
 * si se agotaron los intentos, un botón para reintentar (además de los
 * reintentos automáticos del store).
 */
export function ConnectingScreen({ status, errorMessage, onRetry, onSignOut }: Props) {
  const failed = status === "failed";
  // Con un rechazo del servidor (correo ya vinculado a otra cuenta, cuenta
  // sin correo) reintentar no sirve: el único camino es salir y entrar con
  // otra cuenta o escribir al equipo. Antes esta pantalla decía "revisa tu
  // internet" y no tenía salida.
  const rejected = failed && !!errorMessage;

  return (
    <View style={styles.container}>
      {failed ? (
        <Ionicons name="cloud-offline-outline" size={52} color={COLORS.textTertiary} />
      ) : (
        <ActivityIndicator size="large" color={COLORS.primary} />
      )}
      <Text style={styles.title}>
        {rejected
          ? "No pudimos abrir tu cuenta"
          : failed
            ? "No pudimos conectar con Holidog Inn"
            : "Conectando con Holidog Inn…"}
      </Text>
      <Text style={styles.message}>
        {rejected
          ? `${errorMessage} Si crees que es un error, escríbenos por WhatsApp.`
          : failed
            ? "Revisa tu internet. Seguiremos intentando en segundo plano."
            : "Estamos cargando tu cuenta, un momento."}
      </Text>
      {failed && !rejected && (
        <TouchableOpacity style={styles.button} onPress={onRetry} activeOpacity={0.85}>
          <Ionicons name="refresh" size={18} color={COLORS.white} />
          <Text style={styles.buttonText}>Reintentar</Text>
        </TouchableOpacity>
      )}
      {failed && onSignOut && (
        <TouchableOpacity
          style={rejected ? styles.button : styles.linkButton}
          onPress={onSignOut}
          activeOpacity={0.85}
        >
          <Ionicons
            name="log-out-outline"
            size={18}
            color={rejected ? COLORS.white : COLORS.textSecondary}
          />
          <Text style={rejected ? styles.buttonText : styles.linkText}>Cerrar sesión</Text>
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
  title: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginTop: 12,
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 15,
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  linkText: {
    color: COLORS.textSecondary,
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 14,
  },
});
