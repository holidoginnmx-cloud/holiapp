import type { PrismaClient, NotificationType, Notification, Prisma } from "@holidoginn/db";
import { sendPushToUser, sendPushToUsers } from "./push";
import { petAudienceIds } from "./petAccess";

type NotifyData = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  /** Ver PushPayload.priority — solo afecta al push, no a la fila en DB. */
  priority?: "default" | "high";
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
    priority: opts.priority,
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
// Devuelve cuántos usuarios recibieron push real (tienen la app instalada con
// token). La notificación in-app se crea para todos; el push solo llega a los
// que tienen token.
export async function notifyUsers(
  prisma: PrismaClient,
  userIds: string[],
  payload: Omit<NotifyData, "userId">
): Promise<number> {
  if (userIds.length === 0) return 0;
  await prisma.notification.createMany({
    data: userIds.map((uid) => ({
      userId: uid,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
    })),
  });
  return await sendPushToUsers(prisma, userIds, {
    title: payload.title,
    body: payload.body,
    priority: payload.priority,
    data: {
      type: payload.type,
      ...(typeof payload.data === "object" && payload.data !== null ? payload.data : {}),
    },
  });
}

/**
 * Avisa a TODOS los que les toca esta mascota: el dueño y sus co-dueños (una
 * pareja que comparte perro, cada quien con su cuenta).
 *
 * Úsalo en lugar de `notifyUser(prisma, { userId: reservation.ownerId, ... })`
 * en todo aviso dirigido al CLIENTE: reportes, check-in/out, cartilla, pagos,
 * recordatorios. Si la mascota no tiene co-dueños se comporta exactamente
 * igual que antes.
 *
 * NO lo uses para avisos del equipo (cartilla pendiente de revisión, reserva
 * nueva, cambios de reserva entre staff): esos llevan copy interno y no deben
 * salir hacia el cliente. Para eso siguen `notifyUsers` y
 * `notifyTeamReservationUpdated`.
 */
export async function notifyPetAudience(
  prisma: PrismaClient,
  target: { petId: string; ownerId?: string },
  payload: Omit<NotifyData, "userId"> & { excludeUserId?: string }
): Promise<number> {
  const { excludeUserId, ...rest } = payload;
  let ids = await petAudienceIds(prisma, target.petId, target.ownerId);
  if (excludeUserId) ids = ids.filter((id) => id !== excludeUserId);
  return await notifyUsers(prisma, ids, rest);
}

/**
 * Igual, partiendo de una reserva: resuelve la mascota y su audiencia. Cae de
 * vuelta al dueño de la reserva si la reserva ya no existe.
 */
export async function notifyReservationAudience(
  prisma: PrismaClient,
  reservationId: string,
  payload: Omit<NotifyData, "userId"> & { excludeUserId?: string }
): Promise<number> {
  const res = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { petId: true, ownerId: true },
  });
  if (!res) return 0;
  return await notifyPetAudience(
    prisma,
    { petId: res.petId, ownerId: res.ownerId },
    payload
  );
}

/**
 * Avisa al RESTO del equipo (admins + staff asignado) de que una reserva
 * cambió, para que la caché de sus teléfonos se refresque sola.
 *
 * `kind: "RESERVATION_UPDATED"` es lo que busca el listener de push del móvil
 * (apps/mobile/src/lib/notificationInvalidate.ts). Sin este aviso, el otro
 * teléfono solo se enteraría al volver a entrar a la pantalla.
 *
 * Nunca lanza: el push es best-effort y no debe tumbar una edición ya escrita.
 * Nunca incluye texto de notas internas en el cuerpo.
 */
/**
 * Ids de TODO el equipo activo (ADMIN + STAFF), menos quien hizo el cambio.
 *
 * Fuente única de la audiencia interna. Existe porque cada camino resolvía la
 * suya con su propio `findMany` copiado, y así fue como los avisos de reserva
 * nueva terminaron filtrando `role: "STAFF"` cuando el equipo era ADMIN: no le
 * llegaban a nadie y nadie se enteró hasta que se pasó un check-in.
 */
export async function equipoActivoIds(
  prisma: PrismaClient,
  excluirUserId?: string | null
): Promise<string[]> {
  const team = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "ADMIN"] }, isActive: true },
    select: { id: true },
  });
  return team.map((u) => u.id).filter((id) => id !== excluirUserId);
}

export async function notifyTeamReservationUpdated(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    petName: string;
    body: string;
    actorUserId?: string | null;
    assignedStaffId?: string | null;
  }
) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    const ids = new Set(admins.map((a) => a.id));
    if (params.assignedStaffId) ids.add(params.assignedStaffId);
    if (params.actorUserId) ids.delete(params.actorUserId);
    const targets = [...ids];
    if (targets.length === 0) return;
    await notifyUsers(prisma, targets, {
      type: "GENERAL",
      title: `Reserva actualizada: ${params.petName}`,
      body: params.body,
      data: {
        reservationId: params.reservationId,
        kind: "RESERVATION_UPDATED",
      },
    });
  } catch (err) {
    console.error("[notifyTeamReservationUpdated] falló:", err);
  }
}
