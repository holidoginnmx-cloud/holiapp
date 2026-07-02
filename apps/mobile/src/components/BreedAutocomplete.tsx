import { COLORS } from "@/constants/colors";
import { useMemo, useState } from "react";
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DOG_BREEDS, normalizeBreed } from "@/constants/breeds";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

const MAX_SUGGESTIONS = 8;

// Autocompletado de raza: sugiere razas de una lista local mientras el usuario
// escribe. NO restringe — el campo sigue siendo texto libre (onChangeText llama
// onChange directo). El dropdown es inline (empuja el contenido); el ScrollView
// del formulario ya tiene keyboardShouldPersistTaps="handled".
export function BreedAutocomplete({ value, onChange, placeholder }: Props) {
  const [focused, setFocused] = useState(false);

  const matches = useMemo(() => {
    const q = normalizeBreed(value);
    if (!q) return [];
    return DOG_BREEDS.map((b) => ({ b, n: normalizeBreed(b) }))
      .filter((x) => x.n.includes(q))
      // Prefijo (empieza-con) primero, luego alfabético en español.
      .sort((a, z) => {
        const ap = a.n.startsWith(q) ? 0 : 1;
        const zp = z.n.startsWith(q) ? 0 : 1;
        return ap - zp || a.b.localeCompare(z.b, "es");
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((x) => x.b);
  }, [value]);

  // Si lo escrito YA es exactamente una raza, no mostramos un dropdown de 1.
  const exact =
    matches.length === 1 && normalizeBreed(matches[0]) === normalizeBreed(value);
  const showDropdown = focused && matches.length > 0 && !exact;

  return (
    <View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        autoCorrect={false}
        autoCapitalize="words"
        onFocus={() => setFocused(true)}
        // Pequeño delay para que el tap sobre una sugerencia se procese antes de
        // ocultar el dropdown (además de keyboardShouldPersistTaps del ScrollView).
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {showDropdown && (
        <View style={styles.dropdown}>
          {matches.map((b) => (
            <TouchableOpacity
              key={b}
              style={styles.row}
              onPress={() => {
                onChange(b);
                setFocused(false);
              }}
            >
              <Ionicons name="paw-outline" size={16} color={COLORS.textTertiary} />
              <Text style={styles.rowText}>{b}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  dropdown: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgSection,
  },
  rowText: { fontSize: 15, color: COLORS.textPrimary },
});
