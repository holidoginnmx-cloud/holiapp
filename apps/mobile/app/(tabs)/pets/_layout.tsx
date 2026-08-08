import { TabStack } from "@/components/TabStack";
import { OwnerHeaderRight } from "@/components/HeaderProfileButton";

export default function PetsTabLayout() {
  return <TabStack title="Mis Mascotas" headerRight={() => <OwnerHeaderRight />} />;
}

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";
