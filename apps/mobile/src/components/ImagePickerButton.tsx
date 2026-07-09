import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { pickAndUploadPhoto } from "@/lib/photoPicker";

type Props = {
  /** Current image URL (from Cloudinary or existing) */
  imageUrl: string | null;
  /** Called with the Cloudinary secure_url after upload */
  onImageUploaded: (url: string) => void;
  /** Cloudinary subfolder (e.g. "pets", "stays") */
  folder?: string;
  /** Size of the preview */
  size?: number;
  /** Placeholder icon */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Label text below the button */
  label?: string;
  /** Allow the user to crop/edit before upload. Default true (square crop). Set false for documents like cartillas. */
  allowsEditing?: boolean;
  /** Disable from outside (e.g. while a parent mutation is in-flight). */
  disabled?: boolean;
};

export function ImagePickerButton({
  imageUrl,
  onImageUploaded,
  folder,
  size = 120,
  icon = "camera-outline",
  label = "Agregar foto",
  allowsEditing = true,
  disabled = false,
}: Props) {
  const [uploading, setUploading] = useState(false);

  const handlePress = async () => {
    try {
      const url = await pickAndUploadPhoto({
        folder,
        allowsEditing,
        onUploadStart: () => setUploading(true),
      });
      if (url) onImageUploaded(url);
    } catch (error: any) {
      Alert.alert("Error", error.message || "No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.container, { width: size, height: size }]}
      onPress={handlePress}
      disabled={uploading || disabled}
      activeOpacity={0.7}
    >
      {uploading ? (
        <View style={[styles.placeholder, { width: size, height: size }]}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.uploadingText}>Subiendo...</Text>
        </View>
      ) : imageUrl ? (
        <View>
          <Image
            source={{ uri: imageUrl }}
            style={[styles.image, { width: size, height: size }]}
          />
          <View style={styles.editBadge}>
            <Ionicons name="pencil" size={12} color={COLORS.white} />
          </View>
        </View>
      ) : (
        <View style={[styles.placeholder, { width: size, height: size }]}>
          <Ionicons name={icon} size={32} color={COLORS.textDisabled} />
          <Text style={styles.label}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "center",
  },
  image: {
    borderRadius: 14,
  },
  placeholder: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.borderLight,
    borderStyle: "dashed",
    backgroundColor: COLORS.bgPage,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  editBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    color: COLORS.textDisabled,
    fontWeight: "600",
  },
  uploadingText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "600",
  },
});
