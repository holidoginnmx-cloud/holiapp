import { COLORS } from "@/constants/colors";
import { useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import ConfettiCannon from "react-native-confetti-cannon";

const { width } = Dimensions.get("window");

export default function ReservationSuccess() {
  const router = useRouter();
  const { reservationId, paymentType, amount } = useLocalSearchParams<{
    reservationId?: string;
    paymentType?: "FULL" | "DEPOSIT";
    amount?: string;
  }>();
  const confettiRef = useRef<ConfettiCannon>(null);

  useEffect(() => {
    const t = setTimeout(() => confettiRef.current?.start(), 200);
    return () => clearTimeout(t);
  }, []);

  const isDeposit = paymentType === "DEPOSIT";
  const depositAmount = Number(amount ?? 0);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <ConfettiCannon
          ref={confettiRef}
          count={180}
          origin={{ x: width / 2, y: 0 }}
          autoStart={false}
          fadeOut
          fallSpeed={3200}
          explosionSpeed={450}
          colors={[COLORS.primary, "#F7B84B", "#7AB5A8", "#E35F27", "#3a7cab"]}
        />

        <View style={styles.iconWrap}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark" size={56} color={COLORS.white} />
          </View>
        </View>

        <Text style={styles.title}>¡Reservación confirmada!</Text>
        <Text style={styles.subtitle}>
          Tu mascota ya tiene lugar en HolidogInn. Recibirás seguimiento
          constante durante su estancia.
        </Text>

        {isDeposit && depositAmount > 0 && (
          <View style={styles.depositCard}>
            <Ionicons name="information-circle" size={20} color={COLORS.warningText} />
            <Text style={styles.depositText}>
              Se cobró el anticipo de{" "}
              <Text style={styles.depositAmount}>
                ${depositAmount.toLocaleString("es-MX")}
              </Text>
              . Deberás liquidar el saldo{" "}
              <Text style={styles.depositBold}>48 horas antes del check-in</Text>.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          {reservationId && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                router.replace(`/(tabs)/reservation/${reservationId}` as any)
              }
              activeOpacity={0.85}
            >
              <Ionicons name="document-text-outline" size={20} color={COLORS.white} />
              <Text style={styles.primaryBtnText}>Ver reservación</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.replace("/(tabs)/reservations" as any)}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>Ir a mis reservaciones</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  iconWrap: {
    marginBottom: 20,
  },
  iconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
    marginBottom: 24,
  },
  depositCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: COLORS.warningBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 32,
    maxWidth: 360,
  },
  depositText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  depositAmount: {
    fontWeight: "700",
    color: COLORS.warningText,
  },
  depositBold: {
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  actions: {
    width: "100%",
    maxWidth: 360,
    gap: 10,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
});
