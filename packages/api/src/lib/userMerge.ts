import type { PrismaClient, User } from "@prisma/client";

// Error tipado para colisiones de carrera (otra petición vinculó al candidato
// mientras tanto). La ruta lo traduce a un 409 amistoso.
export class ClaimUnavailableError extends Error {
  constructor() {
    super("Esta cuenta ya no está disponible para vincular.");
    this.name = "ClaimUnavailableError";
  }
}

// Email walk-in autogenerado por el admin cuando el cliente no dejó correo.
const WALKIN_EMAIL_RE = /@holidoginn\.local$/i;
const isPlaceholderName = (n?: string | null): boolean =>
  !n || !n.trim() || n.trim().toLowerCase() === "usuario";

// Consolida la cuenta recién creada por Clerk (`fresh`) dentro del registro
// preexistente del cliente (`legacyId`, creado por el admin sin clerkId).
// Conservamos el id, mascotas e historial de la cuenta legacy (ya referenciados
// por reservas/pagos) y solo movemos lo poco que una cuenta nueva pudo
// acumular durante el onboarding; luego borramos la cuenta fresca para liberar
// su email/clerkId del índice único. Devuelve el usuario consolidado.
//
// PRECONDICIÓN (validada por la ruta antes de llamar): `fresh` no tiene
// mascotas ni reservas. Re-validamos `clerkId IS NULL` del legacy dentro de la
// transacción para cerrar la ventana de carrera.
export async function mergeFreshIntoLegacy(
  prisma: PrismaClient,
  fresh: User,
  legacyId: string,
  enteredPhone?: string | null
): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const legacy = await tx.user.findUnique({ where: { id: legacyId } });
    if (
      !legacy ||
      !legacy.isActive ||
      legacy.clerkId !== null ||
      legacy.role !== "OWNER" ||
      legacy.id === fresh.id
    ) {
      throw new ClaimUnavailableError();
    }

    // 1. Reasignar a `legacy` las relaciones que un OWNER nuevo pudo crear en el
    //    arranque (el resto de relaciones de User son de staff/historial y están
    //    vacías para una cuenta recién creada).
    await tx.pushToken.updateMany({
      where: { userId: fresh.id },
      data: { userId: legacy.id },
    });
    await tx.notification.updateMany({
      where: { userId: fresh.id },
      data: { userId: legacy.id },
    });
    await tx.cart.updateMany({
      where: { userId: fresh.id },
      data: { userId: legacy.id },
    });
    await tx.order.updateMany({
      where: { userId: fresh.id },
      data: { userId: legacy.id },
    });
    await tx.productReview.updateMany({
      where: { userId: fresh.id },
      data: { userId: legacy.id },
    });
    await tx.review.updateMany({
      where: { ownerId: fresh.id },
      data: { ownerId: legacy.id },
    });
    await tx.creditLedger.updateMany({
      where: { userId: fresh.id },
      data: { userId: legacy.id },
    });
    // Consentimientos legales de `fresh`: se descartan. El gate legal los
    // re-pide si faltan, y así evitamos chocar con el único (userId,
    // documentType, version) si `legacy` ya tenía alguno del mismo tipo.
    await tx.legalAcceptance.deleteMany({ where: { userId: fresh.id } });

    // 2. Capturar identificadores de `fresh` antes de borrarlo.
    const clerkId = fresh.clerkId;
    const realEmail = fresh.email;

    // 3. Borrar `fresh` → libera su email y clerkId del índice único.
    await tx.user.delete({ where: { id: fresh.id } });

    // 4. Consolidar en `legacy`.
    const adoptEmail =
      WALKIN_EMAIL_RE.test(legacy.email) && !WALKIN_EMAIL_RE.test(realEmail);
    const updated = await tx.user.update({
      where: { id: legacy.id },
      data: {
        clerkId,
        ...(adoptEmail ? { email: realEmail } : {}),
        ...(!legacy.phone && enteredPhone ? { phone: enteredPhone } : {}),
        ...(isPlaceholderName(legacy.firstName)
          ? { firstName: fresh.firstName, lastName: fresh.lastName }
          : {}),
      },
    });
    return updated;
  });
}
