import { useEffect, useRef } from "react";
import {
  Animated,
  DimensionValue,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { COLORS } from "@/constants/colors";

type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: ViewStyle | ViewStyle[];
};

/**
 * Bloque de carga animado (pulso de opacidad). No usa dependencias extra:
 * el Animated nativo de React Native con useNativeDriver basta y es fluido.
 * Sustituye al spinner para que el usuario vea la "forma" del contenido
 * mientras llega la data.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: COLORS.borderLight,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Placeholder con forma de tarjeta (foto + líneas de texto). */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton width={56} height={56} radius={28} />
      <View style={styles.cardBody}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="85%" height={12} style={{ marginTop: 8 }} />
        <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

/** Lista de tarjetas skeleton (para pantallas de listado). */
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

/** Skeleton específico de la pantalla de inicio (saludo + acciones + tarjetas). */
export function HomeSkeleton() {
  return (
    <View style={styles.home}>
      <Skeleton width="55%" height={26} radius={10} />
      <View style={styles.actionRow}>
        <Skeleton height={48} radius={12} style={{ flex: 1 }} />
        <Skeleton height={48} radius={12} style={{ flex: 1 }} />
        <Skeleton height={48} radius={12} style={{ flex: 1 }} />
      </View>
      <Skeleton width="100%" height={120} radius={16} style={{ marginTop: 4 }} />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 16,
    gap: 14,
  },
  cardBody: {
    flex: 1,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  home: {
    padding: 16,
    gap: 14,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
});
