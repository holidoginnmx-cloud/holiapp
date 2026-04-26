import { COLORS } from "@/constants/colors";
import { ScrollView, TouchableOpacity, Text, View, StyleSheet } from "react-native";

interface FilterTabsUnderlineProps {
  tabs: { key: string; label: string; count?: number }[];
  activeTab: string;
  onSelect: (key: string) => void;
}

export function FilterTabsUnderline({ tabs, activeTab, onSelect }: FilterTabsUnderlineProps) {
  return (
    <View style={styles.outer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          const showCount = tab.count !== undefined && tab.count > 0;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => onSelect(tab.key)}
              activeOpacity={0.6}
            >
              <View style={styles.tabRow}>
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
              <View style={[styles.underline, isActive && styles.underlineActive]} />
            </TouchableOpacity>
          );
        })}
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
  tab: {
    paddingTop: 8,
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 10,
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
