import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSignUp, useSSO } from "@clerk/clerk-expo";
import { useCallback, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { BASE_URL } from "@/constants/api";

WebBrowser.maybeCompleteAuthSession();

export default function RegisterScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState("");

  const handleAppleSignUp = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { createdSessionId, setActive: setActiveSession } =
        await startSSOFlow({ strategy: "oauth_apple" });

      if (createdSessionId && setActiveSession) {
        await setActiveSession({ session: createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("No se pudo completar el registro con Apple.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage;
      setError(msg ?? "Error al registrarse con Apple. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [startSSOFlow, router]);

  const handleRegister = async () => {
    if (!isLoaded) {
      setError("Cargando... intenta de nuevo en un momento");
      return;
    }

    if (!firstName.trim()) {
      setError("Ingresa tu nombre");
      return;
    }
    if (!lastName.trim()) {
      setError("Ingresa tu apellido");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Ingresa un email válido");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const createResult = await signUp.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailAddress: email.trim().toLowerCase(),
        password,
      });

      // Check if sign-up is already complete (happens when username is disabled)
      if ((createResult as any)._status === "complete") {

        // Sign-up is complete, activate session and create in DB
        if ((createResult as any).createdSessionId) {
          // Create user in DB
          try {
            await fetch(`${BASE_URL}/users`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clerkId: (createResult as any).createdUserId,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: email.trim().toLowerCase(),
                role: "OWNER",
              }),
            });
          } catch (err) {
            // Error handled by syncUser() in layout
          }

          await setActive({ session: (createResult as any).createdSessionId });
          router.replace("/(tabs)/home");
        }
        return;
      }

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      setPendingVerification(true);
    } catch (err: any) {
      const clerkError = err?.errors?.[0];
      if (clerkError) {
        switch (clerkError.code) {
          case "form_identifier_exists":
            setError("Ya existe una cuenta con ese email");
            break;
          case "form_password_pwned":
            setError("Esa contraseña es demasiado común. Elige otra.");
            break;
          case "form_password_length_too_short":
            setError("La contraseña debe tener al menos 8 caracteres");
            break;
          case "client_state_invalid":
            setError("Error de sesión. Por favor, intenta de nuevo.");
            break;
          default:
            setError(clerkError.longMessage ?? "Error al crear la cuenta");
        }
      } else {
        setError("Error al crear la cuenta. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!isLoaded) return;

    if (code.length < 6) {
      setError("Ingresa el código de 6 dígitos");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await signUp.attemptEmailAddressVerification({ code });

      if (result.status === "missing_requirements") {
        // If username is missing, generate one from firstName + lastName
        if ((result as any).missingFields?.includes("username")) {
          const generatedUsername = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`.replace(/\s+/g, "");

          try {
            await signUp.update({ username: generatedUsername });
          } catch (err) {
            setError("Error actualizando perfil. Intenta de nuevo.");
            return;
          }
        }
      }

      // Now check if we have a valid session to activate
      if (result.createdSessionId && result.createdUserId) {
        // Create user in DB
        try {
          await fetch(`${BASE_URL}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clerkId: result.createdUserId,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim().toLowerCase(),
              role: "OWNER",
            }),
          });
        } catch (err) {
          // Error handled by syncUser() in layout
        }

        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("Error en la verificación. Intenta de nuevo.");
      }
    } catch (err: any) {
      const clerkError = err?.errors?.[0];
      if (clerkError) {
        switch (clerkError.code) {
          case "verification_failed":
            setError("Código incorrecto. Verifica tu email e intenta de nuevo.");
            break;
          case "verification_expired":
            setError("El código expiró. Regresa y vuelve a registrarte.");
            break;
          default:
            setError(clerkError.longMessage ?? "Error al verificar el código");
        }
      } else {
        setError("Error al verificar. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoContainer}>
          <Ionicons name="paw" size={56} color={COLORS.primary} />
          <Text style={styles.title}>Crear cuenta</Text>
          <Text style={styles.subtitle}>Únete a la familia HDI</Text>
        </View>

        <View style={styles.form}>
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.errorText} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {!pendingVerification ? (
            <>
              {Platform.OS === "ios" && (
                <>
                  <TouchableOpacity
                    style={[styles.appleButton, loading && styles.buttonDisabled]}
                    onPress={handleAppleSignUp}
                    activeOpacity={0.8}
                    disabled={loading}
                    testID="auth-register-apple-button"
                  >
                    <Ionicons name="logo-apple" size={20} color={COLORS.white} />
                    <Text style={styles.appleButtonText}>Continuar con Apple</Text>
                  </TouchableOpacity>

                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>o regístrate con email</Text>
                    <View style={styles.dividerLine} />
                  </View>
                </>
              )}

              <View style={styles.row}>
                <View style={[styles.inputGroup, styles.flex]}>
                  <Text style={styles.label}>Nombre</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Juan"
                    placeholderTextColor={COLORS.textDisabled}
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                    editable={!loading}
                  />
                </View>
                <View style={[styles.inputGroup, styles.flex]}>
                  <Text style={styles.label}>Apellido</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Pérez"
                    placeholderTextColor={COLORS.textDisabled}
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                    editable={!loading}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="tu@email.com"
                  placeholderTextColor={COLORS.textDisabled}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  editable={!loading}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Contraseña</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Mínimo 8 caracteres"
                  placeholderTextColor={COLORS.textDisabled}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  editable={!loading}
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleRegister}
                activeOpacity={0.8}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.buttonText}>Crear cuenta</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footer}>
                <Text style={styles.footerText}>¿Ya tienes cuenta? </Text>
                <Link href="/(auth)/login" asChild>
                  <TouchableOpacity>
                    <Text style={styles.footerLink}>Inicia sesión</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </>
          ) : (
            <>
              <View style={styles.verifyInfo}>
                <Ionicons name="mail-outline" size={40} color={COLORS.primary} />
                <Text style={styles.verifyTitle}>Revisa tu correo</Text>
                <Text style={styles.verifySubtitle}>
                  Enviamos un código de verificación a{"\n"}
                  <Text style={styles.verifyEmail}>{email}</Text>
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Código de verificación</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  placeholder="000000"
                  placeholderTextColor={COLORS.textDisabled}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  editable={!loading}
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleVerify}
                activeOpacity={0.8}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.buttonText}>Verificar y entrar</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setPendingVerification(false);
                  setCode("");
                  setError(null);
                }}
              >
                <Text style={styles.backButtonText}>← Cambiar email</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    backgroundColor: COLORS.bgPage,
    paddingHorizontal: 24,
    justifyContent: "center",
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 12,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textDisabled,
    marginTop: 4,
  },
  form: {
    gap: 14,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.errorBgLight,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
  },
  errorText: {
    color: COLORS.errorText,
    fontSize: 14,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  footerText: {
    color: COLORS.textTertiary,
    fontSize: 14,
  },
  footerLink: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  verifyInfo: {
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  verifyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  verifySubtitle: {
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  verifyEmail: {
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
  },
  backButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  backButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  appleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#000000",
    borderRadius: 10,
    paddingVertical: 14,
  },
  appleButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderLight,
  },
  dividerText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
});
