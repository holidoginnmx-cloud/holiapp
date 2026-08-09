import { useRouter } from "expo-router";
import { TabStack } from "@/components/TabStack";
import { HeaderProfileButton } from "@/components/HeaderProfileButton";

export default function AdminDashboardTabLayout() {
  const router = useRouter();

  return (
    <TabStack
      title="Panel"
      headerRight={() => (
        <HeaderProfileButton
          onPress={() => router.push("/admin/account" as any)}
          testID="admin-account-button"
        />
      )}
    />
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
