import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { formatCurrency } from "@/lib/format";
import type { DiscountCodeState } from "@/hooks/useDiscountCode";
import { wizardStyles as styles } from "@/styles/wizardStyles";

type DiscountCodeRowProps = {
  /** Estado devuelto por `useDiscountCode(subtotal)`. */
  discount: DiscountCodeState;
};

/**
 * Fila de código de descuento dentro de la tarjeta de precios de los
 * wizards: input + botón "Aplicar", o la línea del descuento aplicado con
 * opción de quitarlo.
 */
export function DiscountCodeRow({ discount }: DiscountCodeRowProps) {
  const {
    discountCodeInput,
    setDiscountCodeInput,
    appliedDiscount,
    applyingDiscount,
    applyDiscount,
    removeDiscount,
    discountTotal,
  } = discount;

  if (appliedDiscount) {
    return (
      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>Descuento ({appliedDiscount.code})</Text>
        <View style={styles.discountAppliedValue}>
          <Text style={styles.discountValueText}>
            −{formatCurrency(discountTotal)}
          </Text>
          <TouchableOpacity onPress={removeDiscount} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.discountRow}>
      <TextInput
        style={styles.discountInput}
        placeholder="Código de descuento"
        placeholderTextColor={COLORS.textTertiary}
        autoCapitalize="characters"
        autoCorrect={false}
        value={discountCodeInput}
        onChangeText={setDiscountCodeInput}
        editable={!applyingDiscount}
      />
      <TouchableOpacity
        style={[
          styles.discountApplyBtn,
          (applyingDiscount || !discountCodeInput.trim()) &&
            styles.discountApplyBtnDisabled,
        ]}
        onPress={applyDiscount}
        disabled={applyingDiscount || !discountCodeInput.trim()}
      >
        <Text style={styles.discountApplyText}>
          {applyingDiscount ? "…" : "Aplicar"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
