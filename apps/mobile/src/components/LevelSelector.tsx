import { COLORS } from "@/constants/colors";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface LevelSelectorProps {
  label: string;
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
}

export function LevelSelector({
  label,
  options,
  selected,
  onSelect,
}: LevelSelectorProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.optionsRow}>
        {options.map((option) => {
          const isSelected = option.key === selected;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.option, isSelected && styles.optionSelected]}
              onPress={() => onSelect(option.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.optionText,
                  isSelected && styles.optionTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
  },
  optionSelected: {
    backgroundColor: COLORS.primary,
  },
  optionText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  optionTextSelected: {
    color: COLORS.white,
  },
});
