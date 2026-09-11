import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

/**
 * Una liga (`holidoginn://…`) o un aviso que apunta a una pantalla que esta
 * versión de la app no conoce. Antes caía en la pantalla por defecto de
 * expo-router, en inglés y con un "Sitemap" de desarrollo. Pasa sobre todo
 * cuando la app todavía no aplica la actualización que trae la pantalla nueva
 * (el OTA se descarga en segundo plano y se aplica al reiniciar).
 */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <View style={styles.iconCircle}>
        <Ionicons name="refresh-outline" size={32} color={COLORS.primary} />
      </View>
      <Text style={styles.title}>Tu app necesita actualizarse</Text>
      <Text style={styles.body}>
        Esta pantalla todavía no está en tu versión. Cierra la app por completo, ábrela de nuevo y
        vuelve a intentarlo. Si sigue igual, actualízala desde la App Store.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace("/" as any)}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Ir al inicio</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: 16,
    fontSize: 22,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    marginTop: 24,
    alignSelf: "stretch",
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonText: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.white },
});
