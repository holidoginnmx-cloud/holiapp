import { TabStack } from "@/components/TabStack";
import { OwnerHeaderRight } from "@/components/HeaderProfileButton";

export default function ReservationsTabLayout() {
  return <TabStack title="Reservaciones" headerRight={() => <OwnerHeaderRight />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
