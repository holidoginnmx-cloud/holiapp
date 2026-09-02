import type { PrismaClient, Pet } from "@prisma/client";
import type { GuestPet } from "@holidoginn/shared";
import { findPetByName } from "./petName";

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
    const pet = await prisma.pet.update({ where: { id: existing.id }, data });
    return { pet, created: false };
  }

  const pet = await prisma.pet.create({ data });
  return { pet, created: true };
}
