import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { TabStack } from "@/components/TabStack";
import { HeaderProfileButton } from "@/components/HeaderProfileButton";
import { HeaderBellButton } from "@/components/HeaderBellButton";

export default function AdminDashboardTabLayout() {
  const router = useRouter();

  return (
    <TabStack
      title="Panel"
      headerRight={() => (
        <View style={styles.row}>
          <HeaderBellButton
            onPress={() => router.push("/admin/notifications" as any)}
            testID="admin-notifications-button"
          />
          <HeaderProfileButton
            onPress={() => router.push("/admin/account" as any)}
            testID="admin-account-button"
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
