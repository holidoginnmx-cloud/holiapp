import type { PetSize, PrismaClient } from "@holidoginn/db";
import { sizeFromWeight } from "@holidoginn/shared";

/**
 * Talla derivada del peso, con una salvaguarda: nunca deja a un perro fuera
 * del cuarto que YA tiene asignado en una estancia activa.
 *
 * Por qué hace falta: `pets.size` no es solo una etiqueta, es el filtro con el
 * que se asigna cuarto (`rooms.sizeAllowed`) y la variante de baño. La escala
 * única de shared (S ≤5, M ≤15, L ≤24, XL) no coincide con la que documenta el
 * enum en schema.prisma (con la que se configuraron los cuartos), así que
 * recalcular el peso de un perro hospedado podía volverlo "demasiado grande"
 * para el cuarto donde está durmiendo esta noche: el cuarto dejaba de contar
 * como disponible para él y la estancia quedaba en un estado imposible.
 *
 * Regla: si la talla nueva no cabe en el cuarto de alguna reserva CONFIRMED o
 * CHECKED_IN, se conserva la talla actual. La siguiente reserva ya se hará con
 * la talla correcta, sin romper la que está en curso.
 */
export async function derivePetSize(
  prisma: PrismaClient,
  opts: {
    weight: number | null | undefined;
    currentSize?: PetSize | null;
    /** Mascota existente; omitir en altas (todavía no tiene reservas). */
    petId?: string;
  }
): Promise<PetSize> {
  const fallback = opts.currentSize ?? "M";
  if (opts.weight == null) return fallback;
  const next = sizeFromWeight(opts.weight) as PetSize;
  if (!opts.petId || next === opts.currentSize) return next;

  const activas = await prisma.reservation.findMany({
    where: {
      petId: opts.petId,
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      roomId: { not: null },
    },
    select: { room: { select: { name: true, sizeAllowed: true } } },
  });
  const bloquea = activas.find((r) => r.room && !r.room.sizeAllowed.includes(next));
  if (bloquea) return opts.currentSize ?? next;
  return next;
}
