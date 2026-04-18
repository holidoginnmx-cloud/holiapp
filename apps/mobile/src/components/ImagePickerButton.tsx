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
import * as ImagePicker from "expo-image-picker";
import { uploadToCloudinary } from "@/lib/cloudinary";

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
};

export function ImagePickerButton({
  imageUrl,
  onImageUploaded,
  folder,
  size = 120,
  icon = "camera-outline",
  label = "Agregar foto",
}: Props) {
  const [uploading, setUploading] = useState(false);

  const pickImage = async (source: "camera" | "gallery") => {
    try {
      const permissionFn =
        source === "camera"
          ? ImagePicker.requestCameraPermissionsAsync
          : ImagePicker.requestMediaLibraryPermissionsAsync;

      const { status } = await permissionFn();
      if (status !== "granted") {
        Alert.alert(
          "Permiso requerido",
          `Necesitamos acceso a ${source === "camera" ? "la cámara" : "tus fotos"} para continuar. Ve a Ajustes para habilitarlo.`
        );
        return;
      }

      const launchFn =
        source === "camera"
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;

      const result = await launchFn({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1] as [number, number],
        quality: 0.8,
      });

      if (result.canceled) return;

      const uri = result.assets[0].uri;
      setUploading(true);

      const data = await uploadToCloudinary(uri, folder);
      onImageUploaded(data.secure_url);
    } catch (error: any) {
      Alert.alert("Error", error.message || "No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  const handlePress = () => {
    Alert.alert("Seleccionar foto", "¿De dónde quieres la foto?", [
      { text: "Cámara", onPress: () => pickImage("camera") },
      { text: "Galería", onPress: () => pickImage("gallery") },
      { text: "Cancelar", style: "cancel" },
    ]);
  };

  return (
    <TouchableOpacity
      style={[styles.container, { width: size, height: size }]}
      onPress={handlePress}
      disabled={uploading}
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
