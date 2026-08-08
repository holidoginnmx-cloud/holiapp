import { useAuthStore } from "@/store/authStore";
import { queryClient } from "@/lib/queryClient";

/**
 * Borra TODO lo que sobrevive de la sesión anterior: el store de auth (userId,
 * nombre, correo y sobre todo el ROL) y la caché de react-query.
 *
 * Lo segundo importa tanto como lo primero: el queryClient guarda 5 minutos de
 * datos frescos y no refetchea al montar, así que sin limpiarlo la cuenta nueva
 * abre la app con las mascotas, los avisos y el crédito de la anterior.
 *
 * El rol es el que causaba el salto de área: si sobrevive al cambio de cuenta,
 * el guard de (staff)/_layout ve un rol que no es STAFF al volver de cualquier
 * pantalla y te manda al área de owner.
 */
export function clearSessionState() {
  useAuthStore.getState().logout();
  queryClient.clear();
}
