import type { PrismaClient, User } from "@prisma/client";

// Error tipado para colisiones de carrera (otra petición vinculó a un registro
// mientras tanto). La ruta lo traduce a un 409 amistoso.
export class ClaimUnavailableError extends Error {
  constructor() {
    super("Esta cuenta ya no está disponible para vincular.");
    this.name = "ClaimUnavailableError";
  }
}

// Error tipado cuando alguna mascota seleccionada no pertenece a los registros
// legacy autorizados por el match (teléfono/correo). La ruta → 403.
export class ClaimForbiddenError extends Error {
  constructor() {
    super("Alguna mascota seleccionada no corresponde a tu cuenta.");
    this.name = "ClaimForbiddenError";
  }
}

// Email walk-in autogenerado por el admin cuando el cliente no dejó correo.
const WALKIN_EMAIL_RE = /@holidoginn\.local$/i;
const isPlaceholderName = (n?: string | null): boolean =>
  !n || !n.trim() || n.trim().toLowerCase() === "usuario";

// Vincula la cuenta recién creada por Clerk (`fresh`) con las mascotas que el
// cliente reconoció como suyas (`petIds`), consolidándolas bajo un solo
// registro. Los clientes preexistentes suelen estar FRAGMENTADOS: el admin creó
// varios registros (mismo teléfono, `clerkId=null`), cada uno con una parte de
// sus mascotas. Aquí:
//   1. Autorizamos las mascotas contra los registros legacy que el match
//      (teléfono/correo) devolvió (`allowedRecordIds`).
//   2. Elegimos un registro PRIMARIO (el que aporta más mascotas seleccionadas)
//      y enlazamos la cuenta Clerk a él, preservando su historial.
//   3. Movemos las mascotas seleccionadas de los OTROS registros al primario,
//      junto con sus reservas, para que su historial siga visible en la app.
//   4. Desactivamos los registros secundarios que queden sin mascotas activas.
//
// PRECONDICIÓN (validada por la ruta antes de llamar): `fresh` no tiene mascotas
// ni reservas. Todo ocurre en una transacción y re-validamos `clerkId IS NULL`
// de los registros dentro de ella para cerrar la ventana de carrera.
export async function claimPetsIntoAccount(
  prisma: PrismaClient,
  fresh: User,
  petIds: string[],
  allowedRecordIds: string[],
  enteredPhone?: string | null
): Promise<User> {
  const allowed = new Set(allowedRecordIds);

  return prisma.$transaction(async (tx) => {
    // 1. Cargar y AUTORIZAR las mascotas seleccionadas dentro de la transacción.
    //    Deben existir, estar activas y pertenecer a un registro autorizado.
    const pets = await tx.pet.findMany({
      where: { id: { in: petIds }, isActive: true },
      select: { id: true, ownerId: true },
    });
    if (
      pets.length !== petIds.length ||
      pets.some((p) => !allowed.has(p.ownerId))
    ) {
      throw new ClaimForbiddenError();
    }

    // 2. Registros legacy dueños de esas mascotas; re-validar (carrera).
    const sourceIds = [...new Set(pets.map((p) => p.ownerId))];
    const sources = await tx.user.findMany({ where: { id: { in: sourceIds } } });
    if (
      sources.length !== sourceIds.length ||
      sources.some(
        (s) =>
          !s.isActive ||
          s.clerkId !== null ||
          s.role !== "OWNER" ||
          s.id === fresh.id
      )
    ) {
      throw new ClaimUnavailableError();
    }

    // 3. Primario: preferimos un registro cuyas mascotas estén TODAS
    //    seleccionadas (lo reclamamos por completo) para no arrastrar mascotas
    //    no marcadas (p. ej. de un familiar que comparte teléfono). Desempate:
    //    más mascotas seleccionadas, luego id estable (elección determinista).
    const selectedByOwner = new Map<string, number>();
    for (const p of pets) {
      selectedByOwner.set(p.ownerId, (selectedByOwner.get(p.ownerId) ?? 0) + 1);
    }
    const totals = await tx.pet.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: sourceIds }, isActive: true },
      _count: { _all: true },
    });
    const totalByOwner = new Map(totals.map((t) => [t.ownerId, t._count._all]));
    const isFull = (id: string) =>
      (selectedByOwner.get(id) ?? 0) === (totalByOwner.get(id) ?? 0);
    const primaryId = [...selectedByOwner.keys()].sort((a, b) => {
      if (isFull(a) !== isFull(b)) return isFull(a) ? -1 : 1;
      const diff = (selectedByOwner.get(b) ?? 0) - (selectedByOwner.get(a) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    })[0];
    const primary = sources.find((s) => s.id === primaryId)!;

    // 4. Enlazar la cuenta Clerk (`fresh`) al primario: reasignar lo que una
    //    cuenta nueva pudo acumular en el arranque, borrar `fresh` (libera su
    //    email/clerkId del índice único) y heredar clerkId/email/teléfono/nombre.
    await tx.pushToken.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    await tx.notification.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    await tx.cart.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    await tx.order.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    await tx.productReview.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    await tx.review.updateMany({
      where: { ownerId: fresh.id },
      data: { ownerId: primaryId },
    });
    await tx.creditLedger.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    // Consentimientos legales de `fresh`: se descartan (el gate legal los re-pide
    // si faltan) para no chocar con el único (userId, documentType, version).
    await tx.legalAcceptance.deleteMany({ where: { userId: fresh.id } });

    const clerkId = fresh.clerkId;
    const realEmail = fresh.email;
    await tx.user.delete({ where: { id: fresh.id } });

    const adoptEmail =
      WALKIN_EMAIL_RE.test(primary.email) && !WALKIN_EMAIL_RE.test(realEmail);
    const updatedPrimary = await tx.user.update({
      where: { id: primaryId },
      data: {
        clerkId,
        ...(adoptEmail ? { email: realEmail } : {}),
        ...(!primary.phone && enteredPhone ? { phone: enteredPhone } : {}),
        ...(isPlaceholderName(primary.firstName)
          ? { firstName: fresh.firstName, lastName: fresh.lastName }
          : {}),
      },
    });

    // 5. Mover las mascotas seleccionadas que viven en OTROS registros al
    //    primario, junto con sus reservas (para conservar el historial visible).
    //    Los datos ligados solo a `petId` (vacunas, desparasitantes, updates,
    //    alertas) viajan con la mascota sin tocarse.
    const movedPetIds = pets
      .filter((p) => p.ownerId !== primaryId)
      .map((p) => p.id);
    if (movedPetIds.length > 0) {
      await tx.pet.updateMany({
        where: { id: { in: movedPetIds } },
        data: { ownerId: primaryId },
      });
      await tx.reservation.updateMany({
        where: { petId: { in: movedPetIds } },
        data: { ownerId: primaryId },
      });
    }

    // 6. Desactivar los registros secundarios que quedaron sin mascotas activas:
    //    dejan de aparecer como cliente fantasma y como candidato de claim. Los
    //    que conservan mascotas (familiar con teléfono compartido) se dejan tal
    //    cual (clerkId=null) para que ese otro cliente pueda reclamarlas luego.
    for (const s of sources) {
      if (s.id === primaryId) continue;
      const remaining = await tx.pet.count({
        where: { ownerId: s.id, isActive: true },
      });
      if (remaining === 0) {
        await tx.user.update({
          where: { id: s.id },
          data: { isActive: false },
        });
      }
    }

    return updatedPrimary;
  });
}
