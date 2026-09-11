import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

/** Mayúsculas, sin nada que no sea letra o número, y el guion después de 4. */
function formatTyped(text: string): string {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/**
 * "Tengo un código": para quien recibió la invitación ANTES de tener la app.
 *
 * La liga del mensaje abre el sitio, no la app (no hay universal links), y
 * después de instalarla ya no la lleva a ningún lado. Por eso el mensaje y la
 * página traen un código de 8 caracteres: se escribe aquí y sigue el mismo
 * camino que la liga (`/invite/<código>`).
 */
export default function InviteCodeScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.replace(/-/g, "");
  const complete = clean.length === 8;

  const submit = () => {
    if (!complete) return;
    router.replace(`/invite/${clean}` as any);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconCircle}>
          <Ionicons name="key-outline" size={32} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>Escribe tu código</Text>
        <Text style={styles.body}>
          Viene en el mensaje que te mandaron para compartir a su mascota contigo: son 8 letras y
          números, como ABCD-EFGH.
        </Text>

        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(formatTyped(t))}
          placeholder="ABCD-EFGH"
          placeholderTextColor={COLORS.textDisabled}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={9}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={submit}
          testID="invite-code-input"
        />

        <TouchableOpacity
          style={[styles.button, !complete && styles.buttonDisabled]}
          onPress={submit}
          disabled={!complete}
          activeOpacity={0.85}
          testID="invite-code-submit"
        >
          <Text style={styles.buttonText}>Continuar</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          ¿No tienes código? Pídele a quien registró a tu mascota que te invite desde su app: en la
          ficha de la mascota, «Compartir».
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 24, alignItems: "center" },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  title: {
    marginTop: 16,
    fontSize: 22,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  input: {
    marginTop: 24,
    alignSelf: "stretch",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 16,
    fontSize: 26,
    letterSpacing: 4,
    textAlign: "center",
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  button: {
    marginTop: 16,
    alignSelf: "stretch",
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
  hint: {
    marginTop: 24,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 19,
  },
});
