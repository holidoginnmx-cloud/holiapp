import { COLORS } from "@/constants/colors";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
// Puente AppState → focusManager de React Query. Import por efecto de módulo:
// sin él `refetchOnWindowFocus` no hace nada en React Native.
import "@/lib/queryFocus";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, InteractionManager, StyleSheet } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Baloo2_800ExtraBold } from "@expo-google-fonts/baloo-2";
import { Pacifico_400Regular } from "@expo-google-fonts/pacifico";
import { Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useAuthStore } from "@/store/authStore";
import { clearSessionState } from "@/lib/session";
import { DevRoleSwitcher } from "@/components/DevRoleSwitcher";
import { AnimatedSplash } from "@/components/splash";
import { registerForPushNotifications } from "@/lib/pushNotifications";
import * as Notifications from "expo-notifications";
import { getMyLegalStatus } from "@/lib/api";
import {
  notificationRoute,
  type NotificationRouteData,
} from "@/lib/notificationRoute";
import { notificationInvalidationKeys } from "@/lib/notificationInvalidate";
import { applyIfSafe, checkAndFetch } from "@/lib/appUpdates";
import {
  recoverPendingConfirmation,
  reservationIdOf,
} from "@/lib/pendingConfirmation";
import { invalidateReservationScope } from "@/lib/invalidateReservations";

// Mantiene visible el splash NATIVO (blanco) hasta que las fuentes estén
// cargadas; así el relevo al splash animado no muestra un parpadeo.
SplashScreen.preventAutoHideAsync().catch(() => {});

