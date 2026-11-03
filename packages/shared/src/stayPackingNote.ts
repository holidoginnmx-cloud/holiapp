/**
 * Mensaje de «qué llevar» que ve el cliente al reservar HOSPEDAJE.
 *
 * Lo pidió el equipo en noviembre de 2026: querían mandarlo por WhatsApp,
 * pero la app no puede, así que sale en la pantalla de éxito de la app, en el
 * correo de confirmación y en la página de éxito del sitio.
 *
 * FUENTE ÚNICA para la API y el móvil. El sitio (HolidogInn-site) lo tiene
 * duplicado en components/booking/BookingConfirmation.tsx porque consume este
 * paquete como tarball: si cambias el texto aquí, cámbialo también allá.
 *
 * Módulo puro, sin zod (el móvil lo importa sin arrastrar el bundle).
 */

/** «Polo», «Polo y Luna», «Polo, Luna y Toby». Sin nombres: «tu peludito». */
export function joinPetNames(petNames: readonly string[]): string {
  const names = [...new Set(petNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return "tu peludito";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export const STAY_PACKING_ITEMS = [
  "Platos para comida",
  "Agua",
  "Correa para sus paseos (si tiene permiso para salir)",
] as const;

export function stayPackingNote(petNames: readonly string[]): {
  /** «La reserva de Polo está lista. Recuerda llevar su alimento 🍖» */
  headline: string;
  /** Encabezado de la lista de lo que pone el hotel. */
  providesLabel: string;
  items: readonly string[];
} {
  return {
    headline: `La reserva de ${joinPetNames(petNames)} está lista. Recuerda llevar su alimento 🍖`,
    providesLabel: "Nosotros le proporcionaremos:",
    items: STAY_PACKING_ITEMS,
  };
}
