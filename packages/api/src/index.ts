import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
