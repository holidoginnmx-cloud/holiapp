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

/** Tope de fotos por tanda al elegir varias de la galería. */
const MAX_PHOTOS_PER_PICK = 10;

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
  const urls = await pickAndUpload(options, false);
  return urls[0] ?? null;
}

/**
 * Igual que `pickAndUploadPhoto`, pero desde la galería deja marcar VARIAS
 * fotos de un jalón (páginas de una cartilla). Nunca recorta: el recorte del
 * sistema es de una sola foto. La cámara sigue dando una por toma.
 *
 * Devuelve las `secure_url` en el orden en que se eligieron; `[]` si se
 * cancela. Si unas suben y otras no, devuelve las que sí y avisa cuántas
 * faltaron; solo lanza si no subió ninguna.
 */
export async function pickAndUploadPhotos(
  options: Omit<PickAndUploadOptions, "allowsEditing" | "onRemove"> = {}
): Promise<string[]> {
  return pickAndUpload({ ...options, allowsEditing: false }, true);
}

async function pickAndUpload(
  options: PickAndUploadOptions,
  multiple: boolean
): Promise<string[]> {
  const { folder, allowsEditing = true, onUploadStart, onRemove } = options;

  const source = await new Promise<"camera" | "gallery" | "remove" | null>(
    (resolve) => {
      Alert.alert(
        onRemove
          ? "Foto de perfil"
          : multiple
            ? "Seleccionar fotos"
            : "Seleccionar foto",
        onRemove
          ? undefined
          : multiple
            ? "Desde la galería puedes elegir varias a la vez."
            : "¿De dónde quieres la foto?",
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
    return [];
  }
  if (!source) return [];

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
    return [];
  }

  const launchFn =
    source === "camera"
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

  const multiSelect = multiple && source === "gallery";
  const result = await launchFn({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing,
    ...(allowsEditing ? { aspect: [1, 1] as [number, number] } : {}),
    ...(multiSelect
      ? {
          allowsMultipleSelection: true,
          selectionLimit: MAX_PHOTOS_PER_PICK,
          orderedSelection: true,
        }
      : {}),
    quality: 0.8,
  });
  if (result.canceled) return [];

  onUploadStart?.();
  if (!multiSelect) {
    const data = await uploadToCloudinary(result.assets[0].uri, folder);
    return [data.secure_url];
  }

  const settled = await Promise.allSettled(
    result.assets.map((asset) => uploadToCloudinary(asset.uri, folder))
  );
  const urls: string[] = [];
  let firstError: unknown = null;
  for (const r of settled) {
    if (r.status === "fulfilled") urls.push(r.value.secure_url);
    else firstError ??= r.reason;
  }
  if (urls.length === 0) throw firstError;
  const failed = settled.length - urls.length;
  if (failed > 0) {
    Alert.alert(
      failed === 1 ? "Faltó una foto" : `Faltaron ${failed} fotos`,
      `Se subieron ${urls.length} de ${settled.length}. Vuelve a agregar las que faltan.`
    );
  }
  return urls;
}
