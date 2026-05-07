const CLOUD_NAME = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

export type CloudinaryResult = {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  width: number;
  height: number;
};

/**
 * Upload an image or video to Cloudinary using unsigned upload.
 * @param uri - Local file URI from expo-image-picker
 * @param folder - Optional subfolder inside the preset's asset folder
 * @param mediaType - "image" (default) or "video"
 */
export async function uploadToCloudinary(
  uri: string,
  folder?: string,
  mediaType: "image" | "video" = "image",
): Promise<CloudinaryResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      "Cloudinary no configurado. Agrega EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME y EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET al .env"
    );
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${mediaType}/upload`;
  const isVideo = mediaType === "video";

  const formData = new FormData();
  formData.append("file", {
    uri,
    type: isVideo ? "video/mp4" : "image/jpeg",
    name: isVideo ? "upload.mp4" : "upload.jpg",
  } as any);

  formData.append("upload_preset", UPLOAD_PRESET);

  if (folder) {
    formData.append("folder", folder);
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Error subiendo ${isVideo ? "video" : "imagen"}: ${error}`,
    );
  }

  return response.json();
}

/**
 * Given a Cloudinary video URL (.mp4/.mov/.webm…), returns the URL of an
 * auto-generated JPG thumbnail of the first frame. Cloudinary serves it on
 * the same path simply by changing the extension to `.jpg`.
 *
 * Returns the input unchanged if the URL doesn't look like Cloudinary or has
 * no recognized video extension.
 */
export function videoThumbnailUrl(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/video/upload/")) {
    return url;
  }
  return url.replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, ".jpg");
}
