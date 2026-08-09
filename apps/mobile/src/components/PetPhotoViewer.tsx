import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ImageView from "react-native-image-viewing";
import { COLORS } from "@/constants/colors";
import { formatName } from "@/lib/format";

// ── Visor de la foto de la mascota ───────────────────────────────────────────
// Se apoya en ImageView (pinch-zoom, doble tap y swipe para cerrar ya vienen
// hechos) pero le pone chrome nuestro con `HeaderComponent`/`FooterComponent`:
// fondo en el azul de marca en vez del negro plano, nombre y raza con las
// tipografías de la app y el botón de cambiar foto en naranja.
//
// Distinto de MediaViewer, que es el visor de evidencias (fotos Y videos) y se
// deja tal cual: aquí no hay video y sí hay identidad de la mascota que mostrar.

/** Azul tinta de la marca (el mismo del héroe del login), casi opaco. */
const BACKDROP = "rgba(6,47,61,0.97)";

export function PetPhotoViewer({
  visible,
  photoUrl,
  petName,
  breed,
  onClose,
  onChangePhoto,
}: {
  visible: boolean;
  /** Sin foto no hay nada que previsualizar: el visor no se monta. */
  photoUrl: string | null | undefined;
  petName: string;
  breed?: string | null;
  onClose: () => void;
  /** Si se pasa, muestra el botón "Cambiar foto" abajo. */
  onChangePhoto?: () => void;
}) {
  const insets = useSafeAreaInsets();

  if (!visible || !photoUrl) return null;

  return (
    <ImageView
      images={[{ uri: photoUrl }]}
      imageIndex={0}
      visible
      onRequestClose={onClose}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
      animationType="fade"
      backgroundColor={BACKDROP}
      HeaderComponent={() => (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>
              {formatName(petName)}
            </Text>
            {!!breed && (
              <Text style={styles.breed} numberOfLines={1}>
                {breed}
              </Text>
            )}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cerrar foto"
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            testID="pet-photo-viewer-close"
          >
            <Ionicons name="close" size={22} color={COLORS.white} />
          </Pressable>
        </View>
      )}
      FooterComponent={
        onChangePhoto
          ? () => (
              <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
                <Pressable
                  onPress={onChangePhoto}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.changeButton, pressed && styles.pressed]}
                  testID="pet-photo-viewer-change"
                >
                  <Ionicons name="camera" size={17} color={COLORS.white} />
                  <Text style={styles.changeText}>Cambiar foto</Text>
                </Pressable>
              </View>
            )
          : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
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
  name: {
    fontSize: 20,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.white,
    letterSpacing: -0.4,
  },
  breed: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
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
  changeButton: {
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
  changeText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  pressed: { opacity: 0.85 },
});
