import { Modal, View, StyleSheet, StatusBar, Dimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import ImageView from "react-native-image-viewing";
import { cloudinaryResized } from "@/lib/cloudinary";
import { VIEWER_BACKDROP, ViewerHeader } from "./viewerChrome";

// ── Visor de evidencias (fotos y videos) ─────────────────────────────────────
// Comparte el chrome con PetPhotoViewer (`viewerChrome`): abrir una evidencia
// se ve igual que abrir la foto de perfil de la mascota — fondo azul de marca,
// título con las tipografías de la app y el mismo botón de cerrar.
//
// Recibe la lista completa del grupo y el índice tocado, así que desde una
// evidencia se puede deslizar a las demás del mismo bloque.

export type MediaViewerItem = {
  url: string;
  type: "image" | "video";
  /** Segunda línea mientras se ve este elemento (fecha, quién lo subió…). */
  caption?: string | null;
};

type Props = {
  /** Elementos abiertos. `null` o vacío = visor cerrado. */
  items: MediaViewerItem[] | null;
  /** Índice del elemento tocado dentro de `items`. */
  index?: number;
  /** Título del encabezado (normalmente el nombre de la mascota). */
  title?: string;
  /** Segunda línea por defecto, si el elemento no trae `caption`. */
  subtitle?: string | null;
  onClose: () => void;
};

export function MediaViewer({
  items,
  index = 0,
  title = "Evidencia",
  subtitle,
  onClose,
}: Props) {
  const list = items ?? [];
  const opened = list[index] ?? null;

  // Sólo las fotos entran al carrusel: ImageView no sabe reproducir video. Si
  // lo que se tocó es un video se abre solo, sin deslizar (son minoría y el
  // reproductor necesita su propio modal).
  const images = list.filter((m) => m.type === "image");
  const isVideo = opened?.type === "video";
  const startAt = opened ? Math.max(0, images.indexOf(opened)) : 0;

  // El hook va siempre (no puede quedar detrás de un return): sin video, null.
  const player = useVideoPlayer(isVideo ? opened!.url : null, (p) => {
    p.loop = false;
    if (isVideo) p.play();
  });

  if (!opened) return null;

  // ImageView lleva la cuenta de en cuál vas y se la pasa al encabezado: el
  // subtítulo y el contador siguen al deslizar sin estado nuestro de por medio.
  const header = ({ imageIndex }: { imageIndex: number }) => {
    const shown = isVideo ? opened : (images[imageIndex] ?? opened);
    const counter =
      !isVideo && images.length > 1
        ? `${imageIndex + 1} de ${images.length}`
        : null;
    return (
      <ViewerHeader
        title={title}
        subtitle={[shown.caption ?? subtitle, counter]
          .filter(Boolean)
          .join(" · ")}
        onClose={onClose}
        testID="media-viewer-close"
      />
    );
  };

  // Imágenes: ImageView ya trae pinch-zoom, double-tap y swipe-to-close.
  if (!isVideo) {
    return (
      <ImageView
        images={images.map((m) => ({ uri: cloudinaryResized(m.url, 1600) }))}
        imageIndex={startAt}
        visible
        onRequestClose={onClose}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
        animationType="fade"
        backgroundColor={VIEWER_BACKDROP}
        HeaderComponent={header}
      />
    );
  }

  // Video: modal propio con expo-video, mismo fondo y mismo encabezado.
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        <View style={styles.headerSlot}>{header({ imageIndex: 0 })}</View>
        <VideoView
          style={styles.media}
          player={player}
          contentFit="contain"
          allowsFullscreen
          allowsPictureInPicture={false}
        />
      </View>
    </Modal>
  );
}

const { width, height } = Dimensions.get("window");

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: VIEWER_BACKDROP,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSlot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  media: {
    width,
    height: height * 0.85,
  },
});
