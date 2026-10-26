import { memo, useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { cloudinaryResized } from "@/lib/cloudinary";

interface PetAvatarProps {
  photoUrl?: string | null;
  /** Diámetro en px. */
  size?: number;
}

/**
 * Circulito con la foto del perro para las tarjetas de lista. Sin foto (o si
 * la imagen no carga) cae a la patita sobre el fondo de marca, como antes.
 */
export const PetAvatar = memo(function PetAvatar({
  photoUrl,
  size = 40,
}: PetAvatarProps) {
  const [failed, setFailed] = useState(false);
  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (photoUrl && !failed) {
    return (
      <Image
        // 3x para que se vea nítida en pantallas retina.
        source={{ uri: cloudinaryResized(photoUrl, size * 3, "fill") }}
        style={[styles.base, circle]}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View style={[styles.base, styles.fallback, circle]}>
      <Ionicons name="paw" size={Math.round(size * 0.5)} color={COLORS.primary} />
    </View>
  );
});

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.primaryLight,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
});
