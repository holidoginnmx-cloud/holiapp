import { COLORS } from "@/constants/colors";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  InteractionManager,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TimeSlotGrid } from "@/components/TimeSlotPicker";
import { useTrackedModal } from "@/lib/modalPresentation";
import { formatTimeHHmm } from "@/lib/format";

/**
 * Recordatorio que se muestra al OWNER al presionar "Pagar y confirmar" en una
 * reserva. El texto usa marcado estilo WhatsApp (`*texto*` = negritas), que se
 * convierte a segmentos en negrita al renderizar. Además permite indicar
 * (opcionalmente) la hora estimada de llegada y recogida; si no la indica,
 * un día antes se le pedirá por notificación.
 *
 * El selector de horas se renderiza DENTRO de esta misma hoja, intercambiando el
 * contenido. Antes era un `Modal` anidado, y eso obligaba a descartar dos view
 * controllers encadenados justo antes del cobro: mientras eso pasa, Stripe no
 * puede presentar su hoja de pago y el botón se queda girando para siempre.
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
  /**
   * Se dispara cuando el modal terminó de cerrarse — no cuando se pidió que se
   * cerrara. Sirve para arrancar el cobro en cuanto la pantalla queda libre, sin
   * esperar al tope de la compuerta. La corrección de fondo la hace
   * `waitForNoPresentedModal` dentro del checkout; esto es solo latencia.
   */
  onDismissed?: () => void;
}

export function CheckInReminderModal({
  visible,
  onAcknowledge,
  onDismissed,
}: CheckInReminderModalProps) {
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [checkOutTime, setCheckOutTime] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);

  const trackedDismiss = useTrackedModal(visible);

  // En ref para que el efecto de abajo dependa solo de `visible`: si dependiera
  // del callback (que el padre recrea en cada render) su cleanup cancelaría el
  // aviso antes de dispararlo.
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  // Android no tiene `onDismiss` en Modal: lo aproximamos esperando a que
  // terminen las animaciones en curso.
  const wasVisible = useRef(visible);
  useEffect(() => {
    const wasOpen = wasVisible.current;
    wasVisible.current = visible;
    if (Platform.OS === "ios" || !wasOpen || visible) return;
    const task = InteractionManager.runAfterInteractions(() => {
      onDismissedRef.current?.();
    });
    return () => task.cancel();
  }, [visible]);

  // Si se reabre el recordatorio, el selector no debe seguir abierto de antes.
  useEffect(() => {
    if (visible) setPickerFor(null);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        // Con el selector abierto, "atrás" solo cierra el selector: cerrar todo
        // dispararía el cobro sin que el cliente lo pidiera.
        if (pickerFor !== null) setPickerFor(null);
        else onAcknowledge({ checkInTime, checkOutTime });
      }}
      onDismiss={() => {
        trackedDismiss?.();
        onDismissedRef.current?.();
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {pickerFor !== null ? (
            <TimeSlotGrid
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
                else setCheckOutTime(v);
                setPickerFor(null);
              }}
              onClose={() => setPickerFor(null)}
            />
          ) : (
            <ScrollView
              style={styles.reminderScroll}
              contentContainerStyle={styles.reminderContent}
              bounces={false}
            >
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
                testID="reminder-continue"
              >
                <Text style={styles.buttonText}>Continuar</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
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
    maxHeight: "85%",
  },
  reminderScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  reminderContent: {
    paddingBottom: 4,
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
    fontFamily: "PlusJakartaSans_400Regular",
    lineHeight: 23,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 18,
  },
  bold: {
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  timesTitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  timeBtnValue: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  timeBtnValueSet: {
    color: COLORS.primary,
  },
  timesHint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
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
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
