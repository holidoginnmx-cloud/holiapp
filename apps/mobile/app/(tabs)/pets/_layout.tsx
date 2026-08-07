import { TabStack } from "@/components/TabStack";
import { CreditBalancePill } from "@/components/CreditBalancePill";

export default function PetsTabLayout() {
  return <TabStack title="Mis Mascotas" headerRight={() => <CreditBalancePill />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
