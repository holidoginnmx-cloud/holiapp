import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAuthMiddleware } from "../middleware/auth";
import {
  LEGAL_DOC_VERSIONS,
  REQUIRED_FOR_BOOKING,
  ALL_DOC_TYPES,
  type LegalDocType,
} from "../lib/legal";

const AcceptSchema = z.object({
  documentType: z.enum(["TOS", "PRIVACY", "IMAGE_USE", "VET_AUTH"] as const),
  version: z.string().min(1).max(50),
});

export default async function legalRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);

  // GET /legal/documents — versiones vigentes + bandera de requerido
  fastify.get("/legal/documents", async () => {
    return ALL_DOC_TYPES.map((type) => ({
      type,
      version: LEGAL_DOC_VERSIONS[type],
      required: REQUIRED_FOR_BOOKING.includes(type),
    }));
  });

  // GET /legal/me/acceptances — aceptaciones registradas del usuario
  fastify.get(
    "/legal/me/acceptances",
    { preHandler: [authMiddleware] },
    async (request) => {
      const rows = await prisma.legalAcceptance.findMany({
        where: { userId: request.userId! },
        orderBy: { acceptedAt: "desc" },
      });
      return rows;
    }
  );

  // GET /legal/me/status — resumen de qué falta para poder reservar
  fastify.get(
    "/legal/me/status",
    { preHandler: [authMiddleware] },
    async (request) => {
      const rows = await prisma.legalAcceptance.findMany({
        where: { userId: request.userId! },
      });
      const acceptedSet = new Set(
        rows.map((r) => `${r.documentType}@${r.version}`)
      );
      const missing: LegalDocType[] = [];
      for (const type of REQUIRED_FOR_BOOKING) {
        const currentVersion = LEGAL_DOC_VERSIONS[type];
        if (!acceptedSet.has(`${type}@${currentVersion}`)) {
          missing.push(type);
        }
      }
      return {
        canBook: missing.length === 0,
        missing,
        versions: LEGAL_DOC_VERSIONS,
      };
    }
  );

  // POST /legal/acceptances — registrar aceptación (solo de versión vigente)
  fastify.post(
    "/legal/acceptances",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const parsed = AcceptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const { documentType, version } = parsed.data;

      // Solo permitir aceptar la versión vigente (evita que el cliente
      // "acepte" versiones viejas y salte el gate).
      const expected = LEGAL_DOC_VERSIONS[documentType];
      if (version !== expected) {
        return reply.status(400).send({
          error: `Versión no vigente. Actual: ${expected}`,
          expectedVersion: expected,
        });
      }

      // IP y user-agent para trazabilidad (evidencia legal).
      const ipAddress =
        (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
        request.ip ||
        null;
      const userAgent =
        typeof request.headers["user-agent"] === "string"
          ? request.headers["user-agent"]
          : null;

      const row = await prisma.legalAcceptance.upsert({
        where: {
          userId_documentType_version: {
            userId: request.userId!,
            documentType,
            version,
          },
        },
        update: {}, // idempotente — si ya aceptó, no cambiar acceptedAt
        create: {
          userId: request.userId!,
          documentType,
          version,
          ipAddress,
          userAgent,
        },
      });
      return reply.status(201).send(row);
    }
  );
}
