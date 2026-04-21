import { COLORS } from "@/constants/colors";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { DevRoleSwitcher } from "@/components/DevRoleSwitcher";
import { StripeProvider } from "@stripe/stripe-react-native";
import { registerForPushNotifications } from "@/lib/pushNotifications";
import { getMyLegalStatus } from "@/lib/api";

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, token: string) {
    return SecureStore.setItemAsync(key, token);
  },
  async clearToken(key: string) {
    return SecureStore.deleteItemAsync(key);
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

  useEffect(() => {
    setTokenResolver(getToken);
  }, [getToken]);

  useEffect(() => {
    setClerkUserId(userId ?? null);
  }, [userId]);

  // Sync DB user when signed in and token is ready
  useEffect(() => {
    console.log("🔄 [ClerkTokenSync] isSignedIn:", isSignedIn, "userId:", userId);
    if (isSignedIn && userId) {
      console.log("🔄 [ClerkTokenSync] Calling syncUser...");
      syncUser();
      // Registrar push token con el backend (best-effort, no bloquea)
      registerForPushNotifications().catch((err) => {
        console.error("[push] Error registrando token:", err);
      });
    }
  }, [isSignedIn, userId]);

  // Gate de consentimientos legales: solo aplica a OWNER. STAFF/ADMIN entran
  // al dashboard interno y no pasan por el flujo de reserva.
  useEffect(() => {
    if (!isSignedIn || !dbUserId || role !== "OWNER") return;
    // No redirigir si ya estamos en legal o auth
    const inLegal = segments[0] === "legal";
    const inAuth = segments[0] === "(auth)";
    if (inLegal || inAuth) return;

    getMyLegalStatus()
      .then((status) => {
        if (!status.canBook) {
          router.replace("/legal/onboarding");
        }
      })
      .catch((err) => {
        console.error("[legal] status check failed:", err);
      });
  }, [isSignedIn, dbUserId, role, segments]);

  // Clear store on sign-out so the next user starts with a clean slate
  useEffect(() => {
    if (isSignedIn === false) {
      logout();
    }
  }, [isSignedIn]);

  return null;
}

export default function RootLayout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}>
      <QueryClientProvider client={queryClient}>
        <ClerkTokenSync />
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(admin)" />
          <Stack.Screen name="(staff)" />
          <Stack.Screen name="pet" />
          <Stack.Screen name="reservation" />
          <Stack.Screen name="legal" />
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
      </QueryClientProvider>
      </StripeProvider>
    </ClerkProvider>
  );
}
