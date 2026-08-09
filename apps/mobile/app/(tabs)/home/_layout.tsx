import { TabStack } from "@/components/TabStack";
import { OwnerHeaderRight } from "@/components/HeaderProfileButton";

export default function HomeTabLayout() {
  return <TabStack title="Inicio" headerRight={() => <OwnerHeaderRight />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
