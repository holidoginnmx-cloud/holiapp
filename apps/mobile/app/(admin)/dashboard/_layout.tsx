import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import { TabStack } from "@/components/TabStack";

export default function AdminDashboardTabLayout() {
  const router = useRouter();

  return (
    <TabStack
      title="Panel"
      headerRight={() => (
        <TouchableOpacity
          onPress={() => router.push("/admin/account" as any)}
          style={{ marginRight: 16 }}
          testID="admin-account-button"
        >
          <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
        </TouchableOpacity>
      )}
    />
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
