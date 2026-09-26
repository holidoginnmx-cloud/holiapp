import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAuthMiddleware } from "../middleware/auth";

/**
 * Rastro del flujo de pago de la app.
 *
 * El porqué: cuando un cliente reporta "se quedó cargando al pagar", hasta ahora
 * no quedaba NINGÚN rastro en producción. Lo único visible era el
 * `POST /payments/create-intent` y, después, silencio — imposible distinguir
 * "abandonó" de "la hoja de pago nunca se abrió".
 *
 * No hay tabla ni migración a propósito: esto se lee en los logs de Railway
 * buscando por `paymentIntentId`. Si algún día hace falta consultarlo desde el
 * admin, entonces sí un modelo en Prisma; meter una migración para esto sería
 * pagar un riesgo de base de datos por un diagnóstico.
 */

const EventSchema = z.object({
  event: z.string().max(40),
  at: z.number(),
  ms: z.number().optional(),
  flow: z.string().max(20),
  sessionId: z.string().max(40),
  paymentIntentId: z.string().max(80).optional(),
  code: z.string().max(80).optional(),
  detail: z.string().max(200).optional(),
});

const BodySchema = z.object({
  sessionId: z.string().max(40),
  app: z
    .object({
      version: z.string().max(20).nullable().optional(),
      platform: z.string().max(20).optional(),
      osVersion: z.string().max(20).optional(),
      updateId: z.string().max(80).nullable().optional(),
      runtimeVersion: z.string().max(20).nullable().optional(),
    })
    .optional(),
  events: z.array(EventSchema).max(50),
});

const UploadFailureSchema = z.object({
  screen: z.string().max(40),
  mediaType: z.enum(["image", "video"]),
  source: z.string().max(20).optional(),
  fileSize: z.number().nonnegative().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  httpStatus: z.number().int().nullable().optional(),
  message: z.string().max(200).nullable().optional(),
  detail: z.string().max(300).optional(),
  app: z
    .object({
      version: z.string().max(20).nullable().optional(),
      platform: z.string().max(20).optional(),
      updateId: z.string().max(80).nullable().optional(),
      runtimeVersion: z.string().max(20).nullable().optional(),
    })
    .optional(),
});

export default async function telemetryRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // POST /telemetry/payment — breadcrumbs de un intento de cobro.
  fastify.post(
    "/telemetry/payment",
    {
      preHandler: [authMiddleware],
      // Cuota propia: el tope global es por IP y no queremos que el diagnóstico
      // le robe peticiones al cobro, que es lo que de verdad importa.
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) {
        // 400 y no 500: un cliente viejo mandando basura no es un incidente.
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const { app, events } = parsed.data;

      // Cada evento ya trae su propio `sessionId`; el del cuerpo solo sirve para
      // validar que el lote viene de una sesión de pago.
      for (const event of events) {
        request.log.info(
          {
            tag: "payment-telemetry",
            userId: request.userId,
            app,
            ...event,
          },
          `[pago] ${event.flow} ${event.event}`,
        );
      }

      return reply.status(204).send();
    },
  );

  // POST /telemetry/upload — una subida de foto/video a Cloudinary que falló.
  //
  // Las subidas van directo del teléfono a Cloudinary, así que esta API nunca
  // veía el error: "no me dejó subir el video" llegaba sin nada que revisar
  // (25-sep-2026). Igual que el de pagos, solo a los logs de Railway; buscar
  // por `tag: "upload-failure"`.
  fastify.post(
    "/telemetry/upload",
    {
      preHandler: [authMiddleware],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = UploadFailureSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const failure = parsed.data;
      request.log.warn(
        { tag: "upload-failure", userId: request.userId, ...failure },
        `[subida] ${failure.screen} ${failure.mediaType} falló`,
      );
      return reply.status(204).send();
    },
  );
}

