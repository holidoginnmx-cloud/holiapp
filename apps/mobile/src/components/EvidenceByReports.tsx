import { COLORS } from "@/constants/colors";
import { View, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { StayUpdate } from "@holidoginn/shared";
import { videoThumbnailUrl, cloudinaryResized } from "@/lib/cloudinary";

export function EvidenceGrid({
  items,
  onPressItem,
  onDeleteItem,
}: {
  items: StayUpdate[];
  onPressItem: (update: StayUpdate, allInGroup: StayUpdate[]) => void;
  /** Si se pasa, cada miniatura muestra botón de eliminar (solo staff/admin). */
  onDeleteItem?: (update: StayUpdate) => void;
}) {
  return (
    <View style={styles.grid}>
      {items.map((u) => {
        const isVideo = u.mediaType === "video";
        const thumbUri = isVideo ? videoThumbnailUrl(u.mediaUrl) : u.mediaUrl;
        return (
          <TouchableOpacity
            key={u.id}
            style={styles.thumbWrap}
            activeOpacity={0.85}
            onPress={() => onPressItem(u, items)}
          >
            <Image
              source={{ uri: cloudinaryResized(thumbUri, 360, "fill") }}
              style={styles.thumb}
            />
            {isVideo && (
              <View style={styles.playOverlay}>
                <Ionicons name="play-circle" size={32} color={COLORS.white} />
              </View>
            )}
            {onDeleteItem && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => onDeleteItem(u)}
                hitSlop={6}
                testID={`evidence-delete-${u.id}`}
              >
                <Ionicons name="trash" size={13} color={COLORS.white} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thumbWrap: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    backgroundColor: COLORS.bgSection,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  deleteBtn: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(220, 38, 38, 0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
});
