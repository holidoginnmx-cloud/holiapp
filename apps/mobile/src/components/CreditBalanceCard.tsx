import { COLORS } from "@/constants/colors";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { getMe } from "@/lib/api";

export function CreditBalanceCard() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });
  const balance = Number(data?.creditBalance ?? 0);
  if (balance <= 0) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push("/profile/credit-history" as any)}
      activeOpacity={0.85}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="wallet" size={22} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>Saldo a favor</Text>
        <Text style={styles.amount}>${balance.toLocaleString("es-MX")} MXN</Text>
        <Text style={styles.subtitle}>Se aplicará en tu próxima reservación</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.reviewBg,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    marginBottom: 16,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 12, color: COLORS.textTertiary, fontWeight: "600" },
  amount: { fontSize: 18, fontWeight: "800", color: COLORS.primary, marginTop: 2 },
  subtitle: { fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
});
