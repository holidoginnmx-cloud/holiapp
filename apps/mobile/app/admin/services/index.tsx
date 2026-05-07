import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

type Card = {
  title: string;
  subtitle: string;
  icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap;
  color: string;
  bg: string;
  href: string;
};

const CARDS: Card[] = [
  {
    title: "Hospedajes",
    subtitle: "Tarifas por peso y recargo de medicación",
    icon: "bed",
    color: COLORS.primary,
    bg: COLORS.primaryLight,
    href: "/admin/services/hospedajes",
  },
  {
    title: "Baños",
    subtitle: "Precios por tamaño, deslanado y corte",
    icon: "water",
    color: COLORS.infoText,
    bg: COLORS.infoBg,
    href: "/admin/services/baths",
  },
];

export default function AdminServicesHub() {
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Servicios y precios</Text>
      <Text style={styles.sub}>
        Selecciona qué tarifas quieres administrar
      </Text>

      {CARDS.map((c) => (
        <TouchableOpacity
          key={c.href}
          style={styles.card}
          onPress={() => router.push(c.href as any)}
          activeOpacity={0.85}
        >
          <View style={[styles.iconWrap, { backgroundColor: c.bg }]}>
            <Ionicons name={c.icon} size={26} color={c.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{c.title}</Text>
            <Text style={styles.cardSubtitle}>{c.subtitle}</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={COLORS.textTertiary}
          />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16 },
  heading: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  sub: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    marginBottom: 16,
    fontWeight: "600",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    fontWeight: "600",
  },
});
