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
 * Salida cuando la hoja de pago no aparece.
 *
 * Se renderiza DENTRO del árbol de React, nunca como `Alert`. Ese es justo el
 * truco: si la hoja de Stripe sí está presentada, su view controller tapa esta
 * vista y el cliente ni la ve ni la puede tocar — así que no molesta a quien
 * está tecleando su tarjeta. Si la hoja nunca llegó a presentarse, esto es lo
 * único que queda en pantalla y le da salida.
 *
 * Un `Alert.alert` haría lo contrario: se pinta encima de la hoja de pago, y
 * además es otro view controller presentado, que es la causa del bug original.
 */

type Props = {
  /** "offer": ofrece reintentar. "processing": hay un cobro en vuelo, solo esperar. */
  kind: "offer" | "processing";
  busy?: boolean;
  onRetry: () => void;
  onCancel: () => void;
};

export function PaymentStuckNotice({ kind, busy, onRetry, onCancel }: Props) {
  if (kind === "processing") {
    return (
      <View style={[styles.card, styles.cardProcessing]} testID="payment-stuck-processing">
        <View style={styles.row}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.title}>Estamos confirmando tu pago</Text>
        </View>
        <Text style={styles.body}>
          Tu banco está procesando el cargo. No cierres la app ni intentes pagar
          de nuevo: en cuanto confirme, terminamos tu reserva.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="payment-stuck-offer">
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={20} color={COLORS.warningText} />
        <Text style={styles.title}>¿No se abrió la ventana de pago?</Text>
      </View>
      <Text style={styles.body}>
        A veces se queda a medio abrir. No te hemos cobrado nada — puedes
        intentarlo otra vez.
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={onCancel}
          disabled={busy}
          activeOpacity={0.8}
          testID="payment-stuck-cancel"
        >
          <Text style={styles.btnGhostText}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
          onPress={onRetry}
          disabled={busy}
          activeOpacity={0.85}
          testID="payment-stuck-retry"
        >
          {busy ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.btnPrimaryText}>Reintentar</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.warningBg,
    borderWidth: 1,
    borderColor: COLORS.warningText,
  },
  cardProcessing: {
    backgroundColor: COLORS.primaryLight,
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
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  btnGhostText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnPrimaryText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
