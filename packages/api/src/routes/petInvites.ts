import { FastifyInstance } from "fastify";
import { Prisma } from "@holidoginn/db";
import { createAuthMiddleware, createOptionalAuthMiddleware } from "../middleware/auth";
import { notifyUser } from "../lib/notify";
import { invalidatePetAccessCache } from "../lib/petAccess";
import { takeQuota } from "../lib/quota";
import {
  MAX_CO_OWNERS,
  formatInviteCode,
  inviteExpiresAt,
  inviteShareText,
  inviteStatus,
  liveInviteWhere,
  newInviteCode,
  newInviteToken,
  normalizeInviteKey,
  publicInviteUrl,
} from "../lib/petInvite";

// Invitaciones para compartir una mascota, mandadas por el DUEÑO desde la app.
//
// Hasta aquí un perro solo se podía compartir si alguien del equipo lo
// vinculaba a mano (`/pets/:id/co-owners`, que sigue existiendo y sigue siendo
// solo de admin). Con esto el dueño manda una liga por WhatsApp y la otra
// persona queda vinculada al aceptarla, sin aprobación de nadie: el dueño es
// quien invita, a su propio perro.
//
// El co-dueño que entra por aquí es EXACTAMENTE el mismo que vincula el equipo
// (una fila de `pet_co_owners`), con los mismos permisos y la misma regla del
// pagador: el dinero no se junta.
//
// Errores: `{ error: <texto para la persona>, code: <CÓDIGO> }`, la convención
// que lee la app (apps/mobile/src/lib/api/client.ts). Al revés, el Alert
// enseñaba "INVITE_USED".

const QUOTA_WINDOW_MS = 10 * 60 * 1000;

const isTeam = (role?: string) => role === "ADMIN" || role === "STAFF";

/** Un código tecleado mide 8; un token de liga, 32. Ninguno se confunde con el otro. */
const looksLikeCode = (key: string) => key.length === 8;

class InviteGoneError extends Error {}
class CoOwnerCapError extends Error {}

type Db = Prisma.TransactionClient;

/**
 * Serializa en el perro todo lo que mueve el tope (crear y aceptar). Sin esto,
 * cinco invitaciones creadas a la vez veían el mismo lugar libre, y dos
 * aceptaciones simultáneas contaban los mismos co-dueños y entraban las dos.
 * El id es texto: nada de casts a int (ver el incidente 42883).
 */
async function lockPet(tx: Db, petId: string) {
  await tx.$queryRaw`SELECT id FROM "pets" WHERE id = ${petId} FOR UPDATE`;
}

/** Lugares libres del tope: co-dueños que ya están + invitaciones que siguen vivas. */
async function slotsLeft(db: Db, petId: string, now = new Date()) {
  const [linked, live] = await Promise.all([
    db.petCoOwner.count({ where: { petId } }),
    db.petInvite.count({ where: { petId, ...liveInviteWhere(now) } }),
  ]);
  return Math.max(0, MAX_CO_OWNERS - linked - live);
}

