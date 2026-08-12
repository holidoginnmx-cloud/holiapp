import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";

/**
 * Campana con contador de avisos sin leer.
 *
 * Misma caja de 32×32 que HeaderProfileButton para que los dos queden
 * alineados en el headerRight; el contador se dibuja encima, fuera del flujo,
 * para no descentrar el glifo.
 */
export function HeaderBellButton({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID?: string;
}) {
  const { unreadCount } = useUnreadNotifications();

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={
        unreadCount > 0 ? `Avisos, ${unreadCount} sin leer` : "Avisos"
      }
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="notifications-outline" size={26} color={COLORS.primary} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: COLORS.dangerText,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 10,
    lineHeight: 13,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
