import { FastifyInstance } from "fastify";
import { CreateReviewSchema, type PendingReview } from "@holidoginn/shared";
import { createAuthMiddleware } from "../middleware/auth";
import { groupKeyOf } from "../lib/reviewRequest";

/**
 * La unidad de reseña es la VISITA, no la reservación: si el cliente trae tres
 * perros califica una sola vez y se escribe una fila por mascota con el mismo
 * `groupKey`. Las filas repetidas son deliberadas — cada una es una instancia de
 * servicio cobrada, y así el promedio por servicio del admin cuadra. Para
 * listarlas hay que agrupar por `groupKey`.
 */

/** Ventana de elegibilidad del pop-up: pasado un mes ya no se pregunta. */
const PENDING_WINDOW_MS = 30 * 86_400_000;

/** "Más tarde": 48 h, luego una semana, luego nunca más. */
const SNOOZE_STEPS_MS = [48 * 3_600_000, 7 * 86_400_000];
const SNOOZE_FOREVER_MS = 100 * 365 * 86_400_000;

export default async function reviewsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // ────────────────────────────────────────────────────────────
  //  GET /reviews/pending — la visita que espera calificación
  //
  //  Alimenta el pop-up que sale al abrir la app. Devuelve UNA sola visita (la
  //  más reciente) a propósito: encadenar modales para alguien que lleva tres
  //  visitas sin calificar es la forma más rápida de que desinstale la app.
  //
  //  Va ANTES de /reviews/:reservationId: Fastify prioriza la ruta estática de
  //  todos modos, pero dejarlo explícito evita que alguien lo rompa al mover
  //  bloques.
  // ────────────────────────────────────────────────────────────
  fastify.get(
    "/reviews/pending",
    { preHandler: [authMiddleware] },
    async (request) => {
      const desde = new Date(Date.now() - PENDING_WINDOW_MS);
      const candidates = await prisma.reservation.findMany({
        where: {
          ownerId: request.userId!,
          status: "CHECKED_OUT",
          review: { is: null },
          // Sólo lo que YA se anunció: si el push no salió (visita vieja, grupo
          // a medio cerrar), tampoco se asalta al cliente con el modal.
          reviewRequestedAt: { not: null },
          OR: [
            { reviewSnoozedUntil: null },
            { reviewSnoozedUntil: { lte: new Date() } },
          ],
          updatedAt: { gte: desde },
        },
        select: {
          id: true,
          groupId: true,
          reservationType: true,
          updatedAt: true,
          reviewPromptCount: true,
          pet: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 30,
      });

      if (candidates.length === 0) return { pending: null };

      // Agrupar en JS (no hay DISTINCT ON en Prisma): la primera del orden ya
      // es la visita más reciente.
      const first = candidates[0];
      const groupKey = groupKeyOf(first);
      const visita = candidates.filter((r) => groupKeyOf(r) === groupKey);

      const pending: PendingReview = {
        groupKey,
        reservationIds: visita.map((r) => r.id),
        reservationType: (first.reservationType ?? "STAY") as
          | "STAY"
          | "BATH"
          | "DAYCARE",
        petNames: visita.map((r) => r.pet?.name).filter(Boolean) as string[],
        endedAt: first.updatedAt,
        promptCount: first.reviewPromptCount,
      };
      return { pending };
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /reviews/snooze — "Más tarde"
  //  Antes el botón sólo cerraba el modal y reaparecía a la siguiente pantalla.
  // ────────────────────────────────────────────────────────────
  fastify.post<{ Body: { reservationId?: string } }>(
    "/reviews/snooze",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const reservationId = request.body?.reservationId;
      if (!reservationId) {
        return reply.status(400).send({ error: "Falta reservationId" });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        select: {
          id: true,
          groupId: true,
          ownerId: true,
          reviewPromptCount: true,
        },
      });
      if (!reservation) {
        return reply.status(404).send({ error: "Reservación no encontrada" });
      }
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }

      const promptCount = reservation.reviewPromptCount + 1;
      const step =
        SNOOZE_STEPS_MS[promptCount - 1] ?? SNOOZE_FOREVER_MS;
      const snoozedUntil = new Date(Date.now() + step);

      const targets = reservation.groupId
        ? { groupId: reservation.groupId, ownerId: reservation.ownerId }
        : { id: reservation.id };

      await prisma.reservation.updateMany({
        where: targets,
        data: { reviewSnoozedUntil: snoozedUntil, reviewPromptCount: promptCount },
      });

      return { snoozedUntil, promptCount };
    }
  );

  // ────────────────────────────────────────────────────────────
  //  POST /reviews — crear reseña de la visita
  //  El payload NO cambió (rating, comment, reservationId): el build que ya
  //  está en la App Store sigue funcionando y de paso gana el reparto al grupo.
  // ────────────────────────────────────────────────────────────
  fastify.post(
    "/reviews",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = CreateReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: parsed.data.reservationId },
        select: { id: true, groupId: true, ownerId: true, status: true },
      });
      if (!reservation) {
        return reply
          .status(404)
          .send({ error: "Reservación no encontrada" });
      }
      if (reservation.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      if (reservation.status !== "CHECKED_OUT") {
        return reply
          .status(400)
          .send({ error: "Solo puedes dejar reseña de un servicio ya finalizado" });
      }

      const groupKey = groupKeyOf(reservation);

      // Las hermanas de la visita que ya cerraron. Las canceladas o aún
      // adentro se quedan fuera: no hay servicio que calificar.
      const targets = reservation.groupId
        ? await prisma.reservation.findMany({
            where: {
              groupId: reservation.groupId,
              ownerId: reservation.ownerId,
              status: "CHECKED_OUT",
            },
            select: { id: true },
          })
        : [{ id: reservation.id }];

      // 409 por VISITA, no por reservación: entrar por otro perro del grupo no
      // habilita una segunda reseña.
      const existing = await prisma.review.findFirst({
        where: {
          OR: [
            { groupKey },
            { reservationId: { in: targets.map((t) => t.id) } },
          ],
        },
      });
      if (existing) {
        return reply
          .status(409)
          .send({ error: "Ya existe una reseña para esta visita" });
      }

      // `skipDuplicates` absorbe el doble tap y la carrera entre dos teléfonos.
      await prisma.review.createMany({
        data: targets.map((t) => ({
          rating: parsed.data.rating,
          comment: parsed.data.comment,
          reservationId: t.id,
          ownerId: request.userId!,
          groupKey,
        })),
        skipDuplicates: true,
      });

      // Ya calificó: si tenía un "Más tarde" vivo, deja de estorbar.
      await prisma.reservation.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { reviewSnoozedUntil: null },
      });

      const review = await prisma.review.findUnique({
        where: { reservationId: reservation.id },
      });
      // Respuesta aditiva: el build de la App Store lee el objeto Review tal
      // cual e ignora `appliedTo`.
      return reply
        .status(201)
        .send({ ...review, appliedTo: targets.length });
    }
  );

  // GET /reviews/:reservationId — obtener reseña por reservación (owner o staff/admin)
  fastify.get<{ Params: { reservationId: string } }>(
    "/reviews/:reservationId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const review = await prisma.review.findUnique({
        where: { reservationId: request.params.reservationId },
      });
      if (!review) {
        return reply.status(404).send({ error: "Reseña no encontrada" });
      }
      const isStaffOrAdmin =
        request.userRole === "ADMIN" || request.userRole === "STAFF";
      if (!isStaffOrAdmin && review.ownerId !== request.userId) {
        return reply.status(403).send({ error: "No autorizado" });
      }
      return review;
    }
  );
}
