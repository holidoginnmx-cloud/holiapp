import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import { clerkPlugin } from "@clerk/fastify";
import prismaPlugin from "./plugins/prisma";
import usersRoutes from "./routes/users";
import petsRoutes from "./routes/pets";
import roomsRoutes from "./routes/rooms";
import reservationsRoutes from "./routes/reservations";
import paymentsRoutes from "./routes/payments";
import stayUpdatesRoutes from "./routes/stayUpdates";
import notificationsRoutes from "./routes/notifications";
import adminRoutes from "./routes/admin";
import staffRoutes from "./routes/staff";
import reviewsRoutes from "./routes/reviews";
import servicesRoutes from "./routes/services";
import changeRequestsRoutes from "./routes/changeRequests";
import stripeWebhookRoutes from "./routes/stripeWebhooks";
import pushTokensRoutes from "./routes/pushTokens";
import legalRoutes from "./routes/legal";
import bathsRoutes from "./routes/baths";
import vaccineCatalogRoutes from "./routes/vaccineCatalog";
import deliveryRoutes from "./routes/delivery";
import productsRoutes from "./routes/products";
import cartRoutes from "./routes/cart";
import ordersRoutes from "./routes/orders";
import guestReservationsRoutes from "./routes/guestReservations";
import guestBathsRoutes from "./routes/guestBaths";
import daycareRoutes from "./routes/daycare";
import guestDaycareRoutes from "./routes/guestDaycare";
import quotesRoutes from "./routes/quotes";
import telemetryRoutes from "./routes/telemetry";
import internalReservationsRoutes from "./routes/internalReservations";
import pricingRoutes from "./routes/pricing";

// trustProxy: 1 → la API vive detrás del proxy de Railway (un salto). Sin
// esto, `request.ip` es la IP interna del proxy y TODOS los clientes comparten
// un solo cubo de rate limit (100 req/min para toda la app). Con un salto de
// confianza, `request.ip` toma la última IP que el proxy anexó a
// x-forwarded-for: la del cliente real, y no una que el cliente pueda inventar.
// (Función en vez de `trustProxy: 1` porque los tipos de Fastify 5.12 no
// aceptan número; `hop === 0` es exactamente "confía en un salto".)
const app = Fastify({
  logger: true,
  trustProxy: (_address: string, hop: number) => hop === 0,
});

// CORS: lista cerrada desde ALLOWED_ORIGINS (separada por comas).
// En desarrollo, si no se configura, se permite localhost y la red LAN
// (para que Expo Go en el celular llegue al backend).
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS?.trim();
const allowedOrigins = allowedOriginsEnv
  ? allowedOriginsEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

const isDev = process.env.NODE_ENV !== "production";
const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const lanRegex = /^https?:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(:\d+)?$/;

app.register(cors, {
  origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    // Permitir requests sin Origin (Expo dev client, curl, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (isDev && (localhostRegex.test(origin) || lanRegex.test(origin))) {
      return cb(null, true);
    }
    return cb(new Error(`Origen no permitido: ${origin}`), false);
  },
  credentials: true,
});

// Security headers
app.register(helmet, {
  // No servimos HTML, API pura — CSP por defecto de helmet está OK
  contentSecurityPolicy: false,
});

// Compresión de respuestas (gzip/brotli). Reduce el tamaño de los JSON de
// listas sobre redes móviles. Solo comprime payloads mayores a ~1KB.
app.register(compress, { global: true, threshold: 1024 });

// Rate limit global: 200 req/min por IP real. La app móvil de un admin activo
// (tablero cada 60 s, avisos cada 30 s, refetch por foco) ronda las decenas
// por minuto; 100 quedaba justo.
//
// Llave: el sitio público y el admin web llaman a la API desde SUS servidores
// (Vercel), así que para ellos `request.ip` es la IP de Vercel y todos sus
// visitantes caerían en un mismo cubo. Reenvían la IP del visitante en
// `x-visitor-ip` y se usa como llave cuando viene.
//
// Para que un cliente directo no rote ese header y se salte su límite, si
// existe VISITOR_IP_SECRET solo se honra cuando viene acompañado de
// `x-visitor-ip-secret` con ese valor (el sitio lo manda desde su servidor).
// Sin la variable configurada se honra siempre (mejor eso que un cubo global).
const visitorIpSecret = process.env.VISITOR_IP_SECRET?.trim() || null;
app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
  allowList: isDev ? ["127.0.0.1", "::1"] : [],
  keyGenerator: (request: FastifyRequest) => {
    const visitor = request.headers["x-visitor-ip"];
    const first = Array.isArray(visitor) ? visitor[0] : visitor;
    const ip = first?.split(",")[0]?.trim();
    if (!ip || ip.length > 64) return request.ip;
    if (visitorIpSecret) {
      const given = request.headers["x-visitor-ip-secret"];
      const secret = Array.isArray(given) ? given[0] : given;
      if (secret !== visitorIpSecret) return request.ip;
    }
    return ip;
  },
});

// Raw body capture (solo para el webhook de Stripe — requiere el body original
// sin parsear para validar la firma). Debe registrarse antes de las rutas.
app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true,
});

// Manejador global: cualquier throw no capturado se loguea completo pero al
// cliente solo le llega un mensaje genérico (nunca err.message crudo, que puede
// filtrar SQL, rutas de archivo o detalles de Stripe). Los errores con
// statusCode < 500 (validación de zod vía fastify, rate-limit 429, CORS) sí
// conservan su mensaje: son respuestas pensadas para el cliente.
app.setErrorHandler((err: FastifyError, request, reply) => {
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error({ err, url: request.url, method: request.method });
    return reply.status(statusCode).send({ error: "Error interno del servidor" });
  }
  return reply.status(statusCode).send({ error: err.message });
});

app.register(clerkPlugin);
app.register(prismaPlugin);

// Health check
app.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Routes
app.register(usersRoutes);
app.register(petsRoutes);
app.register(roomsRoutes);
app.register(reservationsRoutes);
app.register(paymentsRoutes);
app.register(stayUpdatesRoutes);
app.register(notificationsRoutes);
app.register(adminRoutes);
app.register(staffRoutes);
app.register(reviewsRoutes);
app.register(servicesRoutes);
app.register(changeRequestsRoutes);
app.register(stripeWebhookRoutes);
app.register(pushTokensRoutes);
app.register(legalRoutes);
app.register(bathsRoutes);
app.register(vaccineCatalogRoutes);
app.register(deliveryRoutes);
app.register(productsRoutes);
app.register(cartRoutes);
app.register(ordersRoutes);
app.register(guestReservationsRoutes);
app.register(guestBathsRoutes);
app.register(daycareRoutes);
app.register(guestDaycareRoutes);
app.register(quotesRoutes);
app.register(telemetryRoutes);
app.register(internalReservationsRoutes);
app.register(pricingRoutes);

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 4000;
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
