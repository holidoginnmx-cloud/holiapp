import type { PrismaClient, User } from "@prisma/client";

/**
 * Junta dos fichas del MISMO cliente en una sola.
 *
 * Pasa cuando el equipo da de alta dos veces a la misma persona: Francisco
 * Acosta quedó con Nala en una ficha y Luna en otra, con el teléfono tecleado
 * distinto (662 101 7711 / 662 107 1121); Melani Otanez, con dos fichas el
 * mismo día. Hasta sep-2026 no había cómo juntarlas: la única fusión era la de
 * "Vincular fichas", que siempre absorbe una cuenta de la app.
 *
 * `from` se da de BAJA (no se borra: el rastro de quién era se conserva) y todo
 * lo suyo pasa a `into`. `from` tiene que ser una ficha SIN cuenta de la app:
 * una con sesión es la del cliente, y juntarla con otra es "Vincular fichas"
 * (claimPetsIntoAccount), que además le hereda la sesión a la ficha.
 */

export class OwnerMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerMergeError";
  }
}

const WALKIN_EMAIL_RE = /@holidoginn\.local$/i;
const nombre = (u: Pick<User, "firstName" | "lastName">) =>
  `${u.firstName} ${u.lastName ?? ""}`.trim();

export async function mergeOwnerInto(
  prisma: PrismaClient,
  fromId: string,
  intoId: string,
  opts: {
    /** De cuál ficha se queda el teléfono cuando las dos tienen. Default `into`. */
    telefonoDe?: "from" | "into";
  } = {},
): Promise<User> {
  if (fromId === intoId) throw new OwnerMergeError("Es la misma ficha.");

  return prisma.$transaction(
    async (tx) => {
      const [from, into] = await Promise.all([
        tx.user.findUnique({ where: { id: fromId } }),
        tx.user.findUnique({ where: { id: intoId } }),
      ]);
      if (!from || !into) throw new OwnerMergeError("Alguna de las dos fichas ya no existe.");
      if (from.role !== "OWNER" || into.role !== "OWNER") {
        throw new OwnerMergeError("Solo se juntan fichas de clientes.");
      }
      if (!from.isActive || !into.isActive) {
        throw new OwnerMergeError("Alguna de las dos fichas ya está dada de baja.");
      }
      if (from.clerkId) {
        throw new OwnerMergeError(
          `${nombre(from)} tiene cuenta en la app, así que esa ficha no puede ser la que se da de baja. Elige que se quede ella, o vincúlala desde «Vincular fichas».`,
        );
      }

      // Todo lo que es del cliente. Nada de esto tiene un único por usuario, así
      // que se mueve tal cual.
      const porUsuario = { where: { userId: fromId }, data: { userId: intoId } };
      const porDueno = { where: { ownerId: fromId }, data: { ownerId: intoId } };
      await tx.pet.updateMany(porDueno);
      await tx.reservation.updateMany(porDueno);
      await tx.review.updateMany(porDueno);
      await tx.quote.updateMany(porDueno);
      await tx.payment.updateMany(porUsuario);
      await tx.notification.updateMany(porUsuario);
      await tx.pushToken.updateMany(porUsuario);
      await tx.terminalCharge.updateMany(porUsuario);
      await tx.cart.updateMany(porUsuario);
      await tx.order.updateMany(porUsuario);
      await tx.productReview.updateMany(porUsuario);
      await tx.creditLedger.updateMany(porUsuario);
      await tx.reservationChangeRequest.updateMany({
        where: { requestedById: fromId },
        data: { requestedById: intoId },
      });
      await tx.petInvite.updateMany({ where: { invitedById: fromId }, data: { invitedById: intoId } });
      await tx.petInvite.updateMany({ where: { acceptedById: fromId }, data: { acceptedById: intoId } });
      await tx.petInvite.updateMany({ where: { revokedById: fromId }, data: { revokedById: intoId } });
      // Depósitos de Stripe ya sincronizados: la conciliación cruza cobro y
      // reserva por el dueño de la metadata (lib/payouts.ts). Sin esto, los
      // cobros de la ficha dada de baja saldrían "sin reserva asociada".
      await tx.stripePayoutLine.updateMany({
        where: { metaOwnerId: fromId },
        data: { metaOwnerId: intoId },
      });

      // Co-dueños, único (petId, userId): primero se quitan los que `into` ya
      // tiene, y al final los de perros que ahora son suyos (nadie es co-dueño
      // de su propio perro).
      const coDeFrom = await tx.petCoOwner.findMany({ where: { userId: fromId }, select: { petId: true } });
      if (coDeFrom.length > 0) {
        const yaDeInto = await tx.petCoOwner.findMany({
          where: { userId: intoId, petId: { in: coDeFrom.map((c) => c.petId) } },
          select: { petId: true },
        });
        await tx.petCoOwner.deleteMany({
          where: { userId: fromId, petId: { in: yaDeInto.map((c) => c.petId) } },
        });
        await tx.petCoOwner.updateMany(porUsuario);
      }
      const propios = await tx.pet.findMany({ where: { ownerId: intoId }, select: { id: true } });
      await tx.petCoOwner.deleteMany({
        where: { userId: intoId, petId: { in: propios.map((p) => p.id) } },
      });

      // Consentimientos: único (userId, documentType, version). Se mueven los
      // que `into` no tiene.
      const firmados = await tx.legalAcceptance.findMany({
        where: { userId: intoId },
        select: { documentType: true, version: true },
      });
      const ya = new Set(firmados.map((l) => `${l.documentType}@${l.version}`));
      const deFrom = await tx.legalAcceptance.findMany({
        where: { userId: fromId },
        select: { id: true, documentType: true, version: true },
      });
      const aMover = deFrom.filter((l) => !ya.has(`${l.documentType}@${l.version}`)).map((l) => l.id);
      if (aMover.length > 0) {
        await tx.legalAcceptance.updateMany({ where: { id: { in: aMover } }, data: { userId: intoId } });
      }

      // La ficha que se queda conserva lo suyo y completa lo que le falte.
      const adoptarCorreo = WALKIN_EMAIL_RE.test(into.email) && !WALKIN_EMAIL_RE.test(from.email);
      const telefono =
        opts.telefonoDe === "from" ? (from.phone ?? into.phone) : (into.phone ?? from.phone);
      const sinDomicilio = !into.address && into.addressLat == null;
      const conDomicilio = !!from.address || from.addressLat != null;
      const saldo = from.creditBalance;
      const hayTraspaso = !saldo.isZero();

      // `from` primero, y su correo se libera SIEMPRE: `users.email` es único y
      // hay dos lugares que buscan por correo sin mirar si la ficha está dada
      // de baja (el alta de la app en middleware/auth.ts y el checkout de
      // invitado del sitio). Si conservara su correo real, el cliente que se
      // registra con él quedaría atado a la ficha muerta: 403 para siempre. El
      // correo original queda en el log de la ruta.
      await tx.user.update({
        where: { id: fromId },
        data: {
          isActive: false,
          email: `fusionada+${from.id}@holidoginn.local`,
          // Incremento/decremento y no un valor absoluto: un movimiento de saldo
          // concurrente no se pierde.
          ...(hayTraspaso ? { creditBalance: { decrement: saldo } } : {}),
        },
      });
      const actualizado = await tx.user.update({
        where: { id: intoId },
        data: {
          ...(hayTraspaso
            ? { creditBalance: { increment: saldo }, lastCreditEntryAt: new Date() }
            : {}),
          ...(adoptarCorreo ? { email: from.email } : {}),
          ...(telefono !== into.phone ? { phone: telefono } : {}),
          ...(sinDomicilio && conDomicilio
            ? {
                address: from.address,
                addressLat: from.addressLat,
                addressLng: from.addressLng,
                addressPlaceId: from.addressPlaceId,
              }
            : {}),
        },
      });
      // El historial de la ficha que se queda ya trae los movimientos de la
      // otra (se movieron arriba); esta fila explica el salto del saldo.
      if (hayTraspaso) {
        await tx.creditLedger.create({
          data: {
            userId: intoId,
            type: "CREDIT_ADJUSTED",
            amount: saldo,
            balanceAfter: actualizado.creditBalance,
            description: `Saldo de la ficha repetida de ${nombre(from)}, que se juntó con esta`,
          },
        });
      }
      return actualizado;
    },
    { timeout: 15_000 },
  );
}
