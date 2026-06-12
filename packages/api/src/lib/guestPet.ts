import type { PrismaClient, Pet } from "@prisma/client";
import type { GuestPet } from "@holidoginn/shared";

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

  const existing = await prisma.pet.findFirst({
    where: {
      ownerId,
      isActive: true,
      name: { equals: gp.name, mode: "insensitive" },
      weight: gp.weight ?? undefined,
    },
  });

  if (existing) {
    const pet = await prisma.pet.update({ where: { id: existing.id }, data });
    return { pet, created: false };
  }

  const pet = await prisma.pet.create({ data });
  return { pet, created: true };
}
