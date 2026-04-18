import { COLORS } from "@/constants/colors";
import { View, Text, Image, StyleSheet } from "react-native";

interface StayUpdateCardProps {
  mediaUrl: string;
  caption: string | null;
  createdAt: string | Date;
  horizontal?: boolean;
}

function timeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

export function StayUpdateCard({
  mediaUrl,
  caption,
  createdAt,
  horizontal,
}: StayUpdateCardProps) {
  return (
    <View style={[styles.card, horizontal && styles.cardHorizontal]}>
      <Image
        source={{ uri: mediaUrl }}
        style={[styles.image, horizontal && styles.imageHorizontal]}
        resizeMode="cover"
      />
      <View style={styles.content}>
        {caption && (
          <Text style={styles.caption} numberOfLines={2}>
            {caption}
          </Text>
        )}
        <Text style={styles.time}>{timeAgo(createdAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHorizontal: {
    width: 220,
    marginRight: 12,
    marginBottom: 0,
  },
  image: {
    width: "100%",
    height: 180,
    backgroundColor: COLORS.bgSection,
  },
  imageHorizontal: {
    height: 140,
  },
  content: {
    padding: 10,
  },
  caption: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  time: {
    fontSize: 12,
    color: COLORS.textDisabled,
    marginTop: 4,
  },
});
