import { COLORS } from "@/constants/colors";
import { Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { getMe } from "@/lib/api";

export function CreditBalancePill() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });
  const balance = Number(data?.creditBalance ?? 0);
  if (balance <= 0) return null;

  const label = balance >= 1000
    ? `$${Math.round(balance / 100) / 10}k`
    : `$${Math.round(balance)}`;

  return (
    <TouchableOpacity
      onPress={() => router.push("/profile/credit-history" as any)}
      style={styles.pill}
      activeOpacity={0.85}
      hitSlop={8}
    >
      <Ionicons name="wallet" size={14} color={COLORS.primary} />
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.reviewBg,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
});
