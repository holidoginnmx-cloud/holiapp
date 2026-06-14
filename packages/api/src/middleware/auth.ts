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

// Un nombre es "placeholder" si está vacío o es el genérico que usábamos antes.
const isPlaceholderName = (n?: string | null): boolean =>
  !n || !n.trim() || n.trim().toLowerCase() === "usuario";

// Mejor nombre disponible: Clerk → cuenta externa (Google/Apple) → parte local
// del email → "Usuario". Usa || (no ??) para cubrir también cadenas vacías,
// que es lo que devuelve Clerk cuando el proveedor no mapeó el nombre.
function pickNameFromClerk(
  clerkUser: {
    firstName?: string | null;
    lastName?: string | null;
    externalAccounts?: Array<{ firstName?: string | null; lastName?: string | null }>;
  },
  email: string
): { firstName: string; lastName: string } {
  const ext = clerkUser.externalAccounts?.[0];
  const firstName =
    clerkUser.firstName?.trim() ||
    ext?.firstName?.trim() ||
    (email.includes("@") ? email.split("@")[0] : "") ||
    "Usuario";
  const lastName = clerkUser.lastName?.trim() || ext?.lastName?.trim() || "";
  return { firstName, lastName };
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

  // clerkUser se obtiene perezosamente (solo cuando hace falta) y se cachea.
  let clerkUserCache: Awaited<ReturnType<typeof clerkClient.users.getUser>> | null = null;
  const getClerkUser = async () =>
    (clerkUserCache ??= await clerkClient.users.getUser(clerkUserId));

  if (!user) {
    // Auto-create user from Clerk data (e.g. Google OAuth first login)
    const clerkUser = await getClerkUser();
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    );

    if (!primaryEmail) {
      return { error: { status: 401, message: "No se encontró email en la cuenta" } };
    }

    const { firstName, lastName } = pickNameFromClerk(clerkUser, primaryEmail.emailAddress);

    const existingByEmail = await prisma.user.findUnique({
      where: { email: primaryEmail.emailAddress },
    });

    if (existingByEmail) {
      // El registro de la BD con este email ya está vinculado a OTRO clerkId.
      // Como Clerk verifica el email en OAuth/registro, el dueño del correo es
      // legítimo → re-vinculamos al clerkId actual en vez de bloquear. Esto
      // cubre: mismo correo con varios proveedores (Google/Apple generan Clerk
      // users distintos) y migración dev→prod sobre la misma BD compartida.
      // Solo bloqueamos si el email del usuario actual NO está verificado.
      const emailVerified =
        (primaryEmail as { verification?: { status?: string } }).verification?.status ===
        "verified";
      if (
        existingByEmail.clerkId &&
        existingByEmail.clerkId !== clerkUserId &&
        !emailVerified
      ) {
        return {
          error: { status: 409, message: "Este correo ya está vinculado a otra cuenta" },
        };
      }

      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          clerkId: clerkUserId,
          // Rellena el nombre si el registro existente (p.ej. creado antes en
          // dev / otra instancia) lo tenía vacío o genérico.
          ...(isPlaceholderName(existingByEmail.firstName) ? { firstName, lastName } : {}),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          clerkId: clerkUserId,
          email: primaryEmail.emailAddress,
          firstName,
          lastName,
          role: "OWNER",
        },
      });
    }
  } else if (isPlaceholderName(user.firstName)) {
    // Usuario ya vinculado pero con nombre vacío/placeholder (típico de cuentas
    // creadas en dev sobre la misma BD) → backfill una sola vez desde Clerk.
    const clerkUser = await getClerkUser();
    const primaryEmail = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId
    );
    const { firstName, lastName } = pickNameFromClerk(
      clerkUser,
      primaryEmail?.emailAddress ?? user.email
    );
    if (!isPlaceholderName(firstName)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { firstName, lastName },
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
