import { FastifyInstance } from "fastify";
import { createAuthMiddleware, createAdminMiddleware, invalidateAuthCache } from "../middleware/auth";
import { invalidatePetAccessCache } from "../lib/petAccess";
import { mergePetInto, PetMergeError } from "../lib/petMerge";
import { mergeOwnerInto, OwnerMergeError } from "../lib/ownerMerge";

// ─────────────────────────────────────────────────────────────────────────────
//  Juntar lo que el equipo capturó dos veces (solo ADMIN)
//
//  El doble chequeo de sep-2026 encontró repetidos que no venían de la app:
//  "SKY" y "Sky Velazquez" (la misma Chihuahua de Baltasar Soto, con historial
//  en las dos) y dos fichas de Francisco Acosta. La única fusión que existía
//  era la de "Vincular fichas", que siempre absorbe una cuenta de la app.
//
//  Solo ADMIN, como vincular: juntar mueve historial, reservas y saldo, y no
//  se deshace.
// ─────────────────────────────────────────────────────────────────────────────

export default async function adminMergeRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const adminAuth = [createAuthMiddleware(prisma), createAdminMiddleware()];

  // POST /admin/pets/:id/merge — el perro :id se junta en `intoId` (que se queda).
  fastify.post<{ Params: { id: string }; Body: { intoId?: string; useSourceName?: boolean } }>(
    "/admin/pets/:id/merge",
    { preHandler: adminAuth },
    async (request, reply) => {
      const fromId = request.params.id;
      const intoId = request.body?.intoId;
      if (!intoId) return reply.status(400).send({ error: "Falta con cuál perro juntarlo" });

      const [from, into] = await Promise.all([
        prisma.pet.findUnique({ where: { id: fromId }, select: { id: true, ownerId: true, isActive: true } }),
        prisma.pet.findUnique({ where: { id: intoId }, select: { id: true, ownerId: true, isActive: true } }),
      ]);
      if (!from || !into) return reply.status(404).send({ error: "Mascota no encontrada" });
      if (!from.isActive) return reply.status(409).send({ error: "Esa mascota ya está dada de baja." });
      // Entre clientes distintos primero van las fichas: si no, el historial
      // del perro quedaría repartido entre dos dueños.
      if (from.ownerId !== into.ownerId) {
        return reply.status(409).send({
          error: "Son de fichas de cliente distintas. Primero junta las fichas del cliente y luego los perros.",
        });
      }

      try {
        const { copiedFields } = await prisma.$transaction(
          (tx) => mergePetInto(tx, fromId, intoId, { useSourceName: request.body?.useSourceName === true }),
          { timeout: 15_000 },
        );
        // Los co-dueños del perro dado de baja pasaron al que se queda.
        invalidatePetAccessCache();
        request.log.info(
          { tag: "pet-merged", fromId, intoId, copiedFields, by: request.userId },
          "[merge] perros juntados por el equipo",
        );
        return reply.send(await prisma.pet.findUnique({ where: { id: intoId } }));
      } catch (err) {
        if (err instanceof PetMergeError) return reply.status(409).send({ error: err.message });
        throw err;
      }
    },
  );

  // POST /admin/users/:id/merge — la ficha :id se junta en `intoId` (que se
  // queda). `telefono`: de cuál ficha se queda el teléfono si las dos tienen.
  fastify.post<{ Params: { id: string }; Body: { intoId?: string; telefono?: "from" | "into" } }>(
    "/admin/users/:id/merge",
    { preHandler: adminAuth },
    async (request, reply) => {
      const fromId = request.params.id;
      const intoId = request.body?.intoId;
      if (!intoId) return reply.status(400).send({ error: "Falta con cuál ficha juntarla" });
      // Lo que la ficha dada de baja pierde (su correo se libera): queda en el
      // log para poder rastrear quién era.
      const antes = await prisma.user.findUnique({
        where: { id: fromId },
        select: { email: true, phone: true },
      });
      try {
        const merged = await mergeOwnerInto(prisma, fromId, intoId, {
          telefonoDe: request.body?.telefono === "from" ? "from" : "into",
        });
        invalidateAuthCache(merged.clerkId);
        invalidatePetAccessCache();
        request.log.info(
          {
            tag: "owner-merged",
            fromId,
            intoId,
            fromEmail: antes?.email,
            fromPhone: antes?.phone,
            by: request.userId,
          },
          "[merge] fichas de cliente juntadas por el equipo",
        );
        return reply.send(merged);
      } catch (err) {
        if (err instanceof OwnerMergeError) return reply.status(409).send({ error: err.message });
        throw err;
      }
    },
  );
}
