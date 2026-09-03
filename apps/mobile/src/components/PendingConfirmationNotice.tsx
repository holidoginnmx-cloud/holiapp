import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Estado "ya te cobramos, falta confirmar". Sustituye al `Alert("Error")` que
 * salía cuando el POST de confirmación fallaba después de un cobro exitoso.
 *
 * Mismo criterio que PaymentStuckNotice: se pinta DENTRO del árbol, nunca como
 * Alert, y ofrece un solo camino — reintentar el MISMO POST con el MISMO
 * PaymentIntent. Aquí no hay "cancelar": el dinero ya salió.
 */

type Props = {
  busy?: boolean;
  /** Si el registro quedó guardado, se puede prometer el reintento al abrir la app. */
  persisted: boolean;
  /** "tu reservación" | "tu pago" — de qué se está hablando. */
  subject?: string;
  /** Motivo del último rechazo del servidor (solo si no fue un fallo de red). */
  lastError?: string | null;
  onRetry: () => void;
  /**
   * Solo cuando el rechazo es permanente: deja de esperar, libera el botón de
   * pagar y confía el cobro al equipo (queda en Stripe y en la telemetría).
   */
  onDismiss?: () => void;
};

export function PendingConfirmationNotice({
  busy,
  persisted,
  subject = "tu reservación",
  lastError,
  onRetry,
  onDismiss,
}: Props) {
  return (
    <View style={styles.card} testID="pending-confirmation-notice">
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : (
          <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
        )}
        <Text style={styles.title}>Tu pago se recibió</Text>
      </View>
      <Text style={styles.body}>Estamos confirmando {subject}…</Text>
      {lastError ? (
        <Text style={styles.detail}>
          No pudimos terminar: {lastError}. Si sigue sin confirmarse, escríbenos
          por WhatsApp y lo resolvemos contigo.
        </Text>
      ) : null}
      <Text style={styles.hint}>
        {persisted
          ? "Si cierras la app, lo intentaremos de nuevo al abrirla. Tu pago no se duplicará."
          : "No vuelvas a pagar: tu pago no se duplicará."}
      </Text>
      <TouchableOpacity
        style={[styles.btn, busy && styles.btnDisabled]}
        onPress={onRetry}
        disabled={busy}
        activeOpacity={0.85}
        testID="pending-confirmation-retry"
      >
        {busy ? (
          <ActivityIndicator color={COLORS.white} size="small" />
        ) : (
          <Text style={styles.btnText}>Reintentar</Text>
        )}
      </TouchableOpacity>
      {onDismiss && !busy ? (
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={onDismiss}
          activeOpacity={0.7}
          testID="pending-confirmation-dismiss"
        >
          <Text style={styles.linkText}>Entendido, lo resuelvo con el equipo</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  detail: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  hint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  btn: {
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  linkBtn: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 6,
  },
  linkText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
});
