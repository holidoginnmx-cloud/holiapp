import { useLocalSearchParams } from "expo-router";
import { EditBathAppointmentScreen } from "@/components/EditBathAppointmentScreen";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Wrapper de ruta: la misma pantalla que registra el stack de admin
// (admin/reservation/edit-appointment).
export default function StaffEditAppointmentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditBathAppointmentScreen id={id!} />;
}
