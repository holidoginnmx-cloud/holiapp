import type { PrismaClient, NotificationType, Notification, Prisma } from "@holidoginn/db";
import { sendPushToUser, sendPushToUsers } from "./push";

type NotifyData = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
};

/**
 * Crea una Notification en DB Y dispara push. Usa esto en lugar de
 * `prisma.notification.create` siempre que quieras que el usuario se entere
 * en tiempo real, no solo al abrir la app.
 *
 * El push es best-effort: si no hay tokens, si Expo está caído, o si el
 * token está caduco, se loguea pero no falla.
 */
export async function notifyUser(
  prisma: PrismaClient,
  opts: NotifyData
): Promise<Notification> {
  const notif = await prisma.notification.create({
    data: {
      userId: opts.userId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      data: opts.data ?? undefined,
    },
  });
  await sendPushToUser(prisma, opts.userId, {
    title: opts.title,
    body: opts.body,
    data: {
      notificationId: notif.id,
      type: opts.type,
      ...(typeof opts.data === "object" && opts.data !== null ? opts.data : {}),
    },
  });
  return notif;
}

/**
 * Versión batch para broadcast (p.ej. todos los staff o todos los admins).
 */
export async function notifyUsers(
  prisma: PrismaClient,
  userIds: string[],
  payload: Omit<NotifyData, "userId">
): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((uid) => ({
      userId: uid,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    })),
  });
  await sendPushToUsers(prisma, userIds, {
    title: payload.title,
    body: payload.body,
    data: {
      type: payload.type,
      ...(typeof payload.data === "object" && payload.data !== null ? payload.data : {}),
    },
  });
}
