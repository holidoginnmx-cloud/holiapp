/**
 * Resuelve a qué pantalla lleva una notificación (in-app o push).
 *
 * Única fuente de verdad para el deep link: la usan tanto la lista de
 * notificaciones de (tabs)/notifications.tsx como el handler de push del
 * _layout raíz. Si se agrega un tipo nuevo en el backend, se mapea AQUÍ.
 *
 * `data` es el JSON que el backend adjunta en notifyUser/notifyUsers
 * (packages/api/src/lib/notify.ts).
 */
export type NotificationRouteData = {
  reservationId?: string;
  petId?: string;
  /**
   * Subtipo de las notificaciones de cartilla (el `type` de todas es GENERAL):
   *   - CARTILLA_UPLOADED → para ADMIN, hay cartilla por revisar
   *   - CARTILLA_REVIEW   → para el dueño, aprobada/rechazada (ver `action`)
   *   - CARTILLA_EXPIRED  → para el dueño, la cartilla venció
   */
  kind?: string;
  action?: string;
} | null;

export function notificationRoute(
  type: string,
  data: NotificationRouteData
): string | null {
  const reservationId =
    typeof data?.reservationId === "string" ? data.reservationId : undefined;
  const petId = typeof data?.petId === "string" ? data.petId : undefined;

  // CREDIT_ADDED: historial de saldo a favor.
  if (type === "CREDIT_ADDED") return "/profile/credit-history";

  // DAILY_REPORT: reportes diarios de la estancia.
  if (type === "DAILY_REPORT" && reservationId) {
    return `/reservation/checklists/${reservationId}`;
  }

  // action=CHOOSE_REFUND: detalle con el modal de elegir reembolso vs saldo.
  if (data?.action === "CHOOSE_REFUND" && reservationId) {
    return `/reservation/detail/${reservationId}?action=choose-refund`;
  }

  // --- Cartilla / vacunas -------------------------------------------------
  if (petId) {
    // Admin: cartilla subida pendiente de revisión.
    if (data?.kind === "CARTILLA_UPLOADED") return "/admin/cartillas";

    // Dueño: vacuna por vencer / vencida, cartilla vencida o rechazada →
    // pantalla de renovar cartilla (ahí sube las fotos nuevas).
    const vaAcartilla =
      type === "VACCINE_EXPIRING" ||
      data?.kind === "CARTILLA_EXPIRED" ||
      (data?.kind === "CARTILLA_REVIEW" && data?.action === "REJECT");
    if (vaAcartilla) return `/pet/renew-cartilla/${petId}`;
  }

  // Resto: detalle de la reservación si trae id.
  if (reservationId) return `/reservation/detail/${reservationId}`;

  // Cualquier otra cosa con petId (p.ej. cartilla aprobada) → perfil del perro.
  if (petId) return `/pet/${petId}`;

  return null;
}
