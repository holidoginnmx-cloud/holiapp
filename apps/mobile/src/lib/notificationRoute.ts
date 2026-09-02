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
  /** STAY | BATH | DAYCARE — el staff tiene una pantalla por tipo. */
  reservationType?: string;
  /**
   * Subtipo de las notificaciones de cartilla (el `type` de todas es GENERAL):
   *   - CARTILLA_UPLOADED → para ADMIN, hay cartilla por revisar
   *   - CARTILLA_REVIEW   → para el dueño, aprobada/rechazada (ver `action`)
   *   - CARTILLA_EXPIRED  → para el dueño, la cartilla venció
   */
  kind?: string;
  action?: string;
  /** `po_...` del depósito de Stripe (kind = STRIPE_PAYOUT). */
  payoutId?: string;
} | null;

/**
 * Rol de quien recibe la notificación: "OWNER" | "STAFF" | "ADMIN". Se acepta
 * `string` porque así lo guarda el authStore; cualquier valor desconocido —o
 * `null`, que es lo que hay antes de que cargue la sesión— cae en el trato de
 * OWNER, que es el destino seguro (todas esas pantallas existen para cualquier
 * rol).
 */
export type NotificationRole = string | null | undefined;

export function notificationRoute(
  type: string,
  data: NotificationRouteData,
  role?: NotificationRole
): string | null {
  const reservationId =
    typeof data?.reservationId === "string" ? data.reservationId : undefined;
  const petId = typeof data?.petId === "string" ? data.petId : undefined;
  const isOwner = role == null || role === "OWNER";

  // CREDIT_ADDED: historial de saldo a favor.
  if (type === "CREDIT_ADDED" && isOwner) return "/profile/credit-history";

  // DAILY_REPORT: reportes diarios de la estancia.
  if (type === "DAILY_REPORT" && reservationId && isOwner) {
    return `/reservation/checklists/${reservationId}`;
  }

  // action=CHOOSE_REFUND: detalle con el modal de elegir reembolso vs saldo.
  if (data?.action === "CHOOSE_REFUND" && reservationId && isOwner) {
    return `/reservation/detail/${reservationId}?action=choose-refund`;
  }

  // REVIEW_REQUEST: detalle con el modal de calificación ya abierto. Antes caía
  // en el fallback de abajo y el modal se abría de rebote, por un efecto que ya
  // no existe (reaparecía en CADA visita al detalle, aunque no vinieras del
  // push). Ahora el destino es explícito.
  if (type === "REVIEW_REQUEST" && reservationId && isOwner) {
    return `/reservation/detail/${reservationId}?action=review`;
  }

  // BALANCE_DUE: la visita cerró con saldo. Va al detalle del cliente, donde
  // ahora está el botón de pago con el desglose de lo que se cobra. El `type`
  // es GENERAL (como cartilla o los depósitos), así que se distingue por kind.
  if (data?.kind === "BALANCE_DUE" && reservationId && isOwner) {
    return `/reservation/detail/${reservationId}`;
  }

  // --- Depósitos de Stripe (solo admin) -----------------------------------
  // El push del depósito es justo para poder ver, de un tap, de qué reservas
  // venía la transferencia que acaba de caer al banco.
  if (data?.kind === "STRIPE_PAYOUT" && role === "ADMIN") {
    const payoutId = typeof data?.payoutId === "string" ? data.payoutId : undefined;
    return payoutId ? `/admin/payout/${payoutId}` : "/admin/payouts";
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

  // Resto: la reservación, en la pantalla que le toca a cada rol. Mandar a un
  // admin al detalle del CLIENTE lo dejaba viendo la vista equivocada, sin
  // ninguna de las acciones del panel.
  if (reservationId) {
    if (role === "ADMIN") return `/admin/reservation/${reservationId}`;
    if (role === "STAFF") {
      if (data?.reservationType === "BATH") return `/staff/bath/${reservationId}`;
      if (data?.reservationType === "DAYCARE") {
        return `/staff/daycare/${reservationId}`;
      }
      return `/staff/stay/${reservationId}`;
    }
    return `/reservation/detail/${reservationId}`;
  }

  // Cualquier otra cosa con petId (p.ej. cartilla aprobada) → perfil del perro.
  if (petId) return `/pet/${petId}`;

  return null;
}
