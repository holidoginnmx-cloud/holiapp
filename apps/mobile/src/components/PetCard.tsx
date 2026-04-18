import { COLORS } from "@/constants/colors";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import type { Pet } from "@holidoginn/shared";

const SIZE_LABELS: Record<string, string> = {
  XS: "Extra pequeño",
  S: "Pequeño",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

interface PetCardProps {
  pet: Pet;
  ownerName?: string;
  onPress?: () => void;
}

export function PetCard({ pet, ownerName, onPress }: PetCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <Image
        source={
          pet.photoUrl
            ? { uri: pet.photoUrl }
            : require("../../assets/pet-placeholder.png")
        }
        style={styles.photo}
        defaultSource={require("../../assets/pet-placeholder.png")}
      />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{pet.name}</Text>
          {ownerName && (
            <Text style={styles.ownerInline} numberOfLines={1}>
              {ownerName}
            </Text>
          )}
        </View>
        <Text style={styles.breed}>{pet.breed || "Sin raza especificada"}</Text>
        <View style={styles.tags}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{SIZE_LABELS[pet.size] || pet.size}</Text>
          </View>
          {pet.weight && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{pet.weight} kg</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.bgSection,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  ownerInline: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  breed: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  tags: {
    flexDirection: "row",
    marginTop: 6,
    gap: 6,
  },
  tag: {
    backgroundColor: COLORS.reviewBgAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "600",
  },
});
