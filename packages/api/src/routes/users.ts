import { FastifyInstance } from "fastify";
import { CreateUserSchema, UpdateUserSchema } from "@holidoginn/shared";
import { createAuthMiddleware, createAdminMiddleware } from "../middleware/auth";

export default async function usersRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];

  // GET /users — listar todos (solo admin)
  fastify.get("/users", { preHandler: adminAuth }, async (request) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });
    return users;
  });

  // GET /users/me — obtener usuario autenticado por token de Clerk
  fastify.get(
    "/users/me",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      return request.dbUser;
    }
  );

  // GET /users/me/credit-ledger — historial de saldo a favor del usuario autenticado
  fastify.get(
    "/users/me/credit-ledger",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      const entries = await prisma.creditLedger.findMany({
        where: { userId: request.userId! },
        orderBy: { createdAt: "desc" },
      });
      return entries;
    }
  );

  // PATCH /users/me/role — dev-only, permite al usuario autenticado cambiar su propio rol
  fastify.patch(
    "/users/me/role",
    { preHandler: [createAuthMiddleware(prisma)] },
    async (request, reply) => {
      if (process.env.NODE_ENV === "production") {
        return reply.status(403).send({ error: "No disponible en producción" });
      }

      const parsed = UpdateUserSchema.pick({ role: true }).safeParse(
        request.body
      );
      if (!parsed.success || !parsed.data.role) {
        return reply.status(400).send({ error: "role requerido" });
      }

      const updated = await prisma.user.update({
        where: { id: request.userId! },
        data: { role: parsed.data.role },
      });
      return updated;
    }
  );

  // GET /users/:id — obtener uno (solo admin)
  fastify.get<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
        include: { pets: true },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }
      return user;
    }
  );

  // POST /users — crear (solo admin)
  fastify.post("/users", { preHandler: adminAuth }, async (request, reply) => {
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      return reply
        .status(409)
        .send({ error: "Ya existe un usuario con ese email" });
    }

    const user = await prisma.user.create({ data: parsed.data });
    return reply.status(201).send(user);
  });

  // PATCH /users/:id — actualizar (solo admin)
  fastify.patch<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const parsed = UpdateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      if (parsed.data.email && parsed.data.email !== user.email) {
        const existing = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (existing) {
          return reply
            .status(409)
            .send({ error: "Ya existe un usuario con ese email" });
        }
      }

      const updated = await prisma.user.update({
        where: { id: request.params.id },
        data: parsed.data,
      });
      return updated;
    }
  );

  // DELETE /users/:id — desactivar (soft delete, solo admin)
  fastify.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!user) {
        return reply.status(404).send({ error: "Usuario no encontrado" });
      }

      const updated = await prisma.user.update({
        where: { id: request.params.id },
        data: { isActive: false },
      });
      return updated;
    }
  );
}
