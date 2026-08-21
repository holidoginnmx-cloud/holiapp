import { useLocalSearchParams } from "expo-router";
import { EditDaycareScheduleScreen } from "@/components/EditDaycareScheduleScreen";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Wrapper de ruta: la misma pantalla que registra el stack de admin
// (admin/reservation/edit-daycare-schedule).
export default function StaffEditDaycareScheduleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditDaycareScheduleScreen id={id!} />;
}
