import { useLocalSearchParams } from "expo-router";
import { EditDaycareScheduleScreen } from "@/components/EditDaycareScheduleScreen";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Wrapper de ruta: la pantalla vive en components/ porque el stack de staff
// (staff/daycare/edit-schedule) registra exactamente la misma.
export default function AdminEditDaycareScheduleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditDaycareScheduleScreen id={id!} />;
}
