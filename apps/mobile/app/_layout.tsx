import { COLORS } from "@/constants/colors";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { InteractionManager, StyleSheet } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Baloo2_800ExtraBold } from "@expo-google-fonts/baloo-2";
import { Pacifico_400Regular } from "@expo-google-fonts/pacifico";
import { useAuthStore } from "@/store/authStore";
import { DevRoleSwitcher } from "@/components/DevRoleSwitcher";
import { AnimatedSplash } from "@/components/splash";
import { registerForPushNotifications } from "@/lib/pushNotifications";
import { getMyLegalStatus } from "@/lib/api";

// Mantiene visible el splash NATIVO (blanco) hasta que las fuentes estén
// cargadas; así el relevo al splash animado no muestra un parpadeo.
SplashScreen.preventAutoHideAsync().catch(() => {});

const TOUR_SEEN_KEY = "welcome-tour-seen";

// tokenCache endurecido: si SecureStore falla (Keychain inaccesible, valor
// corrupto, etc.) NO debe romper la inicialización de Clerk — devolvemos null
// y dejamos que el SDK cree un cliente nuevo.
const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, token: string) {
    try {
      return await SecureStore.setItemAsync(key, token);
    } catch {
      return undefined;
    }
  },
  async clearToken(key: string) {
    try {
      return await SecureStore.deleteItemAsync(key);
    } catch {
      return undefined;
    }
  },
};

function ClerkTokenSync() {
  const { getToken, userId, isSignedIn } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const role = useAuthStore((s) => s.role);
  const dbUserId = useAuthStore((s) => s.dbUserId);
  const setTokenResolver = useAuthStore((s) => s.setTokenResolver);
  const setClerkUserId = useAuthStore((s) => s.setClerkUserId);
  const syncUser = useAuthStore((s) => s.syncUser);
  const logout = useAuthStore((s) => s.logout);
  const pushRegisteredRef = useRef(false);

  useEffect(() => {
    setTokenResolver(getToken);
  }, [getToken]);

  useEffect(() => {
    setClerkUserId(userId ?? null);
  }, [userId]);

  // Sync DB user when signed in and token is ready
  useEffect(() => {
    if (isSignedIn && userId) {
      syncUser();
      // Registro de push diferido tras las interacciones para no tocar el
      // TurboModule de expo-notifications durante el primer commit de render
      // (causa del crash del build 15). Solo una vez por sesión.
      if (!pushRegisteredRef.current) {
        pushRegisteredRef.current = true;
        InteractionManager.runAfterInteractions(() => {
          registerForPushNotifications().catch((err) => {
            if (__DEV__) console.error("[push] Error registrando token:", err);
          });
        });
      }
    }
  }, [isSignedIn, userId]);

  // Gate de consentimientos legales: solo aplica a OWNER. STAFF/ADMIN entran
  // al dashboard interno y no pasan por el flujo de reserva.
  // Solo corre una vez por sign-in del OWNER. No reactivar en cada navegación
  // o causaría redirects spurios a /legal/onboarding → home cuando el owner
  // navega a un detalle (reservation, pet, etc).
  const legalCheckedRef = useRef(false);
  useEffect(() => {
    if (!isSignedIn || !dbUserId || role !== "OWNER") {
      legalCheckedRef.current = false;
      return;
    }
    if (legalCheckedRef.current) return;
    // No redirigir si ya estamos en legal, auth o welcome
    const inLegal = segments[0] === "legal";
    const inAuth = segments[0] === "(auth)";
    const inWelcome = segments[0] === "welcome";
    if (inLegal || inAuth || inWelcome) return;

    legalCheckedRef.current = true;
    getMyLegalStatus()
      .then(async (status) => {
        if (!status.canBook) {
          router.replace("/legal/onboarding");
          return;
        }
        const seen = await SecureStore.getItemAsync(TOUR_SEEN_KEY).catch(() => null);
        if (!seen) {
          router.replace("/welcome/tour" as any);
        }
      })
      .catch((err) => {
        if (__DEV__) console.error("[legal] status check failed:", err);
        legalCheckedRef.current = false; // permite reintentar en siguiente nav
      });
  }, [isSignedIn, dbUserId, role, segments]);

  // Clear store on sign-out so the next user starts with a clean slate
  useEffect(() => {
    if (isSignedIn === false) {
      logout();
      pushRegisteredRef.current = false;
    }
  }, [isSignedIn]);

  return null;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

/**
 * Overlay del splash animado. Se desmonta (con fade-out) cuando la animación
 * terminó Y Clerk resolvió la sesión (isLoaded) — así sabemos a qué pantalla
 * entrar sin parpadeos.
 *
 * Redes de seguridad (evitan que un fallo deje la app colgada en el splash):
 *   - `authTimedOut` (6s): si `isLoaded` tarda demasiado, igual ocultamos en
 *     cuanto la animación termine; el router/(auth)/_layout decide la pantalla.
 *   - `hardTimedOut` (8s): tope absoluto — oculta el splash aunque la animación
 *     nativa (Reanimated/SVG, nueva) no haya disparado onAnimationComplete.
 *
 * IMPORTANTE: `onAnimationComplete` se memoiza con useCallback. Si se pasara una
 * función nueva en cada render, AnimatedSplash reiniciaría su animación en cada
 * re-render (p.ej. cuando Clerk resuelve), congelando el splash. No lo cambies.
 *
 * Debe renderizarse dentro de <ClerkProvider> para poder leer useAuth().
 */
function SplashGate() {
  const { isLoaded } = useAuth();
  const [animationDone, setAnimationDone] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const [hardTimedOut, setHardTimedOut] = useState(false);
  const [visible, setVisible] = useState(true);

  const handleAnimationComplete = useCallback(() => setAnimationDone(true), []);

  useEffect(() => {
    const authTimer = setTimeout(() => setAuthTimedOut(true), 6000);
    const hardTimer = setTimeout(() => setHardTimedOut(true), 8000);
    return () => {
      clearTimeout(authTimer);
      clearTimeout(hardTimer);
    };
  }, []);

  useEffect(() => {
    if ((animationDone && (isLoaded || authTimedOut)) || hardTimedOut) {
      setVisible(false);
    }
  }, [animationDone, isLoaded, authTimedOut, hardTimedOut]);

  if (!visible) return null;

  return (
    <Animated.View style={StyleSheet.absoluteFill} exiting={FadeOut.duration(350)}>
      <AnimatedSplash onAnimationComplete={handleAnimationComplete} />
    </Animated.View>
  );
}

export default function RootLayout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

  // Fuentes del logotipo. Mientras cargan, seguimos mostrando el splash nativo.
  const [fontsLoaded] = useFonts({ Baloo2_800ExtraBold, Pacifico_400Regular });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <ClerkTokenSync />
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            animationTypeForReplace: "pop",
          }}
        >
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(admin)" />
          <Stack.Screen name="(staff)" />
          <Stack.Screen name="pet" />
          <Stack.Screen name="reservation" />
          <Stack.Screen name="legal" />
          <Stack.Screen name="welcome" />
          <Stack.Screen
            name="review/[reservationId]"
            options={{
              headerShown: true,
              title: "Dejar reseña",
              headerTintColor: COLORS.primary,
            }}
          />
        </Stack>
        <DevRoleSwitcher />
        <SplashGate />
      </QueryClientProvider>
    </ClerkProvider>
  );
}
