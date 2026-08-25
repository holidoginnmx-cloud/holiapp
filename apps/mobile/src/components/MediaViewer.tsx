import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Image,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  StatusBar,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { cloudinaryResized } from "@/lib/cloudinary";
import { VIEWER_BACKDROP, ViewerHeader } from "./viewerChrome";

// ── Visor de evidencias (fotos y videos) ─────────────────────────────────────
// Comparte el chrome con PetPhotoViewer (`viewerChrome`): abrir una evidencia
// se ve igual que abrir la foto de perfil de la mascota — fondo azul de marca,
// título con las tipografías de la app y el mismo botón de cerrar.
//
// Recibe la lista completa y el índice tocado: es UN solo carrusel donde
// conviven fotos y videos, así que desde una evidencia se puede deslizar a
// todas las demás (incluso a las de otros días) sin cerrar el visor. Antes las
// fotos iban en ImageView y los videos en un modal aparte, y deslizar se
// cortaba en cuanto había un video de por medio.

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
  const { width, height } = useWindowDimensions();
  const [current, setCurrent] = useState(index);

  // El contador se reposiciona SOLO al abrir (cerrado → abierto). No sirve
  // depender de `items`: hay pantallas que arman el arreglo inline en cada
  // render y un refetch de fondo regresaría al usuario a la evidencia inicial
  // a media deslizada.
  const wasOpen = useRef(false);
  useEffect(() => {
    const isOpen = list.length > 0;
    if (isOpen && !wasOpen.current) setCurrent(index);
    wasOpen.current = isOpen;
  });

  if (list.length === 0) return null;

  const shown = list[Math.min(current, list.length - 1)];
  const counter = list.length > 1 ? `${current + 1} de ${list.length}` : null;

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrent(Math.max(0, Math.min(page, list.length - 1)));
  };

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
        <FlatList
          data={list}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(index, list.length - 1)}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          keyExtractor={(m, i) => `${m.url}-${i}`}
          onMomentumScrollEnd={onMomentumEnd}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height }}>
              {item.type === "video" ? (
                <VideoPage url={item.url} isActive={i === current} />
              ) : (
                <ImagePage
                  url={cloudinaryResized(item.url, 1600)}
                  width={width}
                  height={height}
                  isActive={i === current}
                />
              )}
            </View>
          )}
        />
        <View style={styles.headerSlot}>
          <ViewerHeader
            title={title}
            subtitle={[shown.caption ?? subtitle, counter]
              .filter(Boolean)
              .join(" · ")}
            onClose={onClose}
            testID="media-viewer-close"
          />
        </View>
      </View>
    </Modal>
  );
}

// ── Página de foto ───────────────────────────────────────────────────────────
// Pinch-zoom con el zoom nativo del ScrollView (iOS) y double-tap manual.
// Mientras el zoom está en 1 el contenido mide igual que el marco, así que el
// gesto horizontal cae en el FlatList de afuera y se desliza a la siguiente
// evidencia; ya con zoom, el ScrollView se queda el paneo.

function ImagePage({
  url,
  width,
  height,
  isActive,
}: {
  url: string;
  width: number;
  height: number;
  isActive: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const lastTap = useRef(0);
  const zoomed = useRef(false);

  const zoomTo = (rect: { x: number; y: number; width: number; height: number }) => {
    const responder = scrollRef.current?.getScrollResponder() as
      | { scrollResponderZoomTo?: (rect: object) => void }
      | undefined;
    responder?.scrollResponderZoomTo?.({ ...rect, animated: true });
  };

  // Al salir de la página, la foto vuelve a tamaño normal: regresar a ella no
  // debe encontrarla a medio zoom.
  useEffect(() => {
    if (!isActive && zoomed.current) {
      zoomTo({ x: 0, y: 0, width, height });
      zoomed.current = false;
    }
  }, [isActive, width, height]);

  const onTap = (e: GestureResponderEvent) => {
    const now = Date.now();
    const isDouble = now - lastTap.current < 300;
    lastTap.current = now;
    if (!isDouble) return;
    if (zoomed.current) {
      zoomTo({ x: 0, y: 0, width, height });
      zoomed.current = false;
    } else {
      const { locationX, locationY } = e.nativeEvent;
      zoomTo({
        x: locationX - width / 4,
        y: locationY - height / 4,
        width: width / 2,
        height: height / 2,
      });
      zoomed.current = true;
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      minimumZoomScale={1}
      maximumZoomScale={4}
      bounces={false}
      bouncesZoom={false}
      alwaysBounceHorizontal={false}
      alwaysBounceVertical={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={64}
      onScroll={(e) => {
        zoomed.current = e.nativeEvent.zoomScale > 1.02;
      }}
    >
      <Pressable style={{ width, height }} onPress={onTap}>
        <Image
          source={{ uri: url }}
          style={{ width, height }}
          resizeMode="contain"
        />
      </Pressable>
    </ScrollView>
  );
}

// ── Página de video ──────────────────────────────────────────────────────────
// Cada página trae su propio reproductor: se reproduce al quedar en pantalla y
// se pausa al deslizar a otra evidencia (para que no siga sonando de fondo).

function VideoPage({ url, isActive }: { url: string; isActive: boolean }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);

  return (
    <VideoView
      style={styles.video}
      player={player}
      contentFit="contain"
      allowsFullscreen
      allowsPictureInPicture={false}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: VIEWER_BACKDROP,
  },
  headerSlot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  video: {
    width: "100%",
    height: "100%",
  },
});
