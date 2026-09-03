import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@holidoginn/db";

/**
 * Autenticación de las rutas `/internal/*` (server-to-server).
 *
 * El admin web corre con OTRA instancia de Clerk y esta API no puede validar
 * sus tokens; el único puente es el `CRON_SECRET` compartido en la cabecera
 * `x-cron-secret` (mismo patrón que los crons y que `/internal/payouts-sync`).
 * Sin secreto configurado la ruta queda cerrada (401), nunca abierta.
 *
 * Quién hizo la acción viaja aparte en `x-actor-email`: se resuelve contra
 * `users.email` para atribuir la operación (auditoría, `courtesySetById`) y
 * para NO mandarle el aviso a quien acaba de hacer el cambio. Si el correo no
 * resuelve, el actor queda nulo y la operación sigue: la atribución es
 * deseable, no un requisito.
 */
export type InternalActor = {
  userId: string | null;
  email: string | null;
  role: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    internalActor?: InternalActor;
  }
}

export function internalSecretOk(request: FastifyRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers["x-cron-secret"] === secret;
}

export async function resolveInternalActor(
  prisma: PrismaClient,
  request: FastifyRequest
): Promise<InternalActor> {
  const raw = request.headers["x-actor-email"];
  const email = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase() || null;
  if (!email) return { userId: null, email: null, role: null };
  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, role: true },
    });
    return { userId: user?.id ?? null, email, role: user?.role ?? null };
  } catch (err) {
    request.log.warn({ err, email }, "[internal] no se pudo resolver x-actor-email");
    return { userId: null, email, role: null };
  }
}

/**
 * preHandler para las rutas internas: 401 sin secreto; con secreto resuelve el
 * actor y lo deja en `request.internalActor`.
 */
export function createInternalGuard(prisma: PrismaClient) {
  return async function internalGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!internalSecretOk(request)) {
      return reply.status(401).send({ error: "No autorizado", code: "UNAUTHORIZED" });
    }
    request.internalActor = await resolveInternalActor(prisma, request);
  };
}

/** Línea de log uniforme: `tag` + quién, para buscar en Railway. */
export function logInternal(
  request: FastifyRequest,
  tag: string,
  extra: Record<string, unknown> = {}
) {
  const actor = request.internalActor;
  request.log.info(
    {
      tag,
      actor: actor?.email ?? null,
      actorUserId: actor?.userId ?? null,
      ...extra,
    },
    tag
  );
}
