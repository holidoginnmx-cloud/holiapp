import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TimeSlotPicker } from "@/components/TimeSlotPicker";
import { formatTimeHHmm } from "@/lib/format";

/**
 * Recordatorio que se muestra al OWNER al presionar "Pagar y confirmar" en una
 * reserva. El texto usa marcado estilo WhatsApp (`*texto*` = negritas), que se
 * convierte a segmentos en negrita al renderizar. Además permite indicar
 * (opcionalmente) la hora estimada de llegada y recogida; si no la indica,
 * un día antes se le pedirá por notificación.
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

export type ReservationTimes = {
  checkInTime: string | null;
  checkOutTime: string | null;
};

interface CheckInReminderModalProps {
  visible: boolean;
  /** Cierra el modal y continúa al cobro, con las horas elegidas (o null). */
  onAcknowledge: (times: ReservationTimes) => void;
}

export function CheckInReminderModal({
  visible,
  onAcknowledge,
}: CheckInReminderModalProps) {
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [checkOutTime, setCheckOutTime] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => onAcknowledge({ checkInTime, checkOutTime })}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.iconWrap}>
            <Ionicons name="time-outline" size={32} color={COLORS.primary} />
          </View>

          <Text style={styles.message}>{renderRichText(REMINDER_TEXT)}</Text>

          {/* Hora estimada (opcional). Si no la eligen aquí, se pide por
              notificación un día antes del check-in / check-out. */}
          <Text style={styles.timesTitle}>
            ¿Ya sabes tus horarios? (opcional)
          </Text>
          <View style={styles.timesRow}>
            <TouchableOpacity
              style={[styles.timeBtn, checkInTime && styles.timeBtnSet]}
              onPress={() => setPickerFor("in")}
              activeOpacity={0.8}
              testID="reminder-checkin-time"
            >
              <Text style={styles.timeBtnLabel}>Llegada</Text>
              <Text
                style={[
                  styles.timeBtnValue,
                  checkInTime && styles.timeBtnValueSet,
                ]}
              >
                {checkInTime ? formatTimeHHmm(checkInTime) : "Elegir"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.timeBtn, checkOutTime && styles.timeBtnSet]}
              onPress={() => setPickerFor("out")}
              activeOpacity={0.8}
              testID="reminder-checkout-time"
            >
              <Text style={styles.timeBtnLabel}>Recogida</Text>
              <Text
                style={[
                  styles.timeBtnValue,
                  checkOutTime && styles.timeBtnValueSet,
                ]}
              >
                {checkOutTime ? formatTimeHHmm(checkOutTime) : "Elegir"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.timesHint}>
            Si aún no lo sabes, te lo preguntaremos un día antes.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => onAcknowledge({ checkInTime, checkOutTime })}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Continuar</Text>
          </TouchableOpacity>

          <TimeSlotPicker
            visible={pickerFor !== null}
            title={pickerFor === "in" ? "Hora de llegada" : "Hora de recogida"}
            subtitle={
              pickerFor === "in"
                ? "¿A qué hora planeas dejar a tu peludito?"
                : "¿A qué hora planeas recogerlo? Después de la 1:00 pm aplica guardería ($25/h)."
            }
            value={pickerFor === "in" ? checkInTime : checkOutTime}
            warnFrom={pickerFor === "out" ? "13:00" : undefined}
            warnLabel={pickerFor === "out" ? "guardería" : undefined}
            onSelect={(v) => {
              if (pickerFor === "in") setCheckInTime(v);
              else if (pickerFor === "out") setCheckOutTime(v);
              setPickerFor(null);
            }}
            onClose={() => setPickerFor(null)}
          />
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
    marginBottom: 18,
  },
  bold: {
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  timesTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 10,
  },
  timesRow: {
    flexDirection: "row",
    gap: 10,
  },
  timeBtn: {
    flex: 1,
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  timeBtnSet: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  timeBtnLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  timeBtnValue: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  timeBtnValueSet: {
    color: COLORS.primary,
  },
  timesHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 16,
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
