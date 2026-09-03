import { useCallback, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import {
  applyUpdateNow,
  isUpdateNoticeVisible,
  snoozeUpdateNotice,
  subscribeToUpdates,
} from "@/lib/appUpdates";

/**
 * Aviso de versión nueva.
 *
 * Deliberadamente NO es un Alert ni un modal: aparece como una barra flotante
 * abajo, sobre la barra de pestañas, y se puede ignorar. Quien esté a media
 * reservación, escribiendo un reporte o pagando, no tiene que atender nada.
 *
 * Lo que sí garantiza: que la recarga la decida la persona (nunca la app) y que
 * el aviso no se pierda si lo cierran — vuelve en un par de horas o en cuanto
 * se publique otra versión.
 *
 * Se monta una sola vez en app/_layout.tsx, así que cubre las tres áreas
 * (cliente, admin y staff) sin duplicarse.
 */
export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const [applying, setApplying] = useState(false);
  const visible = useSyncExternalStore(
    subscribeToUpdates,
    isUpdateNoticeVisible,
    // En un render de servidor (no ocurre en RN, pero el tipo lo pide) nunca
    // hay update descargado.
    () => false,
  );

  const handleApply = useCallback(() => {
    setApplying(true);
    void applyUpdateNow().then((ok) => {
      // Si salió bien, la app se recarga y este estado ya no existe.
      if (!ok) setApplying(false);
    });
  }, []);

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(260)}
      exiting={FadeOutDown.duration(180)}
      pointerEvents="box-none"
      // La barra de pestañas nativa mide ~49 pt: se le suma para que el aviso
      // quede encima y no tape la navegación.
      style={[styles.wrap, { bottom: insets.bottom + 60 }]}
      testID="update-banner"
    >
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="arrow-down-circle" size={18} color={COLORS.primary} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>Hay una versión nueva</Text>
          <Text style={styles.body}>Se aplica al reiniciar la app.</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={handleApply}
          disabled={applying}
          testID="update-banner-apply"
        >
          {applying ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.ctaText}>Actualizar ahora</Text>
          )}
        </Pressable>
        <Pressable
          style={styles.close}
          onPress={snoozeUpdateNotice}
          disabled={applying}
          hitSlop={10}
          accessibilityLabel="Ahora no"
          testID="update-banner-dismiss"
        >
          <Ionicons name="close" size={16} color={COLORS.textTertiary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9998,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryLight,
  },
  texts: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  cta: {
    backgroundColor: COLORS.primary,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 108,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_700Bold",
  },
  close: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
