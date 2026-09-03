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

  // El historial de la mascota incluye los reportes diarios anidados: el
  // relevo interno del staff tampoco debe viajar por ahí.
  const checklists = clean.checklists;
  if (Array.isArray(checklists)) {
    clean.checklists = checklists.map((c) =>
      c && typeof c === "object"
        ? stripChecklistInternalFields(c as Record<string, unknown>, false)
        : c
    );
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

/**
 * Bloque de relevo entre staff dentro de `DailyChecklist.additionalNotes`:
 * todo lo que sigue a "[HANDOFF] " es interno. El reporte diario se escribe
 * en un solo campo (lo público arriba, el relevo abajo) y el corte se hace
 * aquí, en UN lugar, para que caption, push y las lecturas del dueño
 * coincidan siempre.
 */
const HANDOFF_BLOCK = /\n?\[HANDOFF\] [\s\S]*/;

/** Quita el bloque `[HANDOFF]` de una nota. null si no queda nada público. */
export function stripHandoff(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes.replace(HANDOFF_BLOCK, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Reporte diario sin el relevo interno cuando quien pregunta NO es del
 * equipo. Para staff/admin lo devuelve intacto (misma referencia).
 */
export function stripChecklistInternalFields<T extends Record<string, unknown>>(
  checklist: T,
  isStaffOrAdmin: boolean
): T {
  if (isStaffOrAdmin) return checklist;
  if (typeof checklist.additionalNotes !== "string") return checklist;
  return {
    ...checklist,
    additionalNotes: stripHandoff(checklist.additionalNotes),
  } as T;
}

/** Igual que `stripChecklistInternalFields` pero para listas. */
export function stripChecklistInternalFieldsList<T extends Record<string, unknown>>(
  checklists: T[],
  isStaffOrAdmin: boolean
): T[] {
  if (isStaffOrAdmin) return checklists;
  return checklists.map((c) => stripChecklistInternalFields(c, isStaffOrAdmin));
}
