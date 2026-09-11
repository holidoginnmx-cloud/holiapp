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

// Error tipado cuando se pide descartar una mascota de la cuenta nueva que ya
// tiene reservas. Desactivarla dejaría su historial colgando de una ficha
// invisible, así que se conserva y lo resuelve una persona. La ruta → 409.
export class ClaimDiscardError extends Error {
  constructor() {
    super("Esa mascota ya tiene reservas: no se puede descartar.");
    this.name = "ClaimDiscardError";
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
//   5. ABSORBEMOS lo que la cuenta nueva hubiera acumulado antes de vincularse.
//
// Sobre el punto 5: antes esto era una PRECONDICIÓN —si `fresh` ya tenía
// mascotas o reservas, la ruta devolvía 409 y no se podía vincular—. Y ese es
// justo el camino más natural del cliente: no encuentra su ficha, registra a su
// perro para poder usar la app, y DESPUÉS pide que lo vinculen. Se quedaba
// atorado sin salida desde la app. Ahora se traslada al primario, porque el
// `delete` de `fresh` no puede dejar nada colgando: `Pet.owner` y
// `Reservation.owner` son obligatorias (el borrado fallaría) y `Payment.user`
// es opcional (se quedaría en null, perdiendo de vista ese dinero).
//
// `discardPetIds` es para el caso frecuente de que la mascota que registró sea
// LA MISMA que ya está en su ficha: el ADMIN marca cuál sobra y esa se
// desactiva en vez de quedar duplicada. Solo se admite descartar una ficha sin
// reservas propias — si tiene historial, se conserva y lo resuelve una persona.
//
// Todo ocurre en una transacción y re-validamos `clerkId IS NULL` de los
// registros dentro de ella para cerrar la ventana de carrera.
export async function claimPetsIntoAccount(
  prisma: PrismaClient,
  fresh: User,
  petIds: string[],
  allowedRecordIds: string[],
  enteredPhone?: string | null,
  discardPetIds?: string[]
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
    // Co-propiedades de la cuenta nueva: se re-apuntan al primario. Puede
    // chocar con el único (petId,userId) si el primario ya era co-dueño de esa
    // misma mascota, así que primero se limpian las que ya existen.
    const freshCoOwned = await tx.petCoOwner.findMany({
      where: { userId: fresh.id },
      select: { petId: true },
    });
    if (freshCoOwned.length > 0) {
      await tx.petCoOwner.deleteMany({
        where: {
          userId: primaryId,
          petId: { in: freshCoOwned.map((c) => c.petId) },
        },
      });
      await tx.petCoOwner.updateMany({
        where: { userId: fresh.id },
        data: { userId: primaryId },
      });
    }
    // Consentimientos legales de `fresh`: se descartan (el gate legal los re-pide
    // si faltan) para no chocar con el único (userId, documentType, version).
    await tx.legalAcceptance.deleteMany({ where: { userId: fresh.id } });

    // Lo que la cuenta nueva alcanzó a acumular antes de vincularse. Va ANTES
    // del `delete`: si quedara algo apuntando a `fresh`, o el borrado falla
    // (relaciones obligatorias) o se pierde el vínculo (las opcionales pasan a
    // null en cascada).
    const freshPets = await tx.pet.findMany({
      where: { ownerId: fresh.id },
      select: { id: true, name: true },
    });

    if (discardPetIds && discardPetIds.length > 0) {
      const propias = new Set(freshPets.map((p) => p.id));
      const aDescartar = [...new Set(discardPetIds)].filter((id) => propias.has(id));
      if (aDescartar.length > 0) {
        // Con reservas NO se descarta: esa mascota ya tiene historial y
        // desactivarla dejaría reservas colgando de una ficha invisible.
        const conHistorial = await tx.reservation.findMany({
          where: { petId: { in: aDescartar } },
          select: { petId: true },
          distinct: ["petId"],
        });
        if (conHistorial.length > 0) throw new ClaimDiscardError();
        await tx.pet.updateMany({
          where: { id: { in: aDescartar } },
          data: { isActive: false },
        });
      }
    }

    // Se trasladan TODAS (incluidas las recién desactivadas): la ficha sigue
    // existiendo y su dueño tiene que ser el registro que sobrevive.
    if (freshPets.length > 0) {
      await tx.pet.updateMany({
        where: { ownerId: fresh.id },
        data: { ownerId: primaryId },
      });
    }
    await tx.reservation.updateMany({
      where: { ownerId: fresh.id },
      data: { ownerId: primaryId },
    });
    await tx.payment.updateMany({
      where: { userId: fresh.id },
      data: { userId: primaryId },
    });
    // `requestedById` es obligatoria: sin esto el borrado de `fresh` falla.
    await tx.reservationChangeRequest.updateMany({
      where: { requestedById: fresh.id },
      data: { requestedById: primaryId },
    });
    await tx.quote.updateMany({
      where: { ownerId: fresh.id },
      data: { ownerId: primaryId },
    });

    // Invitaciones para compartir mascota: las que mandó la cuenta nueva siguen
    // sirviendo desde el registro que sobrevive (sus perros se van ahí), y el
    // rastro de quién aceptó o canceló no se pierde. Sin esto el cascade las
    // borraba y la liga ya mandada por WhatsApp daba "no encontramos".
    await tx.petInvite.updateMany({
      where: { invitedById: fresh.id },
      data: { invitedById: primaryId },
    });
    await tx.petInvite.updateMany({
      where: { acceptedById: fresh.id },
      data: { acceptedById: primaryId },
    });
    await tx.petInvite.updateMany({
      where: { revokedById: fresh.id },
      data: { revokedById: primaryId },
    });

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
      // Si el primario era co-dueño de una mascota que acaba de reclamar como
      // suya, esa fila sobra (nadie es co-dueño de sí mismo).
      await tx.petCoOwner.deleteMany({
        where: { petId: { in: movedPetIds }, userId: primaryId },
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
