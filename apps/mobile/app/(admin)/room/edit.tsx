import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useState, useEffect } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getRooms, createRoom, updateRoom } from "@/lib/api";

const SIZE_OPTIONS = [
  { key: "XS", label: "XS" },
  { key: "S", label: "S" },
  { key: "M", label: "M" },
  { key: "L", label: "L" },
  { key: "XL", label: "XL" },
];

export default function RoomEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pricePerDay, setPricePerDay] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [sizeAllowed, setSizeAllowed] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);

  // Load existing room data
  const { data: rooms } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => getRooms(),
    enabled: isEditing,
  });

  useEffect(() => {
    if (isEditing && rooms) {
      const room = rooms.find((r) => r.id === id);
      if (room) {
        setName(room.name);
        setDescription(room.description ?? "");
        setPricePerDay(String(Number(room.pricePerDay)));
        setCapacity(String(room.capacity));
        setSizeAllowed(room.sizeAllowed as string[]);
        setIsActive(room.isActive);
      }
    }
  }, [isEditing, rooms, id]);

  const toggleSize = (size: string) => {
    setSizeAllowed((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Ingresa el nombre del cuarto");
      return;
    }
    if (!pricePerDay || Number(pricePerDay) <= 0) {
      Alert.alert("Error", "Ingresa un precio valido");
      return;
    }
    if (sizeAllowed.length === 0) {
      Alert.alert("Error", "Selecciona al menos un tamano permitido");
      return;
    }

    setLoading(true);

    try {
      const data = {
        name: name.trim(),
        description: description.trim() || null,
        pricePerDay: Number(pricePerDay),
        capacity: Number(capacity) || 1,
        sizeAllowed,
        isActive,
      };

      if (isEditing) {
        await updateRoom(id!, data);
      } else {
        await createRoom(data as any);
      }

      queryClient.invalidateQueries({ queryKey: ["admin", "rooms"] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });

      if (isEditing) {
        router.back();
      } else {
        router.replace("/(admin)/rooms" as any);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        {isEditing ? "Editar cuarto" : "Nuevo cuarto"}
      </Text>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: Suite 1"
            placeholderTextColor={COLORS.textDisabled}
            value={name}
            onChangeText={setName}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Descripcion</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Descripcion opcional"
            placeholderTextColor={COLORS.textDisabled}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            editable={!loading}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, styles.flex]}>
            <Text style={styles.label}>Precio/dia ($)</Text>
            <TextInput
              style={styles.input}
              placeholder="350"
              placeholderTextColor={COLORS.textDisabled}
              value={pricePerDay}
              onChangeText={setPricePerDay}
              keyboardType="numeric"
              editable={!loading}
            />
          </View>
          <View style={[styles.inputGroup, styles.flex]}>
            <Text style={styles.label}>Capacidad</Text>
            <TextInput
              style={styles.input}
              placeholder="1"
              placeholderTextColor={COLORS.textDisabled}
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="numeric"
              editable={!loading}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Tamanos permitidos</Text>
          <View style={styles.sizeRow}>
            {SIZE_OPTIONS.map((size) => {
              const selected = sizeAllowed.includes(size.key);
              return (
                <TouchableOpacity
                  key={size.key}
                  style={[styles.sizeChip, selected && styles.sizeChipSelected]}
                  onPress={() => toggleSize(size.key)}
                  disabled={loading}
                >
                  <Text
                    style={[
                      styles.sizeChipText,
                      selected && styles.sizeChipTextSelected,
                    ]}
                  >
                    {size.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {isEditing && (
          <View style={styles.switchRow}>
            <Text style={styles.label}>Activo</Text>
            <Switch
              value={isActive}
              onValueChange={setIsActive}
              trackColor={{ true: COLORS.primary }}
              disabled={loading}
            />
          </View>
        )}

        <TouchableOpacity
          style={[styles.saveButton, loading && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.saveButtonText}>
              {isEditing ? "Guardar cambios" : "Crear cuarto"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 16,
  },
  backText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "600",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 20,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  flex: {
    flex: 1,
  },
  sizeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  sizeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
    borderWidth: 2,
    borderColor: COLORS.bgSection,
  },
  sizeChipSelected: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  sizeChipText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  sizeChipTextSelected: {
    color: COLORS.primary,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