const TOUR_SEEN_KEY = "welcome-tour-seen";
const CLAIM_SEEN_KEY = "welcome-claim-seen";

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
  const pushRegisteredRef = useRef(false);

  useEffect(() => {
    setTokenResolver(getToken);
  }, [getToken]);

  // Keep-fresh del JWT de Clerk: el token expira ~60s y si un tap cae cerca de
  // la expiración, apiFetch paga un viaje de red a Clerk EN SERIE antes del
  // request real (taps que "aleatoriamente" tardan 300-500ms más). El interval
  // usa skipCache: SIN él, getToken() a los 40s devuelve el token cacheado (aún
  // válido) sin renovarlo, expira a los 60s y los requests del segundo 60-80
  // pagan el refresh completo — medido: ráfagas de token=1000-1400ms.
  useEffect(() => {
    if (!isSignedIn) return;

    // Mint proactivo de un token nuevo (interval): nadie más paga el refresh.
    const forceRefresh = () => {
      getToken({ skipCache: true }).catch(() => {});
    };
    // Refresh normal (arranque / volver de background): si el caché ya expiró,
    // getToken refresca solo; si sigue válido, no hay red.
    const refresh = () => {
      getToken().catch(() => {});
    };

    refresh();
    let interval: ReturnType<typeof setInterval> | null = setInterval(forceRefresh, 40_000);

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // Primer tap tras reabrir la app: que no pague el refresh.
        refresh();
        if (!interval) interval = setInterval(forceRefresh, 40_000);
        // Si /users/me se agotó (Railway dormido, sin red), volver a la app es
        // el momento natural de reintentar; el store dedupe si ya hay uno en
        // vuelo y su backoff largo no dispara en segundo plano.
        if (useAuthStore.getState().syncStatus === "failed") {
          void useAuthStore.getState().syncUser();
        }
      } else if (interval) {
        clearInterval(interval);
        interval = null;
      }
    });

    return () => {
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [isSignedIn, getToken]);

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

  // Gate de onboarding del OWNER, en orden: (1) "¿Ya eres cliente?" para
  // vincular una cuenta preexistente y no duplicar mascotas, (2) consentimientos
  // legales, (3) tour de bienvenida. STAFF/ADMIN entran al dashboard interno y
  // no pasan por aquí. Mientras el usuario está en una de esas pantallas
  // (welcome/legal) rearmamos el gate para reevaluar el siguiente paso cuando
  // salga; fuera de ellas corre una sola vez para evitar redirects spurios al
  // navegar a un detalle (reservation, pet, etc).
  const onboardingCheckedRef = useRef(false);
  useEffect(() => {
    if (!isSignedIn || !dbUserId || role !== "OWNER") {
      onboardingCheckedRef.current = false;
      return;
    }
    const inLegal = segments[0] === "legal";
    const inAuth = segments[0] === "(auth)";
    const inWelcome = segments[0] === "welcome";
    if (inLegal || inAuth || inWelcome) {
      onboardingCheckedRef.current = false;
      return;
    }
    if (onboardingCheckedRef.current) return;
    onboardingCheckedRef.current = true;

    (async () => {
      // La marca es POR USUARIO (no por dispositivo): así una cuenta nueva en
      // el mismo teléfono sí evalúa el claim, y no se hereda el "visto" de otra
      // sesión (el logout no limpia SecureStore).
      const claimSeen = await SecureStore.getItemAsync(
        `${CLAIM_SEEN_KEY}-${dbUserId}`
      ).catch(() => null);
      if (!claimSeen) {
        router.replace("/welcome/claim" as any);
        return;
      }
      const status = await getMyLegalStatus();
      if (!status.canBook) {
        router.replace("/legal/onboarding");
        return;
      }
      const tourSeen = await SecureStore.getItemAsync(TOUR_SEEN_KEY).catch(() => null);
      if (!tourSeen) {
        router.replace("/welcome/tour" as any);
      }
    })().catch((err) => {
      if (__DEV__) console.error("[onboarding] gate failed:", err);
      onboardingCheckedRef.current = false; // permite reintentar en siguiente nav
    });
  }, [isSignedIn, dbUserId, role, segments, router]);

  // Clear store on sign-out so the next user starts with a clean slate.
  // Incluye la caché de react-query: con staleTime de 5 min y refetchOnMount
  // en false, la cuenta siguiente abría con los datos de la anterior.
  useEffect(() => {
    if (isSignedIn === false) {
      clearSessionState();
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

/**
 * Deep link al tocar una notificación PUSH. Espejo exacto del tap in-app de
 * (tabs)/notifications.tsx: ambos resuelven la pantalla con
 * lib/notificationRoute (cartilla/vacunas → renovar cartilla, reserva → detalle…).
 *
 * Dos cosas que NO hay que simplificar:
 *
 * 1. `useLastNotificationResponse` en vez de sólo el listener: cuando la app
 *    estaba CERRADA, el tap ocurre antes de que este componente monte, así que
 *    el listener no lo ve. El hook sí devuelve la respuesta que abrió la app.
 *    Se conserva además el listener para el caso de app en background/foreground.
 *
 * 2. La navegación se DIFIERE hasta que la app se estabilizó (sesión cargada,
 *    rol conocido y ya estamos dentro de (tabs)/(admin)/(staff)). En arranque
 *    frío la app pasa por index → (auth)/login → replace a home y, si role es
 *    ADMIN/STAFF, otro replace a su dashboard: cualquier push() lanzado antes
 *    quedaba borrado por esos replace y el usuario terminaba "sólo en el inicio".
 */
function PushNavigationHandler() {
  const router = useRouter();
  const segments = useSegments();
  const { isSignedIn, isLoaded } = useAuth();
  const role = useAuthStore((s) => s.role);
  const lastResponse = Notifications.useLastNotificationResponse();

  // Se guarda el CONTENIDO de la notificación, no la ruta ya resuelta: la
  // pantalla destino depende del rol, y en arranque frío el tap ocurre cuando
  // `role` todavía es null. Resolverla aquí mandaba a un admin a la vista de
  // cliente. Se resuelve abajo, en el effect que ya espera a tener rol.
  const [pending, setPending] = useState<{
    type: string;
    data: NotificationRouteData;
  } | null>(null);
  // Evita re-navegar a la misma notificación (el hook conserva su valor entre
  // re-renders y el listener puede emitir la misma respuesta).
  const handledRef = useRef<string | null>(null);

  const enqueue = useCallback((response: Notifications.NotificationResponse) => {
    const request = response.notification.request;
    const key = `${request.identifier}:${response.actionIdentifier}`;
    if (handledRef.current === key) return;
    handledRef.current = key;
    const type =
      typeof request.content.data?.type === "string"
        ? (request.content.data.type as string)
        : "";
    if (__DEV__) {
      console.log("[push] tap →", JSON.stringify(request.content.data));
    }
    const data = (request.content.data ?? null) as NotificationRouteData;
    // El push que LLEGÓ con la app en background/cerrada no pasó por
    // PushCacheInvalidator (solo escucha en primer plano): al tocarlo se
    // invalidan aquí las mismas keys, para que la pantalla destino (p. ej. el
    // perro con la cartilla recién aprobada) no muestre la caché de 5 min.
    for (const queryKey of notificationInvalidationKeys(type, data)) {
      queryClient.invalidateQueries({ queryKey });
    }
    setPending({ type, data });
    // Limpia la respuesta cacheada para que un relanzamiento normal de la app
    // (sin tap) no vuelva a navegar a la misma pantalla.
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // no-op: en versiones donde no exista, el handledRef ya evita repetir.
    }
  }, []);

  useEffect(() => {
    if (lastResponse) enqueue(lastResponse);
  }, [lastResponse, enqueue]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(enqueue);
    return () => sub.remove();
  }, [enqueue]);

  useEffect(() => {
    if (!pending) return;
    if (!isLoaded || !isSignedIn || !role) return;
    // Aún en el arranque/onboarding: esperamos a caer en el área principal.
    const root = segments[0];
    if (root !== "(tabs)" && root !== "(admin)" && root !== "(staff)") return;

    // Ya hay rol: recién ahora se sabe a qué pantalla lleva la notificación.
    const route = notificationRoute(pending.type, pending.data, role);
    setPending(null);
    if (!route) return;
    // Deja terminar la navegación en curso antes de empujar la pantalla.
    InteractionManager.runAfterInteractions(() => {
      router.push(route as any);
    });
  }, [pending, isLoaded, isSignedIn, role, segments, router]);

  return null;
}

/**
 * Refresca la caché cuando LLEGA un push, sin esperar a que nadie lo toque.
 *
 * Componente aparte de PushNavigationHandler a propósito: ése tiene una máquina
 * de estados delicada (pending / handledRef / espera de rol) que resuelve el
 * "usuario terminaba sólo en el inicio" en arranque frío, y no conviene meterle
 * responsabilidades nuevas. Aquí solo se escucha y se invalida.
 *
 * `addNotificationReceivedListener` dispara únicamente con la app en PRIMER
 * PLANO — que es exactamente el hueco que no cubren el puente de AppState
 * (lib/queryFocus.ts) ni el refetch por foco de pantalla (useRefetchOnFocus).
 */
function PushCacheInvalidator() {
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      const data = (content.data ?? null) as NotificationRouteData;
      const type = typeof content.data?.type === "string" ? content.data.type : "";
      const keys = notificationInvalidationKeys(type, data);
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey });
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}

