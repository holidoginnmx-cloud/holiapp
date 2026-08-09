import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";

// ── Chrome compartido de los visores a pantalla completa ─────────────────────
// Lo usan PetPhotoViewer (foto de la mascota) y MediaViewer (evidencias): así
// abrir una evidencia se siente idéntico a abrir la foto de perfil — mismo
// fondo, misma tipografía y el mismo botón de cerrar en la misma posición.
//
// Vive aparte para que ninguno de los dos visores dependa del otro.

/** Azul tinta de la marca (el mismo del héroe del login), casi opaco. */
export const VIEWER_BACKDROP = "rgba(6,47,61,0.97)";

export function ViewerHeader({
  title,
  subtitle,
  onClose,
  testID,
}: {
  title: string;
  /** Segunda línea: raza, fecha, quién la subió, "2 de 5"… */
  subtitle?: string | null;
  onClose: () => void;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[viewerStyles.header, { paddingTop: insets.top + 8 }]}>
      <View style={viewerStyles.headerText}>
        <Text style={viewerStyles.title} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={viewerStyles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Cerrar"
        style={({ pressed }) => [
          viewerStyles.closeButton,
          pressed && viewerStyles.pressed,
        ]}
        testID={testID}
      >
        <Ionicons name="close" size={22} color={COLORS.white} />
      </Pressable>
    </View>
  );
}

export const viewerStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  // La sombra es para cuando el encabezado cae encima de la propia foto o del
  // video (evidencias en vertical llenan la pantalla): sin ella el texto blanco
  // desaparece sobre un fondo claro.
  title: {
    fontSize: 20,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.white,
    letterSpacing: -0.4,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 999,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  actionText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  pressed: { opacity: 0.85 },
});
