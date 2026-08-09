import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getPetsByOwner, type PetForBooking } from "@/lib/api";

type UsePetSelectionOptions = {
  /** Dueño cuyas mascotas se listan. La query no corre hasta tener userId. */
  userId: string | null | undefined;
  /** Preselección inicial (p. ej. `petId` que llega por params). */
  initialPetIds?: string[];
  /** Máximo de mascotas seleccionables. Sin límite si se omite. */
  maxPets?: number;
  /** Alert mostrado al intentar pasar el límite. */
  limitAlert?: { title: string; message: string };
};

/**
 * Selección de mascota(s) del cliente para los wizards de creación
 * (guardería, baño, hospedaje): fetch de las mascotas del dueño + estado de
 * selección múltiple con límite opcional.
 *
 * Reglas de negocio extra al seleccionar (p. ej. exigir cartilla aprobada en
 * hospedaje) quedan del lado del wizard: puede filtrar `pets` o envolver
 * `togglePet` con su propia validación.
 */
export function usePetSelection({
  userId,
  initialPetIds = [],
  maxPets,
  limitAlert,
}: UsePetSelectionOptions) {
  const [selectedPetIds, setSelectedPetIds] = useState<string[]>(initialPetIds);

  const {
    data,
    isLoading: petsLoading,
    isError: petsError,
    error: petsErrorObj,
    refetch: refetchPets,
  } = useQuery({
    queryKey: ["pets", userId],
    queryFn: () => getPetsByOwner(userId!),
    enabled: !!userId,
  });

  const pets: PetForBooking[] = useMemo(() => data ?? [], [data]);

  const selectedPets = useMemo(
    () => pets.filter((p) => selectedPetIds.includes(p.id)),
    [pets, selectedPetIds],
  );

  const togglePet = (petId: string) => {
    setSelectedPetIds((prev) => {
      if (prev.includes(petId)) return prev.filter((id) => id !== petId);
      if (maxPets != null && prev.length >= maxPets) {
        if (limitAlert) Alert.alert(limitAlert.title, limitAlert.message);
        return prev;
      }
      return [...prev, petId];
    });
  };

  return {
    pets,
    petsLoading,
    petsError,
    petsErrorObj,
    refetchPets,
    selectedPetIds,
    setSelectedPetIds,
    selectedPets,
    togglePet,
  };
}
