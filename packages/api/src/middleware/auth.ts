import { FastifyRequest, FastifyReply } from "fastify";
import { getAuth, clerkClient } from "@clerk/fastify";
import type { PrismaClient, User } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: string;
    dbUser?: User;
  }
}

export function createAdminMiddleware() {
  return async function adminMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (request.userRole !== "ADMIN") {
      return reply
        .status(403)
        .send({ error: "Acceso restringido a administradores" });
    }
  };
}

export function createStaffMiddleware() {
  return async function staffMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (request.userRole !== "STAFF" && request.userRole !== "ADMIN") {
      return reply
        .status(403)
        .send({ error: "Acceso restringido a personal del hotel" });
    }
  };
}

// Resuelve (o crea/vincula) el usuario de la BD a partir del clerkUserId.
// Devuelve { user } en éxito o { error } con status/mensaje. Compartido por el
// middleware obligatorio y el opcional para no duplicar la lógica de vinculación.
async function resolveDbUserFromClerk(
  prisma: PrismaClient,
  clerkUserId: string
): Promise<{ user?: User; error?: { status: number; message: string } }> {
  let user = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
  });

  if (!user) {
    // Auto-create user from Clerk data (e.g. Google OAuth first login)
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    );

    if (!primaryEmail) {
      return { error: { status: 401, message: "No se encontró email en la cuenta" } };
    }

    const existingByEmail = await prisma.user.findUnique({
      where: { email: primaryEmail.emailAddress },
    });

    if (existingByEmail) {
      if (existingByEmail.clerkId && existingByEmail.clerkId !== clerkUserId) {
        return {
          error: { status: 409, message: "Este correo ya está vinculado a otra cuenta" },
        };
      }

      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { clerkId: clerkUserId },
      });
    } else {
      user = await prisma.user.create({
        data: {
          clerkId: clerkUserId,
          email: primaryEmail.emailAddress,
          firstName: clerkUser.firstName ?? "Usuario",
          lastName: clerkUser.lastName ?? "",
          role: "OWNER",
        },
      });
    }
  }

  // Cuenta desactivada por un admin → bloquear acceso por completo.
  if (!user.isActive) {
    return {
      error: { status: 403, message: "Tu cuenta está desactivada. Contacta al hotel." },
    };
  }

  return { user };
}

export function createAuthMiddleware(prisma: PrismaClient) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const { userId: clerkUserId } = getAuth(request);

    if (!clerkUserId) {
      return reply.status(401).send({ error: "No autorizado" });
    }

    const { user, error } = await resolveDbUserFromClerk(prisma, clerkUserId);
    if (error || !user) {
      return reply.status(error?.status ?? 401).send({ error: error?.message ?? "No autorizado" });
    }

    request.userId = user.id;
    request.userRole = user.role;
    request.dbUser = user;
  };
}

// Auth OPCIONAL: para rutas que aceptan tanto invitado como usuario logueado
// (carrito / checkout de la tienda). Si hay token Clerk válido, resuelve el
// usuario (request.userId definido); si no hay token, continúa como invitado
// (request.userId queda `undefined`). Una cuenta desactivada o un email ya
// vinculado a otra cuenta sí bloquean (mismo criterio de seguridad).
export function createOptionalAuthMiddleware(prisma: PrismaClient) {
  return async function optionalAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const { userId: clerkUserId } = getAuth(request);

    // Invitado: sin token. No tocar request.userId (queda undefined).
    if (!clerkUserId) return;

    const { user, error } = await resolveDbUserFromClerk(prisma, clerkUserId);
    if (error || !user) {
      return reply.status(error?.status ?? 401).send({ error: error?.message ?? "No autorizado" });
    }

    request.userId = user.id;
    request.userRole = user.role;
    request.dbUser = user;
  };
}
