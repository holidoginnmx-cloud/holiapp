import { useLocalSearchParams } from "expo-router";
import { EditBathAppointmentScreen } from "@/components/EditBathAppointmentScreen";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Wrapper de ruta: la pantalla vive en components/ porque el stack de staff
// (staff/bath/edit-appointment) registra exactamente la misma.
export default function AdminEditAppointmentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditBathAppointmentScreen id={id!} />;
}
