import { COLORS } from "@/constants/colors";
import { useEffect } from "react";
import { StyleSheet, Text, Pressable, ActivityIndicator, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";

interface Props {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  testID?: string;
}

export function AnimatedPayButton({
  onPress,
  disabled = false,
  loading = false,
  label = "Pagar y confirmar",
  testID,
}: Props) {
  const scale = useSharedValue(1);
  const active = !disabled && !loading;

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.02, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
    }
    return () => {
      cancelAnimation(scale);
    };
  }, [active, scale]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    if (active) {
      scale.value = withSequence(
        withTiming(1.02, { duration: 180 }),
        withTiming(1, { duration: 180 })
      );
    } else {
      scale.value = withTiming(1, { duration: 120 });
    }
  };

  return (
    <Animated.View style={[styles.wrap, containerStyle]}>
      <Pressable
        style={[styles.button, !active && styles.disabled]}
        onPress={active ? onPress : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={!active}
        testID={testID}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="card-outline" size={22} color={COLORS.white} />
              <Text style={styles.label}>{label}</Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    borderRadius: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    overflow: "hidden",
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.white,
  },
});
