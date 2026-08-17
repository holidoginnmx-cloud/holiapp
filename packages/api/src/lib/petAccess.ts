import type { PrismaClient } from "@holidoginn/db";

/**
 * Acceso a una mascota — dueño y co-dueños.
 *
 * Hasta ahora la autorización de mascota estaba copiada inline en ~48 lugares
 * como `if (!isStaffOrAdmin && pet.ownerId !== request.userId) → 403`. Con la
 * co-propiedad (una pareja que comparte perro, cada quien con su cuenta) esa
 * comparación deja de ser suficiente, así que vive aquí una sola vez.
 *
 * Regla de oro: `Pet.ownerId` NO se toca nunca. Esto solo AMPLÍA quién pasa el
 * guard; el camino del dueño de siempre queda idéntico.
 */

export type Actor = { userId?: string; userRole?: string };

export const isTeam = (role?: string) => role === "ADMIN" || role === "STAFF";

// ─── Caché de mascotas compartidas ─────────────────────────
// `sharedPetIds` se llama en CADA GET /pets y GET /reservations, y para la
// inmensa mayoría de clientes devuelve []. Mismo patrón que el caché de auth
// (middleware/auth.ts): Map en memoria, TTL corto, una sola instancia.
//
// OJO: el panel web escribe `pet_co_owners` directo a Supabase sin pasar por
// esta API, así que ahí el TTL es el único mecanismo de refresco. Por eso son
// 30s y no más: un vínculo hecho desde el web tarda a lo mucho medio minuto en
// verse. Los endpoints admin de esta API sí invalidan explícitamente.
const SHARED_CACHE_TTL_MS = 30_000;
const sharedCache = new Map<string, { petIds: string[]; expiresAt: number }>();
const linkedCache = new Map<string, { petIds: string[]; expiresAt: number }>();

export function invalidatePetAccessCache(userId?: string | null) {
  if (userId) {
    sharedCache.delete(userId);
    linkedCache.delete(userId);
  } else {
    sharedCache.clear();
    linkedCache.clear();
  }
}

/**
 * Ids de mascotas que le comparten a este usuario. NO incluye las suyas.
 * Casi siempre es [] — por eso el resultado se cachea y quien no comparte
 * nada sigue pegándole al mismo índice de siempre.
 */
export async function sharedPetIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const hit = sharedCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.petIds;

  const rows = await prisma.petCoOwner.findMany({
    where: { userId },
    select: { petId: true },
  });
  const petIds = rows.map((r) => r.petId);
  sharedCache.set(userId, { petIds, expiresAt: Date.now() + SHARED_CACHE_TTL_MS });
  return petIds;
}

/**
 * ¿Este usuario puede ver/actuar sobre esta mascota?
 *
 * Cortocircuita en orden — equipo, dueño, y solo entonces consulta la tabla de
 * co-dueños (un count contra el índice único). Para el tráfico normal no hay
 * ningún query extra.
 */
export async function canAccessPet(
  prisma: PrismaClient,
  pet: { id: string; ownerId: string },
  actor: Actor
): Promise<boolean> {
  if (isTeam(actor.userRole)) return true;
  if (!actor.userId) return false;
  if (pet.ownerId === actor.userId) return true;
  const count = await prisma.petCoOwner.count({
    where: { petId: pet.id, userId: actor.userId },
  });
  return count > 0;
}

/**
 * Ids de mascotas VINCULADAS a este usuario en cualquiera de las dos
 * direcciones: las que le comparten y las suyas que tienen co-dueño.
 *
 * Es lo que necesita el listado de RESERVAS, porque la reserva se guarda a
 * nombre de quien la hizo: si Andrea reserva para Nala, esa reserva tiene
 * `ownerId = Andrea` y Jesús —el dueño de Nala— no la vería filtrando solo por
 * lo que le comparten a él. Una sola consulta cubre ambos lados.
 */
export async function linkedPetIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const hit = linkedCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.petIds;

  const rows = await prisma.petCoOwner.findMany({
    where: { OR: [{ userId }, { pet: { ownerId: userId } }] },
    select: { petId: true },
  });
  const petIds = [...new Set(rows.map((r) => r.petId))];
  linkedCache.set(userId, { petIds, expiresAt: Date.now() + SHARED_CACHE_TTL_MS });
  return petIds;
}

/**
 * ¿Es co-dueño de esta mascota? Sin el atajo de equipo — para los endpoints
 * cuya regla de rol es distinta (p. ej. eliminar, que es del dueño o de un
 * admin, pero NO de staff).
 */
export async function isCoOwner(
  prisma: PrismaClient,
  petId: string,
  userId?: string
): Promise<boolean> {
  if (!userId) return false;
  const count = await prisma.petCoOwner.count({ where: { petId, userId } });
  return count > 0;
}

/**
 * Igual que `canAccessPet`, pero partiendo de una reserva: entra quien la hizo
 * y también quien comparte la mascota (para ver reportes, fotos y el historial
 * de las visitas que reservó el otro).
 */
export async function canAccessReservation(
  prisma: PrismaClient,
  reservation: { ownerId: string; petId: string },
  actor: Actor
): Promise<boolean> {
  if (isTeam(actor.userRole)) return true;
  if (!actor.userId) return false;
  if (reservation.ownerId === actor.userId) return true;
  // Entran los dos lados del vínculo: el co-dueño (ve lo que reservó el dueño)
  // y el dueño de la mascota (ve lo que reservó el co-dueño — esa reserva está
  // a nombre del otro, así que la comparación de arriba no la alcanza).
  const [asCoOwner, asPetOwner] = await Promise.all([
    prisma.petCoOwner.count({
      where: { petId: reservation.petId, userId: actor.userId },
    }),
    prisma.pet.count({ where: { id: reservation.petId, ownerId: actor.userId } }),
  ]);
  return asCoOwner > 0 || asPetOwner > 0;
}

/**
 * Todas las mascotas que este usuario puede ver: las suyas ∪ las compartidas.
 * Úsalo para candados que hoy hacen `findFirst({ where: { ownerId, ... } })`,
 * como el anti-duplicado por nombre de POST /pets.
 */
export async function accessiblePetFilter(
  prisma: PrismaClient,
  userId: string
): Promise<{ OR: [{ ownerId: string }, { id: { in: string[] } }] } | { ownerId: string }> {
  const shared = await sharedPetIds(prisma, userId);
  if (shared.length === 0) return { ownerId: userId };
  return { OR: [{ ownerId: userId }, { id: { in: shared } }] };
}

/**
 * Quiénes deben enterarse de lo que le pasa a esta mascota: el dueño y sus
 * co-dueños. Si no hay co-dueños devuelve solo al dueño, que es exactamente el
 * comportamiento de siempre.
 *
 * `ownerId` es opcional para ahorrarse el findUnique cuando quien llama ya
 * tiene la reserva/mascota cargada.
 */
export async function petAudienceIds(
  prisma: PrismaClient,
  petId: string,
  ownerId?: string
): Promise<string[]> {
  const ids = new Set<string>();
  if (ownerId) {
    ids.add(ownerId);
  } else {
    const pet = await prisma.pet.findUnique({
      where: { id: petId },
      select: { ownerId: true },
    });
    if (pet) ids.add(pet.ownerId);
  }
  const coOwners = await prisma.petCoOwner.findMany({
    where: { petId },
    select: { userId: true },
  });
  for (const c of coOwners) ids.add(c.userId);
  return [...ids];
}
