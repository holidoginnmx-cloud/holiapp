import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { uploadToCloudinary } from "./cloudinary";

type PickAndUploadOptions = {
  /** Subcarpeta de Cloudinary (e.g. "pets", "stays") */
  folder?: string;
  /** Recorte cuadrado antes de subir. Default true; usar false para documentos. */
  allowsEditing?: boolean;
  /** Se invoca justo antes de iniciar la subida (para mostrar spinners). */
  onUploadStart?: () => void;
  /**
   * Si se pasa, el menú incluye "Eliminar foto" (destructivo) y al elegirlo
   * se invoca este callback en lugar de abrir el picker.
   */
  onRemove?: () => void;
};

/**
 * Flujo completo para cambiar/subir una foto: pregunta la fuente (cámara o
 * galería), pide permisos, abre el picker y sube el resultado a Cloudinary.
 *
 * Devuelve la `secure_url` resultante, o `null` si el usuario cancela en
 * cualquier paso (incluido permiso denegado, que además muestra un Alert) o
 * elige "Eliminar foto" (que solo dispara `onRemove`).
 * Lanza si la subida a Cloudinary falla.
 */
export async function pickAndUploadPhoto(
  options: PickAndUploadOptions = {}
): Promise<string | null> {
  const { folder, allowsEditing = true, onUploadStart, onRemove } = options;

  const source = await new Promise<"camera" | "gallery" | "remove" | null>(
    (resolve) => {
      Alert.alert(
        onRemove ? "Foto de perfil" : "Seleccionar foto",
        onRemove ? undefined : "¿De dónde quieres la foto?",
        [
          { text: "Cámara", onPress: () => resolve("camera") },
          { text: "Galería", onPress: () => resolve("gallery") },
          ...(onRemove
            ? [
                {
                  text: "Eliminar foto",
                  style: "destructive" as const,
                  onPress: () => resolve("remove"),
                },
              ]
            : []),
          { text: "Cancelar", style: "cancel", onPress: () => resolve(null) },
        ],
        { cancelable: true, onDismiss: () => resolve(null) }
      );
    }
  );
  if (source === "remove") {
    onRemove?.();
    return null;
  }
  if (!source) return null;

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
    return null;
  }

  const launchFn =
    source === "camera"
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

  const result = await launchFn({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing,
    ...(allowsEditing ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 0.8,
  });
  if (result.canceled) return null;

  onUploadStart?.();
  const data = await uploadToCloudinary(result.assets[0].uri, folder);
  return data.secure_url;
}
