import {
  View,
  Text,
  TextInput,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useSignIn, useSignUp, useSSO } from "@clerk/clerk-expo";
import { useCallback, useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from "react-native-svg";
import Animated, {
  Easing,
  FadeInUp,
  ZoomIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive } from "@/lib/responsive";
import { formatName } from "@/lib/format";

WebBrowser.maybeCompleteAuthSession();

// ── Tokens del diseño "Login Holidog Inn" (Claude Design) ────────
const C = {
  ink: "#062F3D",
  inkSoft: "#4A5F67",
  muted: "#6B7A80",
  faint: "#98A5AA",
  placeholder: "#AFB9BC",
  cream: "#FBF7F2",
  sand: "#F0E9E0",
  sandBorder: "#E8E0D5",
  border: "#E6DED3",
  borderSoft: "#E7DFD4",
  focus: "#0E4557",
  orange: "#E35F27",
  orangeDark: "#D2531F",
  link: "#C64E1C",
  error: "#C0392B",
  white: "#FFFFFF",
  eye: "#8B9AA0",
};

const F = {
  display: "Outfit_600SemiBold",
  body: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
};

const HERO_PHOTO = require("../../../assets/login-hero.jpg");
const LOGO_WHITE = require("../../../assets/logo-white.png");
const LOGO_ASPECT = 900 / 473;
const MAX_PAWS = 16;

type Mode = "login" | "signup";
type Step = "form" | "loginCode" | "signupCode" | "resetCode";

// ── Piezas animadas ──────────────────────────────────────────────

/** Huella del rastro que "camina" en diagonal por el panel héroe. */
function TrailPaw({
  left,
  top,
  size,
  rotate,
  delay,
}: {
  left: `${number}%`;
  top: `${number}%`;
  size: number;
  rotate: number;
  delay: number;
}) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.15, { duration: 760 }),
          withTiming(0.15, { duration: 1730 }),
          withTiming(0, { duration: 1400 }),
          withTiming(0, { duration: 1510 })
        ),
        -1
      )
    );
  }, [delay, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", left, top, transform: [{ rotate: `${rotate}deg` }] },
        style,
      ]}
    >
      <Ionicons name="paw" size={size} color={C.white} />
    </Animated.View>
  );
}

/** Huellita que corre dentro del botón mientras carga. */
function RunPaw({ delay }: { delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 950, easing: Easing.inOut(Easing.ease) }), -1)
    );
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.3, 0.7, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(t.value, [0, 0.3, 1], [-6, 0, 8]) },
      { scale: interpolate(t.value, [0, 0.3, 0.7, 1], [0.7, 1, 1, 0.8]) },
    ],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="paw" size={15} color={C.white} />
    </Animated.View>
  );
}

/** Cursor parpadeante junto a las huellas de la contraseña. */
function BlinkCaret() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 60 }),
        withDelay(470, withTiming(0, { duration: 60 })),
        withDelay(470, withTiming(0, { duration: 0 }))
      ),
      -1
    );
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ width: 1.6, height: 19, marginLeft: 2, backgroundColor: C.ink }, style]}
    />
  );
}

