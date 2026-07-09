import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

// Confirmación de éxito NO bloqueante: aparece arriba, no intercepta taps y
// desaparece sola. Reemplaza a los Alert.alert de éxito (los de error y las
// confirmaciones destructivas siguen usando Alert).
export function SuccessBanner({ message }: { message: string }) {
  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      exiting={FadeOutUp.duration(200)}
      style={styles.wrap}
      pointerEvents="none"
    >
      <View style={styles.card}>
        <Ionicons name="checkmark-circle" size={22} color={COLORS.successText} />
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * Hook por pantalla: `const { banner, showSuccess } = useSuccessBanner();`
 * Renderiza `{banner}` al final del JSX (hermano del ScrollView/FlatList) y
 * llama `showSuccess("Pago registrado")` en el onSuccess de la mutación.
 */
export function useSuccessBanner(durationMs = 2200) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = useCallback(
    (msg: string) => {
      setMessage(msg);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const banner = message ? <SuccessBanner message={message} /> : null;
  return { banner, showSuccess };
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 8,
    left: 16,
    right: 16,
    zIndex: 100,
    alignItems: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.successBg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
    maxWidth: 420,
  },
  text: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
});
