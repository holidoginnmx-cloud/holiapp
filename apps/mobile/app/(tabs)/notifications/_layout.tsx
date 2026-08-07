import { TabStack } from "@/components/TabStack";
import { CreditBalancePill } from "@/components/CreditBalancePill";

export default function NotificationsTabLayout() {
  return <TabStack title="Notificaciones" headerRight={() => <CreditBalancePill />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
