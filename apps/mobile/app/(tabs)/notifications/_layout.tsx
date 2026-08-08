import { TabStack } from "@/components/TabStack";
import { OwnerHeaderRight } from "@/components/HeaderProfileButton";

export default function NotificationsTabLayout() {
  return <TabStack title="Notificaciones" headerRight={() => <OwnerHeaderRight />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
