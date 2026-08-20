import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";

/**
 * "Atrás" de las pantallas del stack `/admin` que también usa el staff (crear
 * reserva, alta de cliente/mascota, agregar servicio).
 *
 * Sin historial que hacer pop —deep link, o el flujo se abrió con `replace`—
 * hay que aterrizar en algún lado, y el destino no puede ser una pestaña del
 * admin: el guard de `(admin)/_layout` expulsa a quien no sea ADMIN a
 * `/(tabs)/home`, que es la app del CLIENTE. Un staff terminaba viendo "Mis
 * mascotas" en vez de su panel.
 */
export function useTeamBack(adminFallback: string) {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);

  return () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(
      (role === "STAFF" ? "/(staff)/dashboard" : adminFallback) as any,
    );
  };
}
