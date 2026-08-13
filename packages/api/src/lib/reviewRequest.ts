/**
 * Pedirle al dueño que califique una visita que ya terminó.
 *
 * Único lugar donde se decide CUÁNDO y CÓMO se pide reseña. Antes el push vivía
 * inline en el checkout de hospedaje (`staff.ts`) y en el auto-checkout, con dos
 * consecuencias:
 *
 *   1. Baño y guardería nunca pedían reseña — se cerraban con `CHECKED_OUT` y
 *      ya. La mitad del negocio quedaba sin medir.
 *   2. Una visita de 3 perros mandaba 3 pushes idénticos, porque el aviso salía
 *      por reservación y no por visita.
 *
 * Ahora la unidad es la VISITA (el `groupId` completo) y se pide UNA sola vez,
 * cuando todas las hermanas ya cerraron. Para agregar un camino nuevo de cierre
 * basta llamar a `requestReview` — no resolver el push a mano.
 */
import type { PrismaClient, Prisma } from "@holidoginn/db";
import { REVIEW_COPY, reviewWho } from "@holidoginn/shared";
import { notifyUser } from "./notify";

type Db = PrismaClient | Prisma.TransactionClient;

/** `groupId` si la visita es multi-mascota; si no, la reservación misma. */
export function groupKeyOf(r: { id: string; groupId: string | null }): string {
  return r.groupId ?? r.id;
}

/**
 * Manda el aviso de "califica tu visita" si corresponde. Idempotente y seguro
 * de llamar de más: devuelve `false` sin efectos si ya se pidió, si la visita
 * aún no termina o si ya hay reseña.
 *
 * NO lanza: un fallo aquí nunca debe tumbar un check-out.
 */
export async function requestReview(
  prisma: Db,
  reservationId: string,
): Promise<boolean> {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        groupId: true,
        ownerId: true,
        status: true,
        reservationType: true,
        reviewRequestedAt: true,
        pet: { select: { name: true } },
      },
    });
    if (!reservation) return false;

    // La visita completa: todas las reservaciones del grupo (una por mascota).
    const siblings = reservation.groupId
      ? await prisma.reservation.findMany({
          where: {
            groupId: reservation.groupId,
            ownerId: reservation.ownerId,
          },
          select: {
            id: true,
            status: true,
            reservationType: true,
            reviewRequestedAt: true,
            pet: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [reservation];

    // Ya se pidió (por cualquiera de las hermanas).
    if (siblings.some((r) => r.reviewRequestedAt !== null)) return false;

    // La visita no ha terminado: alguna mascota sigue dentro. Se reintentará
    // cuando cierre la última — así el cliente recibe un solo aviso y, al
    // calificar, todas las hermanas ya son elegibles para su fila de reseña.
    const active = siblings.filter((r) => r.status !== "CANCELLED");
    if (active.length === 0) return false;
    if (active.some((r) => r.status !== "CHECKED_OUT")) return false;

    const groupKey = groupKeyOf(reservation);

    // Ya calificada (p.ej. el cliente entró al detalle y reseñó antes de que
    // corriera el barrido).
    const existing = await prisma.review.findFirst({
      where: { OR: [{ groupKey }, { reservationId: { in: active.map((r) => r.id) } }] },
      select: { id: true },
    });
    if (existing) return false;

    const type = (reservation.reservationType ?? "STAY") as
      | "STAY"
      | "BATH"
      | "DAYCARE";
    const copy = REVIEW_COPY[type] ?? REVIEW_COPY.STAY;
    const who = reviewWho(active.map((r) => r.pet?.name).filter(Boolean) as string[]);

    await notifyUser(prisma as PrismaClient, {
      userId: reservation.ownerId,
      type: "REVIEW_REQUEST",
      title: copy.pushTitle(who),
      body: copy.pushBody,
      // `reservationId` alimenta el deep link (notificationRoute lo manda al
      // detalle con ?action=review). `groupKey` es para diagnóstico.
      data: {
        reservationId: active[0].id,
        groupKey,
        reservationType: type,
      },
    });

    await prisma.reservation.updateMany({
      where: { id: { in: active.map((r) => r.id) } },
      data: { reviewRequestedAt: new Date() },
    });

    return true;
  } catch (err) {
    console.error("[requestReview]", reservationId, err);
    return false;
  }
}
