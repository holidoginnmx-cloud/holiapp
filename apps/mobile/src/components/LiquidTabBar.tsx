import { View, Pressable, Text, StyleSheet } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  makeMutable,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { COLORS } from "@/constants/colors";

// ── Tab bar flotante estilo "liquid glass" (iOS 26 / Instagram) ──
// Sin expo-blur (módulo nativo, exigiría build nuevo): el vidrio se simula
// con translúcido + gradiente + brillos inset (boxShadow new-arch) + sombra.
// El ítem activo lleva una cápsula tenue detrás del ícono.
//
// Minimize-on-scroll (patrón de expo-glass-tabs, en JS puro): las pantallas
// reportan su scroll con `liquidTabBarOnScroll` y la barra se encoge al bajar
// y reaparece al subir. El spring corre en el hilo de UI.

const INK = "#062F3D";

/** Progreso 0 (normal) → 1 (minimizada). Compartido a nivel módulo. */
const minimize = makeMutable(0);
let lastY = 0;

const SPRING = { damping: 18, stiffness: 180, mass: 0.6 };

/**
 * Conéctalo al onScroll de la ScrollView/FlatList principal de una pantalla
 * de tabs (con scrollEventThrottle={16}). Umbral pequeño para ignorar jitter.
 */
export function liquidTabBarOnScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
  const y = e.nativeEvent.contentOffset.y;
  const dy = y - lastY;
  lastY = y;
  if (y <= 12) {
    if (minimize.value !== 0) minimize.value = withSpring(0, SPRING);
    return;
  }
  if (dy > 4 && minimize.value !== 1) minimize.value = withSpring(1, SPRING);
  else if (dy < -4 && minimize.value !== 0) minimize.value = withSpring(0, SPRING);
}

/** Restaura la barra (p. ej. al cambiar de pestaña). */
export function expandLiquidTabBar() {
  lastY = 0;
  minimize.value = withSpring(0, SPRING);
}

export interface LiquidTabItem {
  key: string;
  renderIcon: (focused: boolean, color: string, size: number) => React.ReactNode;
  badge?: string | number;
  testID?: string;
  accessibilityLabel?: string;
}

export function LiquidTabBarView({
  items,
  activeIndex,
  onPress,
}: {
  items: LiquidTabItem[];
  activeIndex: number;
  onPress: (index: number) => void;
}) {
  const insets = useSafeAreaInsets();

  // Al minimizar: se encoge anclada abajo, baja un poco y se atenúa apenas.
  const shrinkStyle = useAnimatedStyle(() => {
    const p = minimize.value;
    return {
      opacity: 1 - 0.06 * p,
      transform: [{ translateY: 14 * p }, { scale: 1 - 0.22 * p }],
    };
  });
  // Los ítems se desvanecen ligeramente para el estado compacto.
  const itemsStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.25 * minimize.value,
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom - 6, 10) }]}
    >
      <Animated.View style={[styles.pill, shrinkStyle]}>
        {/* brillo superior del vidrio */}
        <View pointerEvents="none" style={styles.shine} />
        <Animated.View style={[styles.row, itemsStyle]}>
          {items.map((item, i) => {
            const focused = i === activeIndex;
            const color = focused ? COLORS.primary : "#8B9AA0";
            return (
              <Pressable
                key={item.key}
                onPress={() => onPress(i)}
                testID={item.testID}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={item.accessibilityLabel}
                style={styles.item}
              >
                <View style={[styles.capsule, focused && styles.capsuleActive]}>
                  {item.renderIcon(focused, color, 24)}
                  {item.badge != null && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText} numberOfLines={1}>
                        {typeof item.badge === "number" && item.badge > 99
                          ? "99+"
                          : String(item.badge)}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Adaptador para react-navigation: pásalo como `tabBar` de <Tabs>. */
export function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const visible = state.routes.filter((route) => {
    const opts = descriptors[route.key].options as any;
    return opts.href !== null && opts.tabBarItemStyle?.display !== "none";
  });

  const items: LiquidTabItem[] = visible.map((route) => {
    const opts = descriptors[route.key].options as any;
    return {
      key: route.key,
      renderIcon: (focused, color, size) =>
        opts.tabBarIcon ? opts.tabBarIcon({ focused, color, size }) : null,
      badge: opts.tabBarBadge,
      testID: opts.tabBarButtonTestID,
      accessibilityLabel: opts.title ?? route.name,
    };
  });

  const activeKey = state.routes[state.index]?.key;
  const activeIndex = visible.findIndex((r) => r.key === activeKey);

  return (
    <LiquidTabBarView
      items={items}
      activeIndex={activeIndex}
      onPress={(i) => {
        const route = visible[i];
        const event = navigation.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
        if (route.key !== activeKey && !event.defaultPrevented) {
          expandLiquidTabBar();
          navigation.navigate(route.name, route.params);
        } else if (route.key === activeKey) {
          expandLiquidTabBar();
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 14,
    right: 14,
    alignItems: "center",
  },
  pill: {
    alignSelf: "stretch",
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    transformOrigin: "50% 100%",
    // Vidrio: translúcido + gradiente vertical sutil (new arch).
    backgroundColor: "rgba(251,248,243,0.72)",
    experimental_backgroundImage:
      "linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.06) 45%, rgba(6,47,61,0.05) 100%)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.65)",
    // Brillos internos (rim) + sombra de elevación, receta liquid glass.
    boxShadow:
      "inset 1.5px 1.5px 1px rgba(255,255,255,0.70), inset -1px -1px 1px rgba(255,255,255,0.35), 0 10px 30px rgba(6,47,61,0.18), 0 2px 8px rgba(6,47,61,0.10)",
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 10,
  },
  shine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 30,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: "rgba(255,255,255,0.30)",
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  capsule: {
    minWidth: 56,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  capsuleActive: {
    backgroundColor: "rgba(6,47,61,0.08)",
  },
  badge: {
    position: "absolute",
    top: 3,
    right: 6,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: COLORS.dangerText,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
