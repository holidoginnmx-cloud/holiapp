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
  Image,
} from "react-native";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSignIn, useSSO } from "@clerk/clerk-expo";
import { useCallback, useState } from "react";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

type Step = "credentials" | "email_code";

export default function LoginScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { createdSessionId, setActive: setActiveSession } =
        await startSSOFlow({ strategy: "oauth_google" });

      if (createdSessionId && setActiveSession) {
        await setActiveSession({ session: createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("No se pudo completar el inicio con Google.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage;
      setError(msg ?? "Error al iniciar con Google. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [startSSOFlow, router]);

  const handleAppleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { createdSessionId, setActive: setActiveSession } =
        await startSSOFlow({ strategy: "oauth_apple" });

      if (createdSessionId && setActiveSession) {
        await setActiveSession({ session: createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("No se pudo completar el inicio con Apple.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage;
      setError(msg ?? "Error al iniciar con Apple. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [startSSOFlow, router]);

  const handleLogin = async () => {
    if (!isLoaded) {
      setError("Cargando autenticación, intenta de nuevo en un momento.");
      return;
    }

    if (!email.trim()) {
      setError("Ingresa tu email");
      return;
    }
    if (!email.includes("@")) {
      setError("El email no es válido");
      return;
    }
    if (!password) {
      setError("Ingresa tu contraseña");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await signIn.create({
        identifier: email.trim().toLowerCase(),
        strategy: "password",
        password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)/home");
        return;
      }

      if (result.status === "needs_first_factor") {
        const firstFactor = await signIn.attemptFirstFactor({
          strategy: "password",
          password,
        });

        if (firstFactor.status === "complete") {
          await setActive({ session: firstFactor.createdSessionId });
          router.replace("/(tabs)/home");
          return;
        }
      }

      setError("No se pudo completar el inicio de sesión. Intenta de nuevo.");
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!isLoaded) return;
    if (!code.trim()) {
      setError("Ingresa el código de verificación");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await signIn.attemptSecondFactor({
        strategy: "email_code",
        code: code.trim(),
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("No se pudo verificar el código. Intenta de nuevo.");
      }
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      await signIn.prepareSecondFactor({ strategy: "email_code" });
      setError("Código reenviado a tu email.");
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClerkError = (err: any) => {
    const clerkError = err?.errors?.[0];
    if (clerkError) {
      switch (clerkError.code) {
        case "form_password_incorrect":
          setError("Contraseña incorrecta");
          break;
        case "form_identifier_not_found":
          setError("No existe una cuenta con ese email");
          break;
        case "form_code_incorrect":
          setError("Código incorrecto");
          break;
        default:
          setError(clerkError.longMessage ?? "Error al iniciar sesión");
      }
    } else {
      setError("Error al iniciar sesión. Intenta de nuevo.");
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
        testID="auth-login-screen"
      >
        <View style={styles.logoContainer}>
          <Image
            source={require("../../assets/logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.subtitle}>
            {step === "credentials"
              ? "Bienvenido de regreso"
              : "Verificación de email"}
          </Text>
        </View>

        <View style={styles.form}>
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.errorText} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {step === "credentials" ? (
            <>
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
                  testID="auth-login-email-input"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Contraseña</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={COLORS.textDisabled}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="password"
                  editable={!loading}
                  testID="auth-login-password-input"
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                activeOpacity={0.8}
                disabled={loading}
                testID="auth-login-submit-button"
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.buttonText}>Iniciar sesión</Text>
                )}
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>o</Text>
                <View style={styles.dividerLine} />
              </View>

              {Platform.OS === "ios" && (
                <TouchableOpacity
                  style={[styles.appleButton, loading && styles.buttonDisabled]}
                  onPress={handleAppleLogin}
                  activeOpacity={0.8}
                  disabled={loading}
                  testID="auth-login-apple-button"
                >
                  <Ionicons name="logo-apple" size={20} color={COLORS.white} />
                  <Text style={styles.appleButtonText}>Continuar con Apple</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.googleButton, loading && styles.buttonDisabled]}
                onPress={handleGoogleLogin}
                activeOpacity={0.8}
                disabled={loading}
                testID="auth-login-google-button"
              >
                <Ionicons name="logo-google" size={20} color={COLORS.textPrimary} />
                <Text style={styles.googleButtonText}>Continuar con Google</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.codeInfo}>
                <Ionicons name="mail-outline" size={20} color={COLORS.textTertiary} />
                <Text style={styles.codeInfoText}>
                  Enviamos un código de verificación a{" "}
                  <Text style={styles.codeEmail}>{email}</Text>
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Código de verificación</Text>
                <TextInput
                  style={styles.input}
                  placeholder="123456"
                  placeholderTextColor={COLORS.textDisabled}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  editable={!loading}
                  autoFocus
                  testID="auth-login-code-input"
                />
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleVerifyCode}
                activeOpacity={0.8}
                disabled={loading}
                testID="auth-login-verify-code-button"
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.buttonText}>Verificar código</Text>
                )}
              </TouchableOpacity>

              <View style={styles.resendRow}>
                <TouchableOpacity onPress={handleResendCode} disabled={loading}>
                  <Text style={styles.footerLink}>Reenviar código</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setStep("credentials");
                    setCode("");
                    setError(null);
                  }}
                >
                  <Text style={styles.footerLink}>Volver</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === "credentials" && (
            <View style={styles.footer}>
              <Text style={styles.footerText}>¿No tienes cuenta? </Text>
              <Link href="/(auth)/register" asChild>
                <TouchableOpacity testID="auth-login-register-link">
                  <Text style={styles.footerLink}>Regístrate</Text>
                </TouchableOpacity>
              </Link>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bgPage },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    width: 210,
    height: 120,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginTop: 12,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textDisabled,
    marginTop: 4,
  },
  form: {
    gap: 16,
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
  codeInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    padding: 12,
  },
  codeInfoText: {
    color: COLORS.textTertiary,
    fontSize: 14,
    flex: 1,
  },
  codeEmail: {
    fontWeight: "700",
    color: COLORS.textSecondary,
  },
  resendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.borderLight,
  },
  dividerText: {
    color: COLORS.textTertiary,
    fontSize: 14,
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingVertical: 14,
  },
  googleButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
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
});