export default async function petInvitesRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const optionalAuth = createOptionalAuthMiddleware(prisma);

  /**
   * Busca por cualquiera de las dos llaves. El código se guarda en mayúsculas;
   * el token es hexadecimal en minúsculas, así que solo el código se sube de caja.
   */
  async function findInvite(rawKey: string) {
    const key = normalizeInviteKey(rawKey);
    if (!key || key.length > 64) return null;
    return prisma.petInvite.findFirst({
      where: looksLikeCode(key) ? { code: key.toUpperCase() } : { token: key },
      select: {
        id: true,
        code: true,
        invitedById: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        pet: { select: { id: true, name: true, photoUrl: true, ownerId: true, isActive: true } },
        invitedBy: { select: { firstName: true } },
      },
    });
  }

  const capMessage = (petName: string) =>
    `${petName} ya se comparte con el máximo de ${MAX_CO_OWNERS} personas (contando las invitaciones pendientes).`;

  // POST /pets/:id/invites — el dueño genera una liga para compartir su perro
  fastify.post<{ Params: { id: string } }>(
    "/pets/:id/invites",
    {
      preHandler: [authMiddleware],
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, ownerId: true, isActive: true },
      });
      if (!pet || !pet.isActive) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      // Solo el dueño. El co-dueño no invita a terceros (el perro no es suyo
      // para repartirlo) y el equipo tiene su propio camino, que vincula directo.
      if (pet.ownerId !== request.userId) {
        return reply.status(403).send({
          error: "Solo quien registró a la mascota puede invitar a alguien más.",
          code: "NOT_PET_OWNER",
        });
      }
      if (!takeQuota(`pet-invite:${request.userId}`, 5, QUOTA_WINDOW_MS)) {
        return reply.status(429).send({
          error: "Ya generaste varias invitaciones. Espera unos minutos.",
          code: "TOO_MANY_INVITES",
        });
      }

      // El código es corto y puede chocar con otro; se reintenta. Cada intento
      // es su propia transacción: después de un error Postgres ya no deja
      // seguir usando la misma. Con 31^8 combinaciones, que falle cinco veces
      // seguidas no es mala suerte.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const invite = await prisma.$transaction(async (tx) => {
            await lockPet(tx, pet.id);
            if ((await slotsLeft(tx, pet.id)) === 0) throw new CoOwnerCapError();
            return tx.petInvite.create({
              data: {
                petId: pet.id,
                invitedById: pet.ownerId,
                token: newInviteToken(),
                code: newInviteCode(),
                expiresAt: inviteExpiresAt(),
              },
              select: { id: true, token: true, code: true, expiresAt: true },
            });
          });
          const url = publicInviteUrl(invite.token);
          request.log.info(
            { tag: "pet-invite-created", petId: pet.id, inviteId: invite.id },
            "Invitación para compartir mascota"
          );
          return {
            id: invite.id,
            code: formatInviteCode(invite.code),
            url,
            expiresAt: invite.expiresAt,
            shareText: inviteShareText(
              pet.name,
              request.dbUser?.firstName ?? "Te",
              url,
              invite.code
            ),
          };
        } catch (err) {
          if (err instanceof CoOwnerCapError) {
            return reply.status(409).send({ error: capMessage(pet.name), code: "MAX_CO_OWNERS" });
          }
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            continue;
          }
          throw err;
        }
      }
      throw new Error("No se pudo generar un código de invitación único");
    }
  );

  // GET /pets/:id/invites — invitaciones vivas (dueño y equipo)
  fastify.get<{ Params: { id: string } }>(
    "/pets/:id/invites",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const pet = await prisma.pet.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, ownerId: true },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      const isOwner = pet.ownerId === request.userId;
      if (!isOwner && !isTeam(request.userRole)) {
        return reply.status(403).send({ error: "No tienes permiso" });
      }
      const now = new Date();
      const rows = await prisma.petInvite.findMany({
        where: { petId: pet.id, ...liveInviteWhere(now) },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          token: true,
          code: true,
          expiresAt: true,
          createdAt: true,
          invitedBy: { select: { firstName: true, lastName: true } },
        },
      });
      return {
        slotsLeft: await slotsLeft(prisma, pet.id, now),
        maxCoOwners: MAX_CO_OWNERS,
        invites: rows.map((r) => {
          // La liga (y el mensaje que la trae) solo al dueño, que es quien la
          // reenvía. Al equipo le basta el código para dar soporte; con la liga,
          // alguien del staff podría aceptarla desde una cuenta personal.
          const url = isOwner ? publicInviteUrl(r.token) : undefined;
          return {
            id: r.id,
            code: formatInviteCode(r.code),
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
            invitedBy: r.invitedBy,
            ...(url
              ? { url, shareText: inviteShareText(pet.name, r.invitedBy.firstName, url, r.code) }
              : {}),
          };
        }),
      };
    }
  );

  // DELETE /pets/:id/invites/:inviteId — cancelar una invitación (dueño o equipo)
  fastify.delete<{ Params: { id: string; inviteId: string } }>(
    "/pets/:id/invites/:inviteId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id: petId, inviteId } = request.params;
      const pet = await prisma.pet.findUnique({
        where: { id: petId },
        select: { ownerId: true },
      });
      if (!pet) {
        return reply.status(404).send({ error: "Mascota no encontrada" });
      }
      if (pet.ownerId !== request.userId && !isTeam(request.userRole)) {
        return reply.status(403).send({ error: "No tienes permiso" });
      }
      // Solo las vivas: cancelar una ya usada no deshace el vínculo (para eso
      // está quitar al co-dueño), y fingir que sí confundiría a quien lo pidió.
      const revoked = await prisma.petInvite.updateMany({
        where: { id: inviteId, petId, ...liveInviteWhere() },
        data: { revokedAt: new Date(), revokedById: request.userId },
      });
      if (revoked.count === 0) {
        return reply.status(404).send({
          error: "Esa invitación ya no está pendiente.",
          code: "INVITE_NOT_LIVE",
        });
      }
      return { ok: true };
    }
  );

  // GET /invites/:key — qué perro es y quién invita, para la página del sitio
  // (por token) y para la pantalla de aceptar de la app (por token o código).
  //
  // Devuelve lo mínimo para decidir: nombre y foto del perro y el nombre de
  // quien invita. Nada de salud, teléfonos ni historial: eso se ve DESPUÉS de
  // aceptar, cuando ya pasa por los permisos normales.
  //
  // Cubo de rate limit propio (una liga compartida en un grupo la abren varios
  // detrás del mismo NAT), pero con el keyGenerator GLOBAL: ése solo honra
  // `x-visitor-ip` si viene con el secreto del sitio.
  fastify.get<{ Params: { key: string } }>(
    "/invites/:key",
    {
      preHandler: [optionalAuth],
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const key = normalizeInviteKey(request.params.key);
      // El código es corto: buscarlo es la única forma de enumerarlo, así que
      // exige sesión y tiene cuota por persona. El token de la liga no la
      // necesita (128 bits no se adivinan) y la página del sitio lo abre sin
      // sesión.
      if (looksLikeCode(key)) {
        if (!request.userId) {
          return reply.status(401).send({ error: "No autorizado" });
        }
        if (!takeQuota(`invite-lookup:${request.userId}`, 20, QUOTA_WINDOW_MS)) {
          return reply.status(429).send({
            error: "Demasiados intentos. Espera unos minutos.",
            code: "TOO_MANY_ATTEMPTS",
          });
        }
      }
      const invite = await findInvite(key);
      if (!invite || !invite.pet.isActive) {
        return reply.status(404).send({
          error: "No encontramos esa invitación. Revisa el código.",
          code: "INVITE_NOT_FOUND",
        });
      }

      const viewerIsOwner = !!request.userId && invite.pet.ownerId === request.userId;
      let alreadyLinked = viewerIsOwner;
      if (request.userId && !viewerIsOwner) {
        alreadyLinked =
          (await prisma.petCoOwner.count({
            where: { petId: invite.pet.id, userId: request.userId },
          })) > 0;
      }

      return {
        status: inviteStatus(invite),
        code: formatInviteCode(invite.code),
        expiresAt: invite.expiresAt,
        pet: { name: invite.pet.name, photoUrl: invite.pet.photoUrl },
        invitedByFirstName: invite.invitedBy.firstName,
        alreadyLinked,
        // El dueño abriendo su propia liga (para probarla): no es "ya la
        // tienes", es "esta es la tuya, mándala".
        viewerIsOwner,
      };
    }
  );

  // POST /invites/:key/accept — la otra persona acepta y queda de co-dueño
  fastify.post<{ Params: { key: string } }>(
    "/invites/:key/accept",
    {
      preHandler: [authMiddleware],
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const userId = request.userId!;
      // Esta es la puerta donde se probaría un código tras otro: cuota por
      // persona además del rate limit por IP (CG-NAT, ver lib/quota.ts).
      if (!takeQuota(`invite-accept:${userId}`, 10, QUOTA_WINDOW_MS)) {
        return reply.status(429).send({
          error: "Demasiados intentos. Espera unos minutos.",
          code: "TOO_MANY_ATTEMPTS",
        });
      }
      // Misma regla que cuando vincula el equipo: se comparte con cuentas de
      // cliente. Una cuenta del equipo ve a todos los perros de todos modos.
      if (request.userRole !== "OWNER") {
        return reply.status(400).send({
          error: "Las invitaciones son para cuentas de cliente.",
          code: "NOT_OWNER_ROLE",
        });
      }

      const invite = await findInvite(request.params.key);
      if (!invite || !invite.pet.isActive) {
        return reply.status(404).send({
          error: "No encontramos esa invitación. Revisa el código.",
          code: "INVITE_NOT_FOUND",
        });
      }
      const pet = invite.pet;

      if (pet.ownerId === userId) {
        return reply.status(409).send({
          error: `${pet.name} ya está en tu cuenta: tú lo registraste. Esta invitación es para mandársela a alguien más.`,
          code: "ALREADY_OWNER",
        });
      }
      // Ya compartido (por otra invitación o porque el equipo lo vinculó): no
      // es un error y no se gasta la invitación, que puede ser para alguien más.
      const already = await prisma.petCoOwner.count({ where: { petId: pet.id, userId } });
      if (already > 0) {
        return { ok: true, petId: pet.id, petName: pet.name, alreadyLinked: true };
      }

      const usedMessage = "Esta invitación ya se usó. Pídele a quien te la mandó una nueva.";
      const status = inviteStatus(invite);
      if (status !== "valid") {
        const messages = {
          used: usedMessage,
          revoked: "Esta invitación se canceló. Pídele a quien te la mandó una nueva.",
          expired: "Esta invitación ya venció. Pídele a quien te la mandó una nueva.",
        } as const;
        return reply.status(409).send({
          error: messages[status],
          code: `INVITE_${status.toUpperCase()}`,
        });
      }

      const now = new Date();
      try {
        await prisma.$transaction(async (tx) => {
          await lockPet(tx, pet.id);
          // Se "gasta" la invitación con un update condicional: si dos personas
          // la aceptan a la vez, solo una encuentra la fila todavía viva.
          const claimed = await tx.petInvite.updateMany({
            where: { id: invite.id, ...liveInviteWhere(now) },
            data: { acceptedAt: now, acceptedById: userId },
          });
          if (claimed.count === 0) throw new InviteGoneError();

          // El tope se vuelve a mirar aquí: entre que se mandó la liga y hoy, el
          // equipo pudo haber vinculado a más gente a mano. La invitación que se
          // está aceptando ya salió de las "vivas", así que no se cuenta.
          const linked = await tx.petCoOwner.count({ where: { petId: pet.id } });
          if (linked >= MAX_CO_OWNERS) throw new CoOwnerCapError();

          await tx.petCoOwner.create({
            data: { petId: pet.id, userId, createdById: invite.invitedById },
          });
        });
      } catch (err) {
        if (err instanceof InviteGoneError) {
          return reply.status(409).send({ error: usedMessage, code: "INVITE_USED" });
        }
        if (err instanceof CoOwnerCapError) {
          return reply.status(409).send({
            error: `${pet.name} ya se comparte con el máximo de ${MAX_CO_OWNERS} personas.`,
            code: "MAX_CO_OWNERS",
          });
        }
        // Carrera con el equipo vinculándola a mano en el mismo segundo: el
        // resultado es el que la persona quería. La transacción ya revirtió el
        // sello de la invitación, así que queda libre.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { ok: true, petId: pet.id, petName: pet.name, alreadyLinked: true };
        }
        throw err;
      }

      // Los dos lados cambian de vista: el co-dueño gana la mascota y el dueño
      // empieza a ver las reservas que haga el otro.
      invalidatePetAccessCache(userId);
      invalidatePetAccessCache(pet.ownerId);

      request.log.info(
        { tag: "pet-invite-accepted", petId: pet.id, inviteId: invite.id, userId },
        "Invitación aceptada"
      );

      // Al dueño: que sepa quién entró, sobre todo si la liga se reenvió a
      // alguien que no esperaba. Desde ahí puede quitarlo.
      const who = [request.dbUser?.firstName, request.dbUser?.lastName].filter(Boolean).join(" ");
      await notifyUser(prisma, {
        userId: pet.ownerId,
        type: "GENERAL",
        title: `${who || "Alguien"} ya puede ver a ${pet.name} 🐾`,
        body: "Aceptó tu invitación. Si no lo conoces, puedes quitarlo desde la ficha de tu mascota.",
        data: { petId: pet.id, kind: "PET_CO_OWNER_JOINED" },
      });

      return { ok: true, petId: pet.id, petName: pet.name, alreadyLinked: false };
    }
  );
}
