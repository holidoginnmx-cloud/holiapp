import { TabStack } from "@/components/TabStack";
import { CreditBalancePill } from "@/components/CreditBalancePill";

export default function ReservationsTabLayout() {
  return <TabStack title="Reservaciones" headerRight={() => <CreditBalancePill />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
