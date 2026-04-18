import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import type { PrismaClient } from "@holidoginn/db";

// Cliente global — Expo SDK es stateless, reutilizable.
const expo = new Expo();

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Envía una notificación push a todos los dispositivos registrados de un
 * usuario. Silencia fallas individuales (tokens caducos) y borra de la DB
 * cualquier token que Expo marque como inválido (DeviceNotRegistered).
 *
 * Nunca lanza — la notificación in-app ya se creó; el push es best-effort.
 */
export async function sendPushToUser(
  prisma: PrismaClient,
  userId: string,
  payload: PushPayload
): Promise<void> {
  const tokens = await prisma.pushToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = [];
  const invalidTokens: string[] = [];

  for (const { token } of tokens) {
    if (!Expo.isExpoPushToken(token)) {
      invalidTokens.push(token);
      continue;
    }
    messages.push({
      to: token,
      sound: "default",
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    });
  }

  if (invalidTokens.length > 0) {
    await prisma.pushToken.deleteMany({
      where: { token: { in: invalidTokens } },
    });
  }

  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  for (const chunk of chunks) {
    try {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    } catch (err) {
      console.error("[push] Error enviando chunk:", err);
    }
  }

  // Manejar tickets con error (DeviceNotRegistered → borrar)
  const tokensToDelete: string[] = [];
  tickets.forEach((ticket, idx) => {
    if (ticket.status === "error") {
      const details = ticket.details as { error?: string } | undefined;
      const msg = messages[idx];
      const toToken = typeof msg.to === "string" ? msg.to : null;
      if (details?.error === "DeviceNotRegistered" && toToken) {
        tokensToDelete.push(toToken);
      } else {
        console.warn(`[push] Ticket error: ${ticket.message}`);
      }
    }
  });

  if (tokensToDelete.length > 0) {
    await prisma.pushToken.deleteMany({
      where: { token: { in: tokensToDelete } },
    });
  }
}

/**
 * Envía push a un set arbitrario de userIds (útil para broadcasts).
 * Itera en paralelo — cada envío es tolerante a fallas.
 */
export async function sendPushToUsers(
  prisma: PrismaClient,
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  await Promise.all(
    userIds.map((uid) =>
      sendPushToUser(prisma, uid, payload).catch((err) => {
        console.error(`[push] Error para user ${uid}:`, err);
      })
    )
  );
}
