import { View, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/colors";
import { TabStack } from "@/components/TabStack";
import { CreditBalancePill } from "@/components/CreditBalancePill";

export default function HomeTabLayout() {
  const router = useRouter();

  return (
    <TabStack
      title="Inicio"
      headerRight={() => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginRight: 16 }}>
          <CreditBalancePill />
          <TouchableOpacity
            onPress={() => router.push("/profile/account")}
            testID="tabs-account-button"
          >
            <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      )}
    />
  );
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
