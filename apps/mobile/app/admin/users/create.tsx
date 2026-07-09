import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { createUser } from "@/lib/api";
import { formatPhoneInput } from "@/lib/format";

/**
 * Alta de cliente walk-in desde el admin: clientes que llegan sin la app
 * (teléfono/WhatsApp). Con su teléfono capturado, cuando descarguen la app
 * podrán reclamar su cuenta y ver a sus mascotas ("¿Ya eres cliente?").
 */
export default function AdminCreateClient() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const phoneDigits = phone.replace(/\D/g, "");
  const emailTrimmed = email.trim();
  const emailLooksValid =
    emailTrimmed.length === 0 || /^\S+@\S+\.\S+$/.test(emailTrimmed);
  const phoneLooksValid = phoneDigits.length === 0 || phoneDigits.length >= 10;
  const canSubmit =
    firstName.trim().length > 0 && phoneLooksValid && emailLooksValid;

  const mutation = useMutation({
    mutationFn: () =>
      createUser({
        firstName: firstName.trim(),
        // El schema exige lastName no vacío; "—" es el mismo fallback que
        // usa el admin web para clientes sin apellido capturado.
        lastName: lastName.trim() || "—",
        phone: phone.trim() || null,
        ...(emailTrimmed ? { email: emailTrimmed.toLowerCase() } : {}),
      }),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      Alert.alert(
        "Cliente creado",
        `${user.firstName} ya aparece en la lista de clientes.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    },
    onError: (e: Error) => Alert.alert("No se pudo crear", e.message),
  });

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.introCard}>
          <Ionicons name="person-add" size={20} color={COLORS.primary} />
          <Text style={styles.introText}>
            Da de alta a un cliente que llega sin la app. Con su teléfono,
            cuando la descargue podrá vincular su cuenta y ver a sus mascotas.
          </Text>
        </View>

        <Text style={styles.label}>Nombre(s) *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: María"
          placeholderTextColor={COLORS.textDisabled}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          autoCorrect={false}
          testID="create-client-firstname"
        />

        <Text style={styles.label}>Apellido(s)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: García"
          placeholderTextColor={COLORS.textDisabled}
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          autoCorrect={false}
          testID="create-client-lastname"
        />

        <Text style={styles.label}>Teléfono</Text>
        <TextInput
          style={[styles.input, !phoneLooksValid && styles.inputError]}
          placeholder="(662) 123-4567"
          placeholderTextColor={COLORS.textDisabled}
          value={phone}
          onChangeText={(t) => setPhone(formatPhoneInput(t))}
          keyboardType="phone-pad"
          testID="create-client-phone"
        />
        {!phoneLooksValid ? (
          <Text style={styles.fieldError}>
            El teléfono debe tener 10 dígitos.
          </Text>
        ) : (
          <Text style={styles.fieldHint}>
            Recomendado: es lo que usa el cliente para reclamar su cuenta en
            la app.
          </Text>
        )}

        <Text style={styles.label}>Correo (opcional)</Text>
        <TextInput
          style={[styles.input, !emailLooksValid && styles.inputError]}
          placeholder="cliente@correo.com"
          placeholderTextColor={COLORS.textDisabled}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="create-client-email"
        />
        {!emailLooksValid && (
          <Text style={styles.fieldError}>Ese correo no se ve válido.</Text>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, (!canSubmit || mutation.isPending) && styles.submitBtnDisabled]}
          onPress={() => mutation.mutate()}
          disabled={!canSubmit || mutation.isPending}
          activeOpacity={0.8}
          testID="create-client-submit"
        >
          {mutation.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={COLORS.white} />
              <Text style={styles.submitBtnText}>Crear cliente</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  introCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  inputError: {
    borderColor: COLORS.errorText,
  },
  fieldError: {
    fontSize: 12,
    color: COLORS.errorText,
    marginTop: -6,
    marginBottom: 12,
  },
  fieldHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: -6,
    marginBottom: 12,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
});