/** Contenedor que se sacude cuando su campo tiene error. */
function ShakeView({
  trigger,
  children,
}: {
  trigger: number;
  children: React.ReactNode;
}) {
  const x = useSharedValue(0);
  useEffect(() => {
    if (!trigger) return;
    x.value = withSequence(
      withTiming(-5, { duration: 80 }),
      withTiming(5, { duration: 80 }),
      withTiming(-3, { duration: 80 }),
      withTiming(3, { duration: 80 }),
      withTiming(0, { duration: 80 })
    );
  }, [trigger, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function GoogleLogo() {
  return (
    <Svg viewBox="0 0 48 48" width={18} height={18}>
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.32-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.68 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.34-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.34 5.7c1.74-5.2 6.59-9.07 12.32-9.07z"
      />
    </Svg>
  );
}

// ── Panel héroe ──────────────────────────────────────────────────

function HeroPanel({ isTablet, mode }: { isTablet: boolean; mode: Mode }) {
  const insets = useSafeAreaInsets();
  const logoH = isTablet ? 48 : 40;
  return (
    <View
      style={[
        styles.hero,
        isTablet
          ? { flex: 1, paddingTop: insets.top + 36, paddingHorizontal: 36, paddingBottom: 42 }
          : {
              paddingTop: insets.top + 14,
              paddingHorizontal: 22,
              paddingBottom: 18,
              minHeight: 270,
            },
      ]}
    >
      <Image source={HERO_PHOTO} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="heroShade" x1="0" y1="0" x2="0.09" y2="1">
            <Stop offset="0" stopColor={C.ink} stopOpacity={0.82} />
            <Stop offset="0.4" stopColor={C.ink} stopOpacity={0.36} />
            <Stop offset="0.78" stopColor={C.ink} stopOpacity={0.76} />
            <Stop offset="1" stopColor={C.ink} stopOpacity={0.93} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#heroShade)" />
      </Svg>

      {/* Rastro de huellas subiendo en diagonal */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <TrailPaw left="2%" top="78%" size={30} rotate={-16} delay={0} />
        <TrailPaw left="16%" top="64%" size={26} rotate={-4} delay={350} />
        <TrailPaw left="30%" top="51%" size={28} rotate={-20} delay={700} />
        <TrailPaw left="45%" top="39%" size={24} rotate={-6} delay={1050} />
        <TrailPaw left="60%" top="27%" size={27} rotate={-22} delay={1400} />
        <TrailPaw left="75%" top="15%" size={23} rotate={-8} delay={1750} />
      </View>

      <Animated.View entering={FadeInUp.duration(700)}>
        <Image
          source={LOGO_WHITE}
          style={{ height: logoH, width: logoH * LOGO_ASPECT }}
          resizeMode="contain"
        />
      </Animated.View>

      <Animated.View entering={FadeInUp.duration(700).delay(120)}>
        {isTablet ? (
          <View style={{ maxWidth: 460 }}>
            <Text style={styles.heroTitleWide}>Aquí las vacaciones también son suyas.</Text>
            <Text style={styles.heroSubWide}>
              Hospedaje, guardería y reportes con foto todos los días. Tú descansa: de las
              siestas nos encargamos nosotros.
            </Text>
          </View>
        ) : mode === "login" ? (
          <View>
            <Text style={styles.heroTitle}>Bienvenido al hotel de tu perro.</Text>
            <Text style={styles.heroSub}>
              Reserva su estancia, mira sus fotos y recógelo feliz.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={styles.heroTitle}>Únete a la manada.</Text>
            <Text style={styles.heroSub}>
              Reserva en un minuto. Presume las fotos el resto de la semana.
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// ── Pantalla principal ───────────────────────────────────────────

export function AuthScreen({ initialMode }: { initialMode: Mode }) {
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isTablet } = useResponsive();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("form");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errEmail, setErrEmail] = useState<string | null>(null);
  const [errPass, setErrPass] = useState<string | null>(null);
  const [shakeE, setShakeE] = useState(0);
  const [shakeP, setShakeP] = useState(0);

  const [reveal, setReveal] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  // Toggle animado Iniciar sesión / Crear cuenta
  const [toggleW, setToggleW] = useState(0);
  const thumbX = useSharedValue(initialMode === "login" ? 0 : 1);
  useEffect(() => {
    thumbX.value = withTiming(mode === "login" ? 0 : 1, {
      duration: 340,
      easing: Easing.bezier(0.4, 1.25, 0.4, 1),
    });
  }, [mode, thumbX]);
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value * Math.max(0, (toggleW - 8) / 2) }],
  }));

  const clearFieldErrors = () => {
    setError(null);
    setErrEmail(null);
    setErrPass(null);
  };

  const switchMode = (next: Mode) => {
    if (loading) return;
    setMode(next);
    setStep("form");
    setCode("");
    clearFieldErrors();
  };

  const validate = () => {
    let e: string | null = null;
    let p: string | null = null;
    const mail = email.trim();
    if (!mail) e = "Escribe tu correo para entrar.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail))
      e = "Ese correo no huele bien. Revísalo.";
    if (!password) p = "Falta la contraseña.";
    else if (mode === "signup" && password.length < 8)
      p = "Mínimo 8 caracteres — que ni el perro la adivine.";
    setErrEmail(e);
    setErrPass(p);
    if (e) setShakeE((v) => v + 1);
    if (p) setShakeP((v) => v + 1);
    return !e && !p;
  };

  const handleClerkError = (err: any) => {
    const clerkError = err?.errors?.[0];
    if (!clerkError) {
      setError("Algo salió mal. Intenta de nuevo.");
      return;
    }
    switch (clerkError.code) {
      case "form_password_incorrect":
        setErrPass("Contraseña incorrecta.");
        setShakeP((v) => v + 1);
        break;
      case "form_identifier_not_found":
        setErrEmail("No existe una cuenta con ese correo.");
        setShakeE((v) => v + 1);
        break;
      case "form_identifier_exists":
        setErrEmail("Ya existe una cuenta con ese correo.");
        setShakeE((v) => v + 1);
        break;
      case "form_password_pwned":
        setErrPass("Esa contraseña es demasiado común. Elige otra.");
        setShakeP((v) => v + 1);
        break;
      case "form_password_length_too_short":
        setErrPass("Mínimo 8 caracteres — que ni el perro la adivine.");
        setShakeP((v) => v + 1);
        break;
      case "form_code_incorrect":
      case "verification_failed":
        setError("Código incorrecto. Revisa tu correo e intenta de nuevo.");
        break;
      case "verification_expired":
        setError("El código expiró. Vuelve a empezar.");
        break;
      case "client_state_invalid":
        setError("Error de sesión. Por favor, intenta de nuevo.");
        break;
      default:
        setError(clerkError.longMessage ?? "Algo salió mal. Intenta de nuevo.");
    }
  };

  // ── Login con contraseña ───────────────────────────────────────
  const handleLogin = async () => {
    if (!signInLoaded) {
      setError("Cargando autenticación, intenta de nuevo en un momento.");
      return;
    }
    if (!validate()) return;

    setLoading(true);
    clearFieldErrors();
    try {
      const result = await signIn.create({
        identifier: email.trim().toLowerCase(),
        strategy: "password",
        password,
      });

      if (result.status === "complete") {
        await setActiveSignIn({ session: result.createdSessionId });
        router.replace("/(tabs)/home");
        return;
      }

      if (result.status === "needs_first_factor") {
        const firstFactor = await signIn.attemptFirstFactor({
          strategy: "password",
          password,
        });
        if (firstFactor.status === "complete") {
          await setActiveSignIn({ session: firstFactor.createdSessionId });
          router.replace("/(tabs)/home");
          return;
        }
      }

      if (result.status === "needs_second_factor") {
        await signIn.prepareSecondFactor({ strategy: "email_code" });
        setStep("loginCode");
        return;
      }

      setError("No se pudo completar el inicio de sesión. Intenta de nuevo.");
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginCode = async () => {
    if (!signInLoaded) return;
    if (!code.trim()) {
      setError("Ingresa el código de verificación.");
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
        await setActiveSignIn({ session: result.createdSessionId });
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

  const handleResendLoginCode = async () => {
    if (!signInLoaded) return;
    setLoading(true);
    setError(null);
    try {
      await signIn.prepareSecondFactor({ strategy: "email_code" });
      setError("Código reenviado a tu correo.");
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Registro ───────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!signUpLoaded) {
      setError("Cargando... intenta de nuevo en un momento.");
      return;
    }
    if (!firstName.trim()) {
      setError("Ingresa tu nombre.");
      return;
    }
    if (!lastName.trim()) {
      setError("Ingresa tu apellido.");
      return;
    }
    if (!validate()) return;

    setLoading(true);
    clearFieldErrors();
    const cleanFirstName = formatName(firstName);
    const cleanLastName = formatName(lastName);
    try {
      const createResult = await signUp.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        emailAddress: email.trim().toLowerCase(),
        password,
      });

      // Si el sign-up ya quedó completo (username deshabilitado), entramos directo.
      // El registro en BD lo crea/vincula el backend en el primer GET /users/me
      // (syncUser en el layout); no llamamos POST /users aquí.
      if ((createResult as any)._status === "complete") {
        if ((createResult as any).createdSessionId) {
          await setActiveSignUp({ session: (createResult as any).createdSessionId });
          router.replace("/(tabs)/home");
        }
        return;
      }

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("signupCode");
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySignup = async () => {
    if (!signUpLoaded) return;
    if (code.length < 6) {
      setError("Ingresa el código de 6 dígitos.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });

      if (result.status === "missing_requirements") {
        if ((result as any).missingFields?.includes("username")) {
          const generatedUsername =
            `${firstName.toLowerCase()}_${lastName.toLowerCase()}`.replace(/\s+/g, "");
          try {
            await signUp.update({ username: generatedUsername });
          } catch {
            setError("Error actualizando perfil. Intenta de nuevo.");
            return;
          }
        }
      }

      if (result.createdSessionId && result.createdUserId) {
        await setActiveSignUp({ session: result.createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("Error en la verificación. Intenta de nuevo.");
      }
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Recuperar contraseña ───────────────────────────────────────
  const handleForgot = async () => {
    if (!signInLoaded || loading) return;
    const mail = email.trim();
    if (!mail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
      setErrEmail("Escribe tu correo y te enviamos un código.");
      setShakeE((v) => v + 1);
      return;
    }
    setLoading(true);
    clearFieldErrors();
    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: mail.toLowerCase(),
      });
      setCode("");
      setNewPassword("");
      setStep("resetCode");
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!signInLoaded) return;
    if (!code.trim()) {
      setError("Ingresa el código que te enviamos.");
      return;
    }
    if (newPassword.length < 8) {
      setError("La nueva contraseña necesita mínimo 8 caracteres.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
        password: newPassword,
      });
      if (result.status === "complete") {
        await setActiveSignIn({ session: result.createdSessionId });
        router.replace("/(tabs)/home");
      } else {
        setError("No se pudo cambiar la contraseña. Intenta de nuevo.");
      }
    } catch (err: any) {
      handleClerkError(err);
    } finally {
      setLoading(false);
    }
  };

  // ── SSO ────────────────────────────────────────────────────────
  const handleSSO = useCallback(
    async (strategy: "oauth_google" | "oauth_apple") => {
      setLoading(true);
      setError(null);
      try {
        const { createdSessionId, setActive: setActiveSession } = await startSSOFlow({
          strategy,
        });
        if (createdSessionId && setActiveSession) {
          await setActiveSession({ session: createdSessionId });
          router.replace("/(tabs)/home");
        } else {
          setError(
            strategy === "oauth_google"
              ? "No se pudo completar el inicio con Google."
              : "No se pudo completar el inicio con Apple."
          );
        }
      } catch (err: any) {
        const msg = err?.errors?.[0]?.longMessage;
        setError(msg ?? "No se pudo iniciar sesión. Intenta de nuevo.");
      } finally {
        setLoading(false);
      }
    },
    [startSSOFlow, router]
  );

  const submit = mode === "login" ? handleLogin : handleRegister;
  const masked = !reveal && password.length > 0;
  const pawCount = Math.min(password.length, MAX_PAWS);

  const inputStyle = (name: string) => [
    styles.input,
    focused === name && styles.inputFocused,
  ];

  // ── Sub-vistas ─────────────────────────────────────────────────

  const errorBox = error ? (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle" size={16} color={C.error} />
      <Text style={styles.errorBoxText}>{error}</Text>
    </View>
  ) : null;

  const codeInput = (
    <View style={styles.field}>
      <Text style={styles.label}>Código de verificación</Text>
      <TextInput
        style={[...inputStyle("code"), styles.codeInput]}
        placeholder="000000"
        placeholderTextColor={C.placeholder}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        editable={!loading}
        onFocus={() => setFocused("code")}
        onBlur={() => setFocused(null)}
        testID="auth-login-code-input"
      />
    </View>
  );

  const ctaContent = (label: string) =>
    loading ? (
      <View style={styles.ctaLoading}>
        <View style={styles.ctaPaws}>
          <RunPaw delay={0} />
          <RunPaw delay={160} />
          <RunPaw delay={320} />
        </View>
        <Text style={styles.ctaText}>Abriendo la puerta…</Text>
      </View>
    ) : (
      <Text style={styles.ctaText}>{label}</Text>
    );

  const cta = (label: string, onPress: () => void, testID?: string) => (
    <Pressable
      onPress={onPress}
      disabled={loading}
      testID={testID}
      style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
    >
      {ctaContent(label)}
    </Pressable>
  );

  const codeHeader = (title: string, subtitle: React.ReactNode) => (
    <View style={styles.codeHeader}>
      <View style={styles.codeIconWrap}>
        <Ionicons name="mail-outline" size={26} color={C.ink} />
      </View>
      <Text style={styles.codeTitle}>{title}</Text>
      <Text style={styles.codeSub}>{subtitle}</Text>
    </View>
  );

  let formBody: React.ReactNode;

  if (step === "loginCode" || step === "signupCode") {
    const isSignupCode = step === "signupCode";
    formBody = (
      <View style={{ gap: 15 }}>
        {codeHeader(
          "Revisa tu correo",
          <>
            Enviamos un código de verificación a{" "}
            <Text style={{ fontFamily: F.bold, color: C.ink }}>{email}</Text>
          </>
        )}
        {errorBox}
        {codeInput}
        {cta(
          isSignupCode ? "Verificar y entrar" : "Verificar código",
          isSignupCode ? handleVerifySignup : handleLoginCode,
          isSignupCode ? "auth-register-verify-button" : "auth-login-verify-code-button"
        )}
        <View style={styles.linkRow}>
          {!isSignupCode && (
            <TouchableOpacity onPress={handleResendLoginCode} disabled={loading}>
              <Text style={styles.link}>Reenviar código</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              setStep("form");
              setCode("");
              setError(null);
            }}
          >
            <Text style={styles.link}>{isSignupCode ? "← Cambiar correo" : "Volver"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  } else if (step === "resetCode") {
    formBody = (
      <View style={{ gap: 15 }}>
        {codeHeader(
          "Recupera tu contraseña",
          <>
            Te enviamos un código a{" "}
            <Text style={{ fontFamily: F.bold, color: C.ink }}>{email}</Text>. Escríbelo y
            elige una contraseña nueva.
          </>
        )}
        {errorBox}
        {codeInput}
        <View style={styles.field}>
          <Text style={styles.label}>Nueva contraseña</Text>
          <TextInput
            style={inputStyle("newPass")}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={C.placeholder}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
            editable={!loading}
            onFocus={() => setFocused("newPass")}
            onBlur={() => setFocused(null)}
          />
        </View>
        {cta("Cambiar contraseña", handleReset)}
        <View style={[styles.linkRow, { justifyContent: "center" }]}>
          <TouchableOpacity
            onPress={() => {
              setStep("form");
              setCode("");
              setError(null);
            }}
          >
            <Text style={styles.link}>Volver</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  } else {
    formBody = (
      <View>
        {isTablet && (
          <Animated.View entering={FadeInUp.duration(600)} style={{ marginBottom: 2 }}>
            <Text style={styles.formTitle}>
              {mode === "login" ? "Bienvenido al hotel de tu perro." : "Únete a la manada."}
            </Text>
            <Text style={styles.formSub}>
              {mode === "login"
                ? "Reserva su estancia, mira sus fotos y recógelo feliz."
                : "Reserva en un minuto. Presume las fotos el resto de la semana."}
            </Text>
          </Animated.View>
        )}

        {/* Toggle Iniciar sesión / Crear cuenta */}
        <View
          style={styles.toggle}
          onLayout={(e) => setToggleW(e.nativeEvent.layout.width)}
        >
          {toggleW > 0 && (
            <Animated.View
              style={[styles.toggleThumb, { width: (toggleW - 8) / 2 }, thumbStyle]}
            />
          )}
          <Pressable style={styles.toggleBtn} onPress={() => switchMode("login")}>
            <Text style={[styles.toggleText, mode !== "login" && { opacity: 0.5 }]}>
              Iniciar sesión
            </Text>
          </Pressable>
          <Pressable
            style={styles.toggleBtn}
            onPress={() => switchMode("signup")}
            testID="auth-login-register-link"
          >
            <Text style={[styles.toggleText, mode !== "signup" && { opacity: 0.5 }]}>
              Crear cuenta
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: 15 }}>
          {errorBox}

          {mode === "signup" && (
            <View style={styles.nameRow}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Nombre</Text>
                <TextInput
                  style={inputStyle("nombre")}
                  placeholder="Juan"
                  placeholderTextColor={C.placeholder}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  editable={!loading}
                  onFocus={() => setFocused("nombre")}
                  onBlur={() => setFocused(null)}
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Apellido</Text>
                <TextInput
                  style={inputStyle("apellido")}
                  placeholder="Pérez"
                  placeholderTextColor={C.placeholder}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  editable={!loading}
                  onFocus={() => setFocused("apellido")}
                  onBlur={() => setFocused(null)}
                />
              </View>
            </View>
          )}

          <ShakeView trigger={shakeE}>
            <View style={styles.field}>
              <Text style={styles.label}>Correo</Text>
              <TextInput
                style={inputStyle("email")}
                placeholder="tu@email.com"
                placeholderTextColor={C.placeholder}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setErrEmail(null);
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                editable={!loading}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                testID="auth-login-email-input"
              />
              {errEmail && <Text style={styles.fieldError}>{errEmail}</Text>}
            </View>
          </ShakeView>

          <ShakeView trigger={shakeP}>
            <View style={styles.field}>
              <Text style={styles.label}>Contraseña</Text>
              <View>
                <TextInput
                  style={[
                    ...inputStyle("pass"),
                    { paddingRight: 54 },
                    masked && { color: "transparent" },
                  ]}
                  placeholder={mode === "login" ? "Tu contraseña" : "Mínimo 8 caracteres"}
                  placeholderTextColor={C.placeholder}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setErrPass(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  selectionColor={masked ? "transparent" : undefined}
                  autoComplete={mode === "login" ? "password" : "new-password"}
                  textContentType={mode === "login" ? "password" : "newPassword"}
                  editable={!loading}
                  onFocus={() => {
                    setFocused("pass");
                    setPassFocused(true);
                  }}
                  onBlur={() => {
                    setFocused(null);
                    setPassFocused(false);
                  }}
                  testID="auth-login-password-input"
                />
                {/* Huellitas en lugar de puntos */}
                {masked && (
                  <View style={styles.pawOverlay} pointerEvents="none">
                    {Array.from({ length: pawCount }, (_, i) => (
                      <Animated.View
                        key={i}
                        entering={ZoomIn.duration(220).springify()}
                        style={{
                          transform: [
                            { rotate: `${((i * 53) % 46) - 23}deg` },
                            { translateY: ((i * 31) % 5) - 2 },
                          ],
                        }}
                      >
                        <Ionicons name="paw" size={13} color={C.ink} />
                      </Animated.View>
                    ))}
                    {passFocused && <BlinkCaret />}
                  </View>
                )}
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setReveal((v) => !v)}
                  accessibilityLabel={reveal ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  <Ionicons
                    name={reveal ? "eye-off-outline" : "eye-outline"}
                    size={19}
                    color={C.eye}
                  />
                </TouchableOpacity>
              </View>
              {errPass && <Text style={styles.fieldError}>{errPass}</Text>}
              {mode === "login" && (
                <View style={{ alignItems: "flex-end", marginTop: 9 }}>
                  <TouchableOpacity onPress={handleForgot} disabled={loading}>
                    <Text style={styles.link}>¿Olvidaste tu contraseña?</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ShakeView>

          {cta(
            mode === "login" ? "Entrar" : "Crear mi cuenta",
            submit,
            mode === "login" ? "auth-login-submit-button" : "auth-register-submit-button"
          )}
        </View>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>O</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={{ gap: 11 }}>
          {Platform.OS === "ios" && (
            <Pressable
              onPress={() => handleSSO("oauth_apple")}
              disabled={loading}
              testID={
                mode === "login" ? "auth-login-apple-button" : "auth-register-apple-button"
              }
              style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="logo-apple" size={18} color={C.white} style={{ marginTop: -2 }} />
              <Text style={styles.appleText}>Continuar con Apple</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => handleSSO("oauth_google")}
            disabled={loading}
            testID="auth-login-google-button"
            style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
          >
            <GoogleLogo />
            <Text style={styles.googleText}>Continuar con Google</Text>
          </Pressable>
        </View>

        <Text style={styles.terms}>
          Al continuar aceptas los{" "}
          <Text style={styles.termsLink} onPress={() => router.push("/legal/tos" as any)}>
            Términos
          </Text>{" "}
          y la{" "}
          <Text
            style={styles.termsLink}
            onPress={() => router.push("/legal/privacy" as any)}
          >
            Política de privacidad
          </Text>
          .
        </Text>
      </View>
    );
  }

  const form = (
    <View style={{ width: "100%", maxWidth: isTablet ? 396 : undefined }}>{formBody}</View>
  );

  const testID = initialMode === "login" ? "auth-login-screen" : "auth-register-screen";

  return (
    <View style={styles.root} testID={testID}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {isTablet ? (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View style={{ flex: 44 }}>
              <HeroPanel isTablet mode={mode} />
            </View>
            <View style={{ flex: 56 }}>
              <ScrollView
                contentContainerStyle={{
                  flexGrow: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingTop: insets.top + 44,
                  paddingBottom: insets.bottom + 40,
                  paddingHorizontal: 28,
                }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {form}
              </ScrollView>
            </View>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <HeroPanel isTablet={false} mode={mode} />
            <View
              style={{
                flex: 1,
                paddingTop: 18,
                paddingHorizontal: 22,
                paddingBottom: insets.bottom + 16,
              }}
            >
              {form}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Estilos ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },

  hero: {
    backgroundColor: C.ink,
    overflow: "hidden",
    justifyContent: "space-between",
    gap: 14,
  },
  heroTitle: {
    fontFamily: F.display,
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: -0.8,
    color: C.white,
  },
  heroSub: {
    fontFamily: F.body,
    fontSize: 14,
    lineHeight: 21,
    color: "rgba(255,255,255,0.74)",
    marginTop: 8,
    maxWidth: 300,
  },
  heroTitleWide: {
    fontFamily: F.display,
    fontSize: 42,
    lineHeight: 45,
    letterSpacing: -1,
    color: C.white,
  },
  heroSubWide: {
    fontFamily: F.body,
    fontSize: 15,
    lineHeight: 23,
    color: "rgba(255,255,255,0.72)",
    marginTop: 16,
    maxWidth: 380,
  },

  formTitle: {
    fontFamily: F.display,
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: -1,
    color: C.ink,
  },
  formSub: {
    fontFamily: F.body,
    fontSize: 15,
    color: C.muted,
    marginTop: 10,
  },

  toggle: {
    flexDirection: "row",
    marginTop: 22,
    marginBottom: 20,
    padding: 4,
    borderRadius: 15,
    backgroundColor: C.sand,
    borderWidth: 1,
    borderColor: C.sandBorder,
  },
  toggleThumb: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 11,
    backgroundColor: C.white,
    shadowColor: C.ink,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  toggleText: {
    fontFamily: F.semibold,
    fontSize: 14.5,
    color: C.ink,
  },

  field: { gap: 7 },
  label: {
    fontFamily: F.semibold,
    fontSize: 12.5,
    color: C.inkSoft,
  },
  nameRow: { flexDirection: "row", gap: 12 },
  input: {
    height: 54,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
    fontFamily: F.body,
    fontSize: 15.5,
    color: C.ink,
  },
  inputFocused: {
    borderColor: C.focus,
  },
  codeInput: {
    fontFamily: F.bold,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
  },
  fieldError: {
    fontFamily: F.medium,
    fontSize: 12.5,
    color: C.error,
  },
  pawOverlay: {
    position: "absolute",
    left: 17,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  eyeBtn: {
    position: "absolute",
    right: 8,
    top: 7,
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  link: {
    fontFamily: F.semibold,
    fontSize: 12.5,
    color: C.link,
  },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },

  cta: {
    marginTop: 4,
    height: 56,
    borderRadius: 16,
    backgroundColor: C.orange,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.orange,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  ctaPressed: {
    backgroundColor: C.orangeDark,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  ctaText: {
    fontFamily: F.semibold,
    fontSize: 16,
    color: C.white,
    letterSpacing: -0.16,
  },
  ctaLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ctaPaws: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 22,
    marginBottom: 16,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.borderSoft },
  dividerText: {
    fontFamily: F.semibold,
    fontSize: 12,
    letterSpacing: 1.2,
    color: "#9AA7AC",
  },

  appleBtn: {
    height: 54,
    borderRadius: 15,
    backgroundColor: "#0A0A0A",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  appleText: {
    fontFamily: F.semibold,
    fontSize: 15,
    color: C.white,
  },
  googleBtn: {
    height: 54,
    borderRadius: 15,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleText: {
    fontFamily: F.semibold,
    fontSize: 15,
    color: C.ink,
  },

  terms: {
    fontFamily: F.body,
    fontSize: 12,
    lineHeight: 19,
    color: C.faint,
    textAlign: "center",
    marginTop: 16,
  },
  termsLink: {
    fontFamily: F.semibold,
    color: C.link,
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(192,57,43,0.07)",
    borderWidth: 1,
    borderColor: "rgba(192,57,43,0.22)",
    borderRadius: 12,
    padding: 12,
  },
  errorBoxText: {
    flex: 1,
    fontFamily: F.medium,
    fontSize: 13.5,
    color: C.error,
  },

  codeHeader: {
    alignItems: "center",
    marginBottom: 4,
  },
  codeIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: C.sand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  codeTitle: {
    fontFamily: F.display,
    fontSize: 26,
    letterSpacing: -0.6,
    color: C.ink,
  },
  codeSub: {
    fontFamily: F.body,
    fontSize: 14,
    lineHeight: 21,
    color: C.muted,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 300,
  },
});
