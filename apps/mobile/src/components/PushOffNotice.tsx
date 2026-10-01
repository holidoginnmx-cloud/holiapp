import { COLORS } from "@/constants/colors";
import { useSyncExternalStore } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getPushStatus, subscribeToPushStatus } from "@/lib/pushNotifications";

/**
 * "Las notificaciones están apagadas en este teléfono."
 *
 * El equipo se entera de las reservas y los pagos nuevos por push. Si el
 * permiso está apagado en Ajustes, nada llega y nada lo decía: la app seguía
 * como si todo estuviera bien y las reservas "aparecían solas" en el
 * calendario. Este aviso vive en el Panel del equipo, que es lo primero que
 * ven al abrir la app.
 *
 * Solo se muestra con el permiso NEGADO, que es lo único que la persona puede
 * arreglar. Los otros fallos (sin red, token sin guardar) se reintentan solos
 * al volver a la app (ver app/_layout.tsx).
 */
export function PushOffNotice() {
  const status = useSyncExternalStore(subscribeToPushStatus, getPushStatus);
  if (status !== "denied") return null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => {
        Linking.openSettings().catch(() => {});
      }}
      testID="push-off-notice"
    >
      <Ionicons name="notifications-off-outline" size={22} color={COLORS.warningText} />
      <View style={styles.textCol}>
        <Text style={styles.title}>Las notificaciones están apagadas</Text>
        <Text style={styles.body}>
          En este teléfono no te van a llegar los avisos de reservaciones
          nuevas. Toca aquí para prenderlas en Ajustes.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.warningText} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.warningBg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  textCol: { flex: 1 },
  title: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  body: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});
