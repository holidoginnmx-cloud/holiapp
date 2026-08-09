import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ImageView from "react-native-image-viewing";
import { COLORS } from "@/constants/colors";
import { formatName } from "@/lib/format";
import { VIEWER_BACKDROP, ViewerHeader, viewerStyles } from "./viewerChrome";

// ── Visor de la foto de la mascota ───────────────────────────────────────────
// Se apoya en ImageView (pinch-zoom, doble tap y swipe para cerrar ya vienen
// hechos) pero le pone chrome nuestro: fondo en el azul de marca en vez del
// negro plano, nombre y raza con las tipografías de la app y el botón de
// cambiar foto en naranja.
//
// El chrome vive en `viewerChrome` y lo comparte con MediaViewer (evidencias),
// para que abrir una evidencia se vea igual que abrir esta foto.

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
      backgroundColor={VIEWER_BACKDROP}
      HeaderComponent={() => (
        <ViewerHeader
          title={formatName(petName)}
          subtitle={breed}
          onClose={onClose}
          testID="pet-photo-viewer-close"
        />
      )}
      FooterComponent={
        onChangePhoto
          ? () => (
              <View
                style={[
                  viewerStyles.footer,
                  { paddingBottom: insets.bottom + 18 },
                ]}
              >
                <Pressable
                  onPress={onChangePhoto}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    viewerStyles.actionButton,
                    pressed && viewerStyles.pressed,
                  ]}
                  testID="pet-photo-viewer-change"
                >
                  <Ionicons name="camera" size={17} color={COLORS.white} />
                  <Text style={viewerStyles.actionText}>Cambiar foto</Text>
                </Pressable>
              </View>
            )
          : undefined
      }
    />
  );
}
