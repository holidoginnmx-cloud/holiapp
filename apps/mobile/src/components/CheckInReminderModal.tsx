import { COLORS } from "@/constants/colors";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Recordatorio que se muestra al OWNER al presionar "Pagar y confirmar" en una
 * reserva. El texto usa marcado estilo WhatsApp (`*texto*` = negritas), que se
 * convierte a segmentos en negrita al renderizar.
 */
const REMINDER_TEXT =
  "*RECUERDA* 💡 El *check in* se puede programar en horario de lunes a sábado de 9:00 am a 6:00 pm y el *check out* es de 9:00 am a 1:00 pm ✨👉🏼 Igual puedes programar el *check out* después de la 1:00 pm solo que empieza a considerarse el *tiempo de guardería*, tiene costo de $25 pesos la hora 🙌🏼";

/**
 * Convierte el texto con marcado `*negrita*` en segmentos <Text>. Los segmentos
 * en índices impares (entre asteriscos) se renderizan en negrita.
 */
function renderRichText(raw: string) {
  return raw.split("*").map((segment, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={styles.bold}>
        {segment}
      </Text>
    ) : (
      <Text key={i}>{segment}</Text>
    )
  );
}

interface CheckInReminderModalProps {
  visible: boolean;
  /** Cierra el modal y continúa al cobro. */
  onAcknowledge: () => void;
}

export function CheckInReminderModal({
  visible,
  onAcknowledge,
}: CheckInReminderModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onAcknowledge}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.iconWrap}>
            <Ionicons name="time-outline" size={32} color={COLORS.primary} />
          </View>

          <Text style={styles.message}>{renderRichText(REMINDER_TEXT)}</Text>

          <TouchableOpacity
            style={styles.button}
            onPress={onAcknowledge}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Entendido</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    padding: 22,
    paddingBottom: 28,
  },
  iconWrap: {
    alignSelf: "center",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  message: {
    fontSize: 15,
    lineHeight: 23,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 22,
  },
  bold: {
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
});
