/**
 * Quita de la respuesta los campos que son SOLO del equipo antes de mandarla a
 * un cliente dueño.
 *
 * Por qué es obligatorio y no cosmético: los GET de reservaciones devuelven la
 * fila con `include` (no `select`) y la sueltan tal cual —`return reservation`,
 * `...r`—, y el guard de autorización permite explícitamente al OWNER leer sus
 * propias reservas. O sea que TODA columna nueva de `reservations` viaja al
 * teléfono del cliente por defecto. Borrar el bloque que la pinta en la app no
 * alcanza: el dato sigue en el JSON.
 *
 * Se aplica en el borde (justo antes del `return`) y no con un `select`
 * explícito porque los `include` de estas rutas son grandes y cambian seguido;
 * enumerar columnas ahí garantiza que la próxima que se agregue se olvide.
 */

/** Campos internos de `reservations`. */
const RESERVATION_INTERNAL_FIELDS = ["internalNotes"] as const;

/** Campos internos de `reservation_addons`. */
const ADDON_INTERNAL_FIELDS = [
  "internalNote",
  "courtesyReason",
  "courtesySetById",
  "courtesySetBy",
  "courtesySetAt",
] as const;

/**
 * Devuelve la reserva sin los campos internos si el solicitante NO es
 * staff/admin. Para staff/admin la devuelve intacta (misma referencia).
 *
 * Nota sobre la cortesía: `isCourtesy` y `unitPrice` NO se borran. El dueño
 * puede y debe ver que su baño salió gratis; lo que no le corresponde es el
 * motivo interno ni quién lo autorizó.
 */
export function stripInternalFields<T extends Record<string, unknown>>(
  reservation: T,
  isStaffOrAdmin: boolean
): T {
  if (isStaffOrAdmin) return reservation;

  const clean = { ...reservation } as Record<string, unknown>;
  for (const field of RESERVATION_INTERNAL_FIELDS) {
    delete clean[field];
  }

  const addons = clean.addons;
  if (Array.isArray(addons)) {
    clean.addons = addons.map((addon) => {
      if (!addon || typeof addon !== "object") return addon;
      const cleanAddon = { ...(addon as Record<string, unknown>) };
      for (const field of ADDON_INTERNAL_FIELDS) {
        delete cleanAddon[field];
      }
      return cleanAddon;
    });
  }

  return clean as T;
}

/** Igual que `stripInternalFields` pero para listas. */
export function stripInternalFieldsList<T extends Record<string, unknown>>(
  reservations: T[],
  isStaffOrAdmin: boolean
): T[] {
  if (isStaffOrAdmin) return reservations;
  return reservations.map((r) => stripInternalFields(r, isStaffOrAdmin));
}
