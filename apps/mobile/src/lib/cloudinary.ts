const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

export type CloudinaryResult = {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  width: number;
  height: number;
};

/**
 * Upload an image to Cloudinary using unsigned upload.
 * @param uri - Local file URI from expo-image-picker
 * @param folder - Optional subfolder inside the preset's asset folder (e.g. "pets", "stays")
 */
export async function uploadToCloudinary(
  uri: string,
  folder?: string
): Promise<CloudinaryResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      "Cloudinary no configurado. Agrega EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME y EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET al .env"
    );
  }

  const formData = new FormData();

  formData.append("file", {
    uri,
    type: "image/jpeg",
    name: "upload.jpg",
  } as any);

  formData.append("upload_preset", UPLOAD_PRESET);

  if (folder) {
    formData.append("folder", folder);
  }

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Error subiendo imagen: ${error}`);
  }

  return response.json();
}
