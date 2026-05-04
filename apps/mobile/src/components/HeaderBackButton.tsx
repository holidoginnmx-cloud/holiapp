import { COLORS } from "@/constants/colors";
import { TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface HeaderBackButtonProps {
  onPress: () => void;
  testID?: string;
  size?: number;
  color?: string;
}

export function HeaderBackButton({
  onPress,
  testID,
  size = 28,
  color = COLORS.primary,
}: HeaderBackButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.button}
      hitSlop={8}
      testID={testID}
    >
      <Ionicons name="chevron-back" size={size} color={color} style={styles.icon} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 24,
    height: 24,
    marginLeft: 4,
  },
  icon: {
    marginTop: -2.5,
  },
});
