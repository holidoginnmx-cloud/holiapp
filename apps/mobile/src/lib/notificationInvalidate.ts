import type { QueryKey } from "@tanstack/react-query";
import type { NotificationRouteData } from "./notificationRoute";

/**
 * Qué hay que revalidar cuando LLEGA un push (no cuando se toca).
 *
 * Es el tercer mecanismo de frescura, y cubre la ventana que los otros dos no
 * alcanzan: la app abierta, en la misma pantalla, sin cambio de AppState ni de
 * foco. Jessica captura una reserva desde su teléfono, el backend ya avisa al
 * resto del equipo (packages/api/src/lib/notifyNewReservation.ts, que excluye a
 * quien la creó), y con esto la lista del otro teléfono se actualiza sola.
 *
 * Devuelve `[]` para los tipos que no tocan nada cacheado (reportes diarios,
 * saldo a favor…): un push de esos no debe disparar refetches de más.
 *
 * La usan tanto PushCacheInvalidator (push que LLEGA en primer plano) como el
 * tap del push en PushNavigationHandler (llegó en background): así el destino
 * del deep link se abre con datos frescos y no con la caché de 5 min.
 */
export function notificationInvalidationKeys(
  type: string,
  data: NotificationRouteData
): QueryKey[] {
  const kind = typeof data?.kind === "string" ? data.kind : undefined;
  const reservationId =
    typeof data?.reservationId === "string" ? data.reservationId : undefined;
  const petId = typeof data?.petId === "string" ? data.petId : undefined;

  // Cartilla / vacunas. El `type` de todas las de cartilla es GENERAL; se
  // distinguen por `kind` (ver NotificationRouteData). Sin esto, el cliente
  // recibía "cartilla aprobada", abría al perro y seguía viendo "En revisión"
  // (["pet", id] con staleTime de 5 min) y el wizard de hospedaje lo seguía
  // bloqueando (valida con ["pets", userId]).
  //   ["pets"]      → por prefijo alcanza ["pets", userId] (listas y wizard)
  //   ["pet", id]   → detalle del perro (y ["pet", id, "co-owners"])
  const touchesCartilla =
    type === "VACCINE_EXPIRING" ||
    kind === "CARTILLA_REVIEW" ||
    kind === "CARTILLA_EXPIRED" ||
    kind === "CARTILLA_UPLOADED";
  if (touchesCartilla) {
    const keys: QueryKey[] = [["pets"]];
    if (petId) keys.push(["pet", petId]);
    if (kind === "CARTILLA_UPLOADED") {
      // Al ADMIN le acaba de llegar una cartilla por revisar.
      keys.push(
        ["admin", "cartillas"],
        ["admin", "alerts"],
        ["admin", "stats"],
        ["admin", "pets"],
      );
    }
    return keys;
  }

  // El equipo acaba de compartirle una mascota a esta persona (pareja/familia
  // que comparte perro). Sin esto no la vería: la lista de mascotas tiene
  // staleTime de 5 min y no refetchea al volver a la pestaña, así que se
  // quedaría con el estado vacío de "registra a tu peludito" hasta matar la app.
  if (kind === "PET_SHARED") {
    return [["pets"], ["reservations"]];
  }

  // Saldo pendiente al concluir: el detalle tiene que mostrar el banner de pago
  // y la lista su indicador, aunque el cliente ya estuviera parado ahí.
  if (kind === "BALANCE_DUE") {
    return reservationId
      ? [["reservations"], ["reservation", reservationId]]
      : [["reservations"]];
  }

  const touchesReservations =
    type === "NEW_RESERVATION" ||
    kind === "NEW_RESERVATION" ||
    kind === "RESERVATION_UPDATED";

  if (!touchesReservations) return [];

  const keys: QueryKey[] = [
    ["admin", "reservations"],
    ["admin", "stats"],
    ["staff", "stays"],
    ["staff-baths"],
    ["staff", "daycares"],
    ["reservations"],
  ];
  if (reservationId) {
    keys.push(["reservation", reservationId]);
    keys.push(["staff", "stay", reservationId]);
  }
  return keys;
}
