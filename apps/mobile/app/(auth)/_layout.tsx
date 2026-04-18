import { Stack, useRouter, useSegments } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { useEffect } from "react";

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    // Only redirect if user is actually on an auth screen
    if (isLoaded && isSignedIn && segments[0] === "(auth)") {
      router.replace("/(tabs)/home");
    }
  }, [isLoaded, isSignedIn, segments]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
