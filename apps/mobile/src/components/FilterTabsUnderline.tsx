import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Animated,
  ScrollView,
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
} from "react-native";

interface FilterTabsUnderlineProps {
  tabs: { key: string; label: string; count?: number }[];
  activeTab: string;
  onSelect: (key: string) => void;
  justified?: boolean;
  // Posición animada del underline en modo justified. Rango [0, tabs.length-1].
  // Cuando se provee, el underline por-tab se oculta y se renderiza una sola
  // línea animada absoluta que sigue este progress.
  progress?: Animated.Value;
}

export function FilterTabsUnderline({
  tabs,
  activeTab,
  onSelect,
  justified = false,
  progress,
}: FilterTabsUnderlineProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const animated = !!progress && justified;
  // justifiedRow tiene paddingHorizontal: 8 → 16px de padding total.
  const innerWidth = Math.max(0, containerWidth - 16);
  const tabWidth = containerWidth > 0 ? innerWidth / tabs.length : 0;

  const renderTab = (tab: { key: string; label: string; count?: number }) => {
    const isActive = tab.key === activeTab;
    const showCount = tab.count !== undefined && tab.count > 0;
    return (
      <TouchableOpacity
        key={tab.key}
        style={[styles.tab, justified && styles.tabJustified]}
        onPress={() => onSelect(tab.key)}
        activeOpacity={0.6}
      >
        <View style={[styles.tabRow, justified && styles.tabRowJustified]}>
          <Text style={[styles.tabText, isActive && styles.activeTabText]}>
            {tab.label}
          </Text>
          {showCount && (
            <View style={[styles.countBadge, isActive && styles.countBadgeActive]}>
              <Text
                style={[styles.countBadgeText, isActive && styles.countBadgeTextActive]}
              >
                {tab.count}
              </Text>
            </View>
          )}
        </View>
        {/* Underline estático: se oculta si hay underline animado */}
        <View
          style={[
            styles.underline,
            isActive && !animated && styles.underlineActive,
          ]}
        />
      </TouchableOpacity>
    );
  };

  if (justified) {
    return (
      <View style={styles.outer}>
        <View
          style={styles.justifiedRow}
          onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
          {tabs.map(renderTab)}
          {animated && tabWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.animatedUnderline,
                {
                  width: tabWidth,
                  transform: [
                    {
                      translateX: progress!.interpolate({
                        inputRange: [0, Math.max(1, tabs.length - 1)],
                        outputRange: [0, tabWidth * (tabs.length - 1)],
                        extrapolate: "clamp",
                      }),
                    },
                  ],
                },
              ]}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.outer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {tabs.map(renderTab)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  container: {
    paddingHorizontal: 16,
    gap: 24,
  },
  justifiedRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    position: "relative",
  },
  animatedUnderline: {
    position: "absolute",
    left: 8,
    bottom: -1,
    height: 2,
    backgroundColor: COLORS.primary,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  tab: {
    paddingTop: 8,
  },
  tabJustified: {
    flex: 1,
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 10,
  },
  tabRowJustified: {
    justifyContent: "center",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  activeTabText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
  },
  underline: {
    height: 2,
    marginBottom: -1,
    backgroundColor: "transparent",
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  underlineActive: {
    backgroundColor: COLORS.primary,
  },
  countBadge: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countBadgeActive: {
    backgroundColor: COLORS.primary,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  countBadgeTextActive: {
    color: COLORS.white,
  },
});
