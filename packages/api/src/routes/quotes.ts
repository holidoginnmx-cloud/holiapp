/**
 * Cotizaciones — rutas.
 *
 * Una sola implementación detrás de TRES puertas:
 *
 *   adminAuth       /quotes/*            → app móvil (token de Clerk)
 *   x-cron-secret   /internal/quotes/*   → admin web
 *   sin auth        /public/quotes/:token → el cliente, por el link de WhatsApp
 *
 * El espejo /internal existe porque el admin web usa OTRA instancia de Clerk y
 * no puede presentar un token que esta API valide — mismo patrón que
 * PATCH /internal/baths/:id/appointment. Los handlers se registran con un loop
 * sobre un arreglo de descriptores para que las dos puertas no puedan
 * divergir: agregar un endpoint en una lo agrega en la otra.
 *
 * Cotizar es fijar precio, así que la puerta autenticada es ADMIN y no STAFF
 * (misma línea que separa "el staff registra reservas" de "el staff no toca
 * tarifas, cortesías ni ingresos").
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import {
  CreateQuoteSchema,
  QuotePreviewSchema,
  UpdateQuoteSchema,
} from "@holidoginn/shared";
import { createAdminMiddleware, createAuthMiddleware } from "../middleware/auth";
import {
  buildWhatsappMessage,
  createQuote,
  deleteQuote,
  getQuote,
  getQuoteByToken,
  isBotUserAgent,
  listQuotes,
  markQuoteConverted,
  markQuoteSent,
  previewQuote,
  publicQuoteUrl,
  registerQuoteView,
  renderQuote,
  updateQuote,
  type PublicQuoteContext,
  type QuoteFailure,
  type QuoteWithRelations,
} from "../lib/quotes";
import { buildQuotePrefill } from "../lib/quoteToReservation";

export default async function quotesRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const adminMiddleware = createAdminMiddleware();
  const adminAuth = [authMiddleware, adminMiddleware];

  // ── Contexto de marca para la página pública y el PDF ────────
  // El nombre sale de hotel_config (editable) y el WhatsApp del entorno, que es
  // donde ya vive el número del negocio para los otros canales.
  async function publicContext(): Promise<PublicQuoteContext> {
    const cfg = await prisma.hotelConfig.findFirst();
    return {
      hotelName: cfg?.hotelName ?? "Holidog Inn",
      hotelPhone: process.env.HOTEL_PHONE ?? "662 205 7580",
      whatsappNumber: process.env.HOTEL_WHATSAPP ?? "5216622057580",
    };
  }

  /** Traduce el resultado de la capa de lógica al código HTTP que le toca. */
  function fail(reply: FastifyReply, result: QuoteFailure) {
    const status =
      result.kind === "NOT_FOUND" ? 404 : result.kind === "CONFLICT" ? 409 : 400;
    return reply.status(status).send({
      error: result.message,
      ...(result.code ? { code: result.code } : {}),
    });
  }

  /** Respuesta estándar del detalle: la cotización más lo que la UI necesita. */
  function quotePayload(quote: QuoteWithRelations) {
    const url = publicQuoteUrl(quote.token);
    return {
      quote,
      publicUrl: url,
      // Mensaje listo para el operador. Se arma aquí y no en el cliente para
      // que móvil y web manden exactamente el mismo texto.
      whatsappMessage: buildWhatsappMessage(
        {
          folio: quote.folio,
          clientName: quote.clientName,
          total: Number(quote.total),
          serviceType: quote.reservationType,
        },
        url
      ),
      isExpired: quote.validUntil.getTime() < Date.now(),
      // Formulario de reserva ya lleno, para el botón "Convertir en
      // reservación". Se arma en el servidor (y no en cada cliente) para que
      // móvil y web precarguen exactamente lo mismo.
      prefill: buildQuotePrefill(quote),
    };
  }

  // ─── Handlers (compartidos por las dos puertas privadas) ─────

  const handlers: Record<string, RouteHandlerMethod> = {
    // POST /quotes/preview — calcula SIN guardar. Alimenta el total en vivo del
    // formulario, con debounce del lado del cliente.
    preview: async (request, reply) => {
      const parsed = QuotePreviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const result = await previewQuote(prisma, parsed.data);
      if (!result.ok) return fail(reply, result);
      return {
        breakdown: result.breakdown,
        delivery: result.delivery,
        discount: result.discount,
        discountError: result.discountError,
      };
    },

    create: async (request, reply) => {
      const parsed = CreateQuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const actorId = await resolveActor(request);
      if (!actorId) {
        // Solo posible en una base sin ningún admin activo.
        return reply.status(500).send({ error: "No hay un usuario al que atribuir la cotización" });
      }
      const result = await createQuote(prisma, parsed.data, actorId);
      if (!result.ok) return fail(reply, result);
      return reply.status(201).send(quotePayload(result.quote));
    },

    list: async (request) => {
      const q = request.query as Record<string, string | undefined>;
      const { quotes, total } = await listQuotes(prisma, {
        status: q.status as never,
        bucket: q.bucket as never,
        search: q.q,
        ownerId: q.ownerId,
        take: q.take ? Number(q.take) : undefined,
        skip: q.skip ? Number(q.skip) : undefined,
      });
      const now = Date.now();
      return {
        total,
        quotes: quotes.map((quote) => ({
          ...quote,
          publicUrl: publicQuoteUrl(quote.token),
          isExpired: quote.validUntil.getTime() < now,
        })),
      };
    },

    detail: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await getQuote(prisma, id);
      if (!result.ok) return fail(reply, result);
      return quotePayload(result.quote);
    },

    update: async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateQuoteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const result = await updateQuote(prisma, id, parsed.data);
      if (!result.ok) return fail(reply, result);
      return quotePayload(result.quote);
    },

    // POST /quotes/:id/send — sella el envío (DRAFT → SENT, sentAt, sentCount).
    // Es idempotente en el estado: reenviar no regresa a SENT una convertida.
    send: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await markQuoteSent(prisma, id);
      if (!result.ok) return fail(reply, result);
      return quotePayload(result.quote);
    },

    // POST /quotes/:id/converted — cierra el círculo desde el ADMIN WEB, que
    // crea sus reservas escribiendo directo a Supabase y por eso no pasa por
    // POST /reservations (donde el móvil manda `quoteId`). Sin esto la
    // cotización se queda vigente y alguien la convierte por segunda vez.
    converted: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { reservationId?: string; groupId?: string };
      const actual = await getQuote(prisma, id);
      if (!actual.ok) return fail(reply, actual);
      if (actual.quote.status === "CONVERTED") {
        // Idempotente: reintentar no debe ser un error para el llamador.
        return quotePayload(actual.quote);
      }
      await markQuoteConverted(
        prisma,
        id,
        { id: body.reservationId ?? "", groupId: body.groupId ?? null },
        await resolveActor(request),
      );
      const despues = await getQuote(prisma, id);
      if (!despues.ok) return fail(reply, despues);
      return quotePayload(despues.quote);
    },

    cancel: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await updateQuote(prisma, id, { status: "CANCELLED" });
      if (!result.ok) return fail(reply, result);
      return quotePayload(result.quote);
    },

    remove: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await deleteQuote(prisma, id);
      if (!result.ok) return fail(reply, result);
      return reply.status(204).send();
    },

    // GET /quotes/:id/html — el documento tal como lo verá el cliente, para el
    // "Ver como cliente" del admin y para que la app móvil se lo pase a
    // expo-print. Se sirve el MISMO html de la página pública: el PDF y la web
    // no pueden desincronizarse porque salen del mismo render.
    html: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { target } = request.query as { target?: string };
      const result = await getQuote(prisma, id);
      if (!result.ok) return fail(reply, result);
      const { dto, html } = renderQuote(
        result.quote,
        await publicContext(),
        target === "pdf" ? "pdf" : "web"
      );
      return { quote: dto, html, publicUrl: publicQuoteUrl(result.quote.token) };
    },
  };

  /**
   * Quién cotiza. La app móvil llega con su token de Clerk y `request.userId`
   * ya resuelto; el admin web NO — su Clerk es otra instancia y la puerta
   * /internal solo valida el secreto compartido, así que ahí `request.userId`
   * es siempre undefined.
   *
   * Por eso el admin web manda `actorEmail` (el correo de su sesión, que es la
   * llave de su lista de acceso) y aquí se resuelve al usuario de la base. Si
   * ese correo no tiene cuenta —pasa: el admin web autoriza por lista, no por
   * fila en `users`— se cae al primer admin activo, porque `createdById` es NOT
   * NULL y quedarse sin actor haría fallar TODA la creación desde la web.
   */
  async function resolveActor(request: FastifyRequest): Promise<string | null> {
    if (request.userId) return request.userId;

    const body = request.body as { actorEmail?: string; actorId?: string } | undefined;
    if (body?.actorId) return body.actorId;

    const email = body?.actorEmail?.trim().toLowerCase();
    if (email) {
      const porEmail = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (porEmail) return porEmail.id;
    }

    const fallback = await prisma.user.findFirst({
      where: { role: "ADMIN", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (fallback) {
      request.log.warn(
        { actorEmail: email ?? null },
        "[quotes] sin actor resoluble; se atribuye al admin más antiguo",
      );
      return fallback.id;
    }
    return null;
  }

  // ─── Registro: las mismas rutas en las dos puertas ───────────

  const ROUTES: {
    method: "get" | "post" | "patch" | "delete";
    path: string;
    handler: keyof typeof handlers;
  }[] = [
    { method: "post", path: "/quotes/preview", handler: "preview" },
    { method: "post", path: "/quotes", handler: "create" },
    { method: "get", path: "/quotes", handler: "list" },
    { method: "get", path: "/quotes/:id", handler: "detail" },
    { method: "get", path: "/quotes/:id/html", handler: "html" },
    { method: "patch", path: "/quotes/:id", handler: "update" },
    { method: "post", path: "/quotes/:id/send", handler: "send" },
    { method: "post", path: "/quotes/:id/converted", handler: "converted" },
    { method: "post", path: "/quotes/:id/cancel", handler: "cancel" },
    { method: "delete", path: "/quotes/:id", handler: "remove" },
  ];

  // Puerta 1 — app móvil, ADMIN autenticado con Clerk.
  for (const route of ROUTES) {
    fastify[route.method](route.path, { preHandler: adminAuth }, handlers[route.handler]);
  }

  // Puerta 2 — admin web, server-to-server. Si CRON_SECRET no está configurado
  // la puerta queda CERRADA (401), nunca abierta.
  const internalAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers["x-cron-secret"] !== secret) {
      return reply.status(401).send({ error: "No autorizado" });
    }
  };
  for (const route of ROUTES) {
    fastify[route.method](
      `/internal${route.path}`,
      { preHandler: internalAuth },
      handlers[route.handler]
    );
  }

  // ─── Puerta 3 — pública, sin auth ────────────────────────────
  //
  // La protege el token de 128 bits del link. Devuelve JSON con el DTO público
  // (construido por allowlist en buildPublicQuote) y el HTML ya renderizado,
  // que es lo que el sitio inyecta en /cotizacion/[token].
  //
  // Cubo de rate limit PROPIO: un link compartido en un grupo de WhatsApp lo
  // abren varias personas detrás del mismo NAT, y eso no debe consumir el cupo
  // global de la API que usa la app.
  fastify.get<{ Params: { token: string } }>(
    "/public/quotes/:token",
    {
      config: {
        rateLimit: {
          max: 240,
          timeWindow: "1 minute",
          // ⚠️ Quien llama NO es el cliente: es el servidor de Next del sitio
          // público, que hace el fetch server-side. Sin esto, TODOS los
          // visitantes comparten un solo cubo por la IP de Vercel y basta un
          // curl en bucle para dejar a todo cliente con un 429 al abrir su
          // cotización. El sitio reenvía la IP real en x-visitor-ip.
          keyGenerator: (request: FastifyRequest) =>
            (request.headers["x-visitor-ip"] as string | undefined)?.split(",")[0]?.trim() ||
            request.ip,
        },
      },
    },
    async (request, reply) => {
      const quote = await getQuoteByToken(prisma, request.params.token);
      if (!quote) {
        return reply.status(404).send({ error: "Cotización no encontrada" });
      }

      // El scraper de WhatsApp abre el link para armar la tarjeta de preview:
      // contarlo como visita convertiría la señal de venta en ruido.
      //
      // Igual que arriba, el User-Agent de ESTA petición es el del servidor de
      // Next; el del visitante llega reenviado en x-visitor-ua. Sin él no se
      // puede distinguir un bot de una persona, así que el contador de "la
      // abrió N veces" contaría scrapers.
      const visitorUa =
        (request.headers["x-visitor-ua"] as string | undefined) ??
        (request.headers["user-agent"] as string | undefined);
      if (!isBotUserAgent(visitorUa)) {
        void registerQuoteView(prisma, quote.id, quote.firstViewedAt != null);
      }

      const { dto, html } = renderQuote(quote, await publicContext(), "web");
      return { quote: dto, html };
    }
  );
}
