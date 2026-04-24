import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
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

const app = Fastify({ logger: true });

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
  origin: (origin, cb) => {
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

// Rate limit global: 100 req/min por IP
app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
  allowList: isDev ? ["127.0.0.1", "::1"] : [],
});

// Raw body capture (solo para el webhook de Stripe — requiere el body original
// sin parsear para validar la firma). Debe registrarse antes de las rutas.
app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true,
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
