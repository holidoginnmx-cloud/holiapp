import { useLocalSearchParams } from "expo-router";
import { EditStayTimesScreen } from "@/components/EditStayTimesScreen";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

// Wrapper de ruta: la misma pantalla que registra el stack de staff
// (staff/stay/edit-times).
export default function AdminEditStayTimesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditStayTimesScreen id={id!} />;
}
