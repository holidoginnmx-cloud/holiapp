import { FastifyInstance } from "fastify";
import { createAuthMiddleware, createOptionalAuthMiddleware } from "../middleware/auth";
import { placesAutocomplete, placeDetails } from "../lib/maps";
import { quoteDelivery } from "../lib/delivery";

export default async function deliveryRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  // Auth opcional para el proxy de Places + el quote: el invitado web (tienda)
  // necesita cotizar la recolección sin sesión. Estos endpoints no leen el
  // usuario; el móvil sigue mandando su token y se comporta igual.
  const optionalAuth = createOptionalAuthMiddleware(prisma);

  // ── GET /delivery/status — ¿el servicio está activo? ─────────
  // Gate ligero para que la app decida si mostrar la opción de domicilio
  // ANTES de tener una dirección (el quote requiere lat/lng).
  fastify.get(
    "/delivery/status",
    { preHandler: authMiddleware },
    async () => {
      const config = await prisma.deliveryConfig.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      return { active: config.isActive };
    }
  );

  // ── POST /delivery/places/autocomplete ──────────────────────
  fastify.post<{ Body: { input?: string; sessionToken?: string } }>(
    "/delivery/places/autocomplete",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const input = (request.body?.input ?? "").trim();
      if (input.length < 3) return { predictions: [] };
      try {
        const predictions = await placesAutocomplete(
          input,
          request.body?.sessionToken
        );
        return { predictions };
      } catch (err) {
        request.log.error(err);
        return reply
          .status(502)
          .send({ error: "No se pudo buscar la dirección" });
      }
    }
  );

  // ── POST /delivery/places/details ───────────────────────────
  fastify.post<{ Body: { placeId?: string; sessionToken?: string } }>(
    "/delivery/places/details",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const placeId = request.body?.placeId;
      if (!placeId) {
        return reply.status(400).send({ error: "placeId requerido" });
      }
      try {
        const details = await placeDetails(placeId, request.body?.sessionToken);
        return details;
      } catch (err) {
        request.log.error(err);
        return reply
          .status(502)
          .send({ error: "No se pudo obtener la dirección" });
      }
    }
  );

  // ── POST /delivery/quote — distancia + tarifa ────────────────
  // fee = baseFee + (distanciaKm redonda ida+vuelta × pricePerKm)
  fastify.post<{ Body: { lat?: number; lng?: number } }>(
    "/delivery/quote",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const { lat, lng } = request.body ?? {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return reply.status(400).send({ error: "lat/lng requeridos" });
      }

      try {
        return await quoteDelivery(prisma, lat as number, lng as number);
      } catch (err) {
        request.log.error(err);
        return reply
          .status(502)
          .send({ error: "No se pudo calcular la distancia" });
      }
    }
  );

  // ── GET /delivery/address — dirección guardada del cliente ───
  fastify.get(
    "/delivery/address",
    { preHandler: authMiddleware },
    async (request) => {
      const user = await prisma.user.findUnique({
        where: { id: request.userId! },
        select: {
          address: true,
          addressLat: true,
          addressLng: true,
          addressPlaceId: true,
        },
      });
      return user ?? {
        address: null,
        addressLat: null,
        addressLng: null,
        addressPlaceId: null,
      };
    }
  );

  // ── PUT /delivery/address — guardar dirección para futuras ───
  fastify.put<{
    Body: {
      address?: string;
      lat?: number;
      lng?: number;
      placeId?: string;
    };
  }>(
    "/delivery/address",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { address, lat, lng, placeId } = request.body ?? {};
      if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return reply
          .status(400)
          .send({ error: "address, lat y lng son requeridos" });
      }
      const user = await prisma.user.update({
        where: { id: request.userId! },
        data: {
          address,
          addressLat: lat as number,
          addressLng: lng as number,
          addressPlaceId: placeId ?? null,
        },
        select: {
          address: true,
          addressLat: true,
          addressLng: true,
          addressPlaceId: true,
        },
      });
      return user;
    }
  );
}
