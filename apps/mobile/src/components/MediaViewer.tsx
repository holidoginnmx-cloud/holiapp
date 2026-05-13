import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import ImageView from "react-native-image-viewing";
import { COLORS } from "@/constants/colors";

export type MediaViewerItem = {
  url: string;
  type: "image" | "video";
};

type Props = {
  item: MediaViewerItem | null;
  onClose: () => void;
};

export function MediaViewer({ item, onClose }: Props) {
  const isVideo = item?.type === "video";
  const isImage = item?.type === "image";
  // Hook must be called unconditionally; pass empty source when no video.
  const player = useVideoPlayer(isVideo ? item!.url : null, (p) => {
    p.loop = false;
    if (isVideo) p.play();
  });

  // Imágenes: ImageView ya trae pinch-zoom, double-tap y swipe-to-close.
  if (isImage && item) {
    return (
      <ImageView
        images={[{ uri: item.url }]}
        imageIndex={0}
        visible
        onRequestClose={onClose}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
        backgroundColor="rgba(0,0,0,0.95)"
      />
    );
  }

  // Video: modal propio con expo-video.
  return (
    <Modal
      visible={isVideo}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={12}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={28} color={COLORS.white} />
        </TouchableOpacity>

        {isVideo && (
          <VideoView
            style={styles.media}
            player={player}
            contentFit="contain"
            allowsFullscreen
            allowsPictureInPicture={false}
          />
        )}
      </View>
    </Modal>
  );
}

const { width, height } = Dimensions.get("window");

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  media: {
    width,
    height: height * 0.85,
  },
  closeButton: {
    position: "absolute",
    top: 56,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
