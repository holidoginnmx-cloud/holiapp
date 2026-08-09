import { View, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import { CreditBalancePill } from "@/components/CreditBalancePill";

// ── Botón de cuenta del header ───────────────────────────────────────────────
// NativeTabs no dibuja headers: cada pestaña monta su propio Stack (TabStack) y
// el headerRight se copiaba a mano en cada _layout, con márgenes distintos. De
// ahí venía el icono descentrado (un `marginRight: 16` que lo empujaba dentro
// del margen que ya aplica la barra nativa, y un touchable sin caja fija que
// dejaba el glifo colgando de su línea base) y que en Mis Mascotas,
// Reservaciones y Notificaciones no hubiera icono naranja: esos layouts solo
// ponían la píldora de crédito. Ahora todos usan estas dos piezas.

/** Caja de 32×32 que centra el glifo en ambos ejes; sin márgenes propios. */
export function HeaderProfileButton({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Tu cuenta"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
    </Pressable>
  );
}

/** headerRight de las 4 pestañas del cliente: píldora de crédito + cuenta. */
export function OwnerHeaderRight() {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <CreditBalancePill />
      <HeaderProfileButton
        onPress={() => router.push("/profile/account")}
        testID="tabs-account-button"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
