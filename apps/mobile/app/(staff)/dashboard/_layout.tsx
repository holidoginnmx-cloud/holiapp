import { useRouter } from "expo-router";
import { TabStack } from "@/components/TabStack";
import { HeaderProfileButton } from "@/components/HeaderProfileButton";

export default function StaffDashboardTabLayout() {
  const router = useRouter();

  return (
    <TabStack
      title="Panel"
      headerRight={() => (
        <HeaderProfileButton
          onPress={() => router.push("/(staff)/more/profile" as any)}
          testID="staff-account-button"
        />
      )}
    />
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
