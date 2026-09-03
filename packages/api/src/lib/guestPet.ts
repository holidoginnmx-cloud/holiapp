import type { PrismaClient, Pet } from "@prisma/client";
import type { GuestPet } from "@holidoginn/shared";
import { findPetByName } from "./petName";
import { sizeFromWeight } from "./pricing";
import { derivePetSize } from "./petSize";

// Datos de mascota inline del invitado (GuestPet del shared, sin ownerId).
type GuestPetInput = GuestPet;

// Crea (o reusa) la mascota del invitado ligada al owner. Para evitar que se
// acumulen mascotas duplicadas cuando el invitado recalcula la cotización
// (cada create-intent reintenta), reusa una mascota activa del mismo dueño con
// el MISMO nombre y peso, actualizándola con los datos más recientes. La
// cartilla entra PENDING si hay fotos. Devuelve { pet, created }.
export async function resolveOrCreateGuestPet(
  prisma: PrismaClient,
  ownerId: string,
  gp: GuestPetInput
): Promise<{ pet: Pet; created: boolean }> {
  const photos =
    gp.cartillaPhotos && gp.cartillaPhotos.length > 0
      ? gp.cartillaPhotos
      : gp.cartillaUrl
        ? [gp.cartillaUrl]
        : [];
  const cartillaStatus = photos.length > 0 ? ("PENDING" as const) : null;
  const data = {
    ...gp,
    // Talla derivada del peso en el servidor (escala única de shared); el
    // `size` que manda el wizard se ignora. Mismo criterio que POST /pets.
    size: gp.weight != null ? sizeFromWeight(gp.weight) : ("M" as const),
    ownerId,
    cartillaPhotos: photos,
    cartillaUrl: gp.cartillaUrl ?? photos[0] ?? null,
    cartillaStatus,
  };

  // El match por nombre se hace en memoria (`findPetByName`) porque el `equals
  // ... insensitive` de Postgres ignora mayúsculas pero NO los espacios: "DUGAN"
  // y "DUGAN " se veían como perros distintos y el invitado terminaba con dos
  // fichas del mismo. Son las mascotas de UN dueño, así que la lista es corta.
  const candidatos = await prisma.pet.findMany({
    where: {
      ownerId,
      isActive: true,
      weight: gp.weight ?? undefined,
    },
  });
  const existing = findPetByName(candidatos, gp.name);

  if (existing) {
    // Al reutilizar NO se pisa lo que ya tiene la ficha: el wizard manda null
    // o "" en todo lo que el invitado dejó vacío, y antes eso borraba raza,
    // salud y contactos capturados en una visita anterior. Peor: escribía
    // cartillaStatus (PENDING o null) y cartillaPhotos: [] encima de una
    // cartilla APROBADA por el equipo, y el perro quedaba bloqueado para
    // reservar. Regla: una APPROVED nunca baja por este camino; solo se
    // manda a revisión (PENDING + fotos) si llegaron fotos nuevas y la
    // cartilla actual NO está aprobada.
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(gp)) {
      if (key.startsWith("cartilla")) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      // Un checkbox sin marcar llega como `false` por default del schema: es
      // "sin dato", no "dato negativo" (p. ej. un isNeutered que capturó el
      // equipo no debe volverse false porque el invitado no lo marcó).
      if (value === false) continue;
      // La talla no se copia del body: sale del peso (abajo).
      if (key === "size") continue;
      patch[key] = value;
    }
    // Talla derivada, sin sacar al perro del cuarto de una estancia en curso.
    if (gp.weight != null) {
      patch.size = await derivePetSize(prisma, {
        weight: gp.weight,
        currentSize: existing.size,
        petId: existing.id,
      });
    }
    if (photos.length > 0 && existing.cartillaStatus !== "APPROVED") {
      patch.cartillaPhotos = photos;
      patch.cartillaUrl = gp.cartillaUrl ?? photos[0];
      patch.cartillaStatus = "PENDING";
    }
    const pet = await prisma.pet.update({ where: { id: existing.id }, data: patch });
    return { pet, created: false };
  }

  const pet = await prisma.pet.create({ data });
  return { pet, created: true };
}
