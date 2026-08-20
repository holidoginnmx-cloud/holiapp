import { useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updatePet } from "@/lib/api";
import { pickAndUploadPhoto } from "@/lib/photoPicker";
import { formatName } from "@/lib/format";

/**
 * Cambiar (o quitar) la foto de perfil de una mascota.
 *
 * Vivía suelto en la ficha del perro, a la que el equipo de piso no llega: el
 * staff ve al perro en el detalle de la estancia y ahí no había forma de
 * subirle la foto. Sin foto, identificar quién es quién se hace leyendo la
 * placa del collar, así que la captura tiene que estar donde el perro está.
 */
export function usePetPhoto(opts: {
  petId: string | null | undefined;
  petName?: string | null;
  currentPhotoUrl?: string | null;
  /** Invalidaciones propias de la pantalla que lo usa (listas del staff, etc). */
  onSaved?: (photoUrl: string | null) => void;
}) {
  const { petId, petName, currentPhotoUrl, onSaved } = opts;
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const mutation = useMutation({
    mutationFn: (photoUrl: string | null) => updatePet(petId!, { photoUrl }),
    onSuccess: (_data, photoUrl) => {
      // La ficha del perro y las listas que la pintan, en segundo plano.
      qc.setQueryData<any>(["pet", petId], (old: any) =>
        old ? { ...old, photoUrl } : old,
      );
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["admin", "pets"] });
      onSaved?.(photoUrl);
    },
    onError: (err: Error) =>
      Alert.alert(
        "No se pudo actualizar la foto",
        err.message || "Inténtalo de nuevo.",
      ),
  });

  const confirmRemove = () => {
    Alert.alert(
      "Eliminar foto",
      `¿Quitar la foto de perfil de ${formatName(petName ?? "la mascota")}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => mutation.mutate(null),
        },
      ],
    );
  };

  const changePhoto = async () => {
    if (!petId) return;
    try {
      const url = await pickAndUploadPhoto({
        folder: "pets",
        onUploadStart: () => setUploading(true),
        // Solo ofrecemos eliminar si hay foto que quitar.
        onRemove: currentPhotoUrl ? confirmRemove : undefined,
      });
      if (url) mutation.mutate(url);
    } catch (err: any) {
      Alert.alert("Error", err.message || "No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  };

  return {
    changePhoto,
    /** True mientras se sube el archivo o se guarda la URL. */
    busy: uploading || mutation.isPending,
  };
}
