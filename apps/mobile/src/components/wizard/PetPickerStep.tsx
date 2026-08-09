import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { ErrorState } from "@/components/ErrorState";
import { formatName } from "@/lib/format";
import { wizardStyles as styles } from "@/styles/wizardStyles";

/** Lo mínimo que el picker necesita saber de una mascota para pintarla. */
type PickerPet = {
  id: string;
  name: string;
  weight?: number | string | null;
  breed?: string | null;
};

type PetPickerStepProps<T extends PickerPet> = {
  /** Mascotas seleccionables (ya filtradas por el wizard si aplica). */
  pets: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedPetIds: string[];
  onToggle: (petId: string) => void;
  /** Mensaje cuando el cliente no tiene mascotas registradas. */
  emptyText: string;
  /** Prefijo del testID de cada tarjeta: `${testIDPrefix}-${pet.id}`. */
  testIDPrefix: string;
};

/**
 * Paso "¿Para quién?" de los wizards de creación: lista de mascotas del
 * cliente con selección por checkbox (sirve para single-select pasando un
 * arreglo de 0/1 elementos en `selectedPetIds`).
 *
 * El título de sección lo pone el wizard (el número de paso varía).
 */
export function PetPickerStep<T extends PickerPet>({
  pets,
  isLoading,
  isError,
  error,
  onRetry,
  selectedPetIds,
  onToggle,
  emptyText,
  testIDPrefix,
}: PetPickerStepProps<T>) {
  if (isError) {
    return <ErrorState error={error} onRetry={onRetry} compact />;
  }
  if (isLoading) {
    return <ActivityIndicator color={COLORS.primary} />;
  }
  if (pets.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="paw-outline" size={28} color={COLORS.primary} />
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }
  return (
    <View style={styles.petList}>
      {pets.map((p) => {
        const selected = selectedPetIds.includes(p.id);
        return (
          <TouchableOpacity
            key={p.id}
            style={[styles.petCard, selected && styles.petCardSelected]}
            onPress={() => onToggle(p.id)}
            testID={`${testIDPrefix}-${p.id}`}
          >
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={22}
              color={selected ? COLORS.primary : COLORS.textTertiary}
            />
            <View style={styles.petAvatar}>
              <Ionicons name="paw" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.petName}>{formatName(p.name)}</Text>
              <Text style={styles.petMeta}>
                {p.weight ? `${p.weight} kg · ` : ""}
                {p.breed || "Sin raza"}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