/**
 * Cobro hecho, confirmación pendiente: la termina al arrancar.
 *
 * Si la app se cerró (o murió) entre el "paid" de Stripe y el POST que crea la
 * reserva, quedó un registro guardado (lib/pendingConfirmation). Aquí se
 * reenvía UNA vez por arranque, en segundo plano, y solo si es del usuario que
 * tiene la sesión abierta. Si sale, se refrescan las reservas y se avisa; si
 * vuelve a fallar, se queda guardado y no se molesta a nadie: la pantalla del
 * flujo y el siguiente arranque lo vuelven a intentar.
 */
function PendingConfirmationRecovery() {
  const { isSignedIn } = useAuth();
  const dbUserId = useAuthStore((s) => s.dbUserId);

  useEffect(() => {
    if (!isSignedIn || !dbUserId) return;
    void (async () => {
      const record = await recoverPendingConfirmation(dbUserId);
      if (!record) return;
      invalidateReservationScope(queryClient, reservationIdOf(record));
      const isNewBooking =
        record.flow === "multi" || record.flow === "bath" || record.flow === "daycare";
      Alert.alert(
        isNewBooking ? "Tu reservación quedó confirmada" : "Tu pago quedó registrado",
        isNewBooking
          ? "Tu pago se recibió y la reservación que quedó pendiente ya está confirmada."
          : "El pago que quedó pendiente ya quedó registrado en tu reservación.",
      );
    })().catch(() => {
      // Nunca romper el arranque por esto: se reintenta en la próxima apertura.
    });
  }, [isSignedIn, dbUserId]);

  return null;
}

/**
 * Aplica las actualizaciones por aire sin esperar a que el cliente mate la app.
 *
 * Sin esto, un `eas update` solo entra en el siguiente arranque en frío: un
 * arreglo urgente puede tardar días en llegarle a quien deja la app abierta en
 * segundo plano. La recarga solo ocurre al volver de un rato largo fuera y
 * nunca con un cobro en curso, así que se siente igual que abrir la app.
 */
function OtaUpdater() {
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    // Al arrancar ya se descarga lo que haya, para que esté listo la próxima vez.
    void checkAndFetch();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        void (async () => {
          const hasUpdate = await checkAndFetch();
          if (!hasUpdate || since === null) return;
          await applyIfSafe(Date.now() - since);
        })();
      } else if (state === "background") {
        backgroundedAt.current = Date.now();
      }
    });

    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

  // Fuentes del logotipo. Mientras cargan, seguimos mostrando el splash nativo.
  const [fontsLoaded] = useFonts({
    Baloo2_800ExtraBold,
    Pacifico_400Regular,
    Outfit_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <ClerkTokenSync />
        <OtaUpdater />
        <PushNavigationHandler />
        <PushCacheInvalidator />
        <PendingConfirmationRecovery />
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
          {/* NOTA: aquí vivía `review/[reservationId]`, una pantalla completa
              de reseña a la que nadie navegaba (tercera copia del formulario).
              La reseña se captura en `ReviewPromptModal`: desde el Inicio
              (GlobalReviewPrompt) o desde el detalle de la reservación. */}
        </Stack>
        <DevRoleSwitcher />
        <SplashGate />
      </QueryClientProvider>
      </ClerkProvider>
    </SafeAreaProvider>
  );
}
