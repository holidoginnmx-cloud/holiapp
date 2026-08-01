import { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LiquidTabBarView, liquidTabBarOnScroll } from "@/components/LiquidTabBar";
import { COLORS } from "@/constants/colors";

// Preview SOLO de desarrollo del tab bar flotante (holidoginn://dev-tabbar).
// Renderiza contenido de relleno detrás para evaluar el efecto glass.
export default function DevTabBarPreview() {
  const [active, setActive] = useState(0);
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <View style={{ flex: 1, backgroundColor: "#FBF7F2" }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 70, gap: 14 }}
        onScroll={liquidTabBarOnScroll}
        scrollEventThrottle={16}
      >
        <Text style={styles.title}>Preview del tab bar</Text>
        {Array.from({ length: 12 }, (_, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.avatar} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={[styles.line, { width: "60%" }]} />
              <View style={[styles.line, { width: "85%", opacity: 0.5 }]} />
            </View>
          </View>
        ))}
      </ScrollView>
      <LiquidTabBarView
        items={[
          {
            key: "home",
            renderIcon: (_f, color, size) => <Ionicons name="home" size={size} color={color} />,
          },
          {
            key: "pets",
            renderIcon: (_f, color, size) => <Ionicons name="paw" size={size} color={color} />,
          },
          {
            key: "reservations",
            renderIcon: (_f, color, size) => (
              <Ionicons name="calendar" size={size} color={color} />
            ),
          },
          {
            key: "notifications",
            badge: 3,
            renderIcon: (_f, color, size) => (
              <Ionicons name="notifications" size={size} color={color} />
            ),
          },
        ]}
        activeIndex={active}
        onPress={setActive}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#EFE8DD",
  },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#E9E0D2" },
  line: { height: 12, borderRadius: 6, backgroundColor: "#D8CDBC" },
});
