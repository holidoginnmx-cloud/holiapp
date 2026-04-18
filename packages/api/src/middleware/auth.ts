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

export function createAuthMiddleware(prisma: PrismaClient) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const { userId: clerkUserId } = getAuth(request);

    if (!clerkUserId) {
      return reply.status(401).send({ error: "No autorizado" });
    }

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
        return reply
          .status(401)
          .send({ error: "No se encontró email en la cuenta" });
      }

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

    request.userId = user.id;
    request.userRole = user.role;
    request.dbUser = user;
  };
}
