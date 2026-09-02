/**
 * Avisarle al dueño que su visita terminó con saldo por cobrar.
 *
 * Antes, una estancia/baño/guardería que cerraba debiendo dinero desaparecía
 * del radar del cliente: la app le escondía el botón de pago en cuanto la
 * reserva pasaba a CHECKED_OUT, y nadie le avisaba. El cobro terminaba
 * dependiendo de que alguien del equipo se acordara de perseguirlo.
 *
 * Espeja a `reviewRequest.ts` a propósito — mismos cortes y mismas garantías:
 * la unidad es la VISITA (`groupId` completo), se manda UNA sola vez cuando
 * todas las hermanas ya cerraron, y un fallo aquí NUNCA tumba un check-out.
 * Para agregar un camino nuevo de cierre, basta llamar a `notifyBalanceDue`
 * junto a `requestReview`.
 *
 * El tipo de la notificación es GENERAL con `data.kind = "BALANCE_DUE"`, el
 * mismo patrón que cartilla y los depósitos de Stripe: el deep link se resuelve
 * en apps/mobile/src/lib/notificationRoute.ts.
 */
import type { PrismaClient, Prisma } from "@holidoginn/db";
import { notifyUser } from "./notify";
import { groupKeyOf } from "./reviewRequest";

type Db = PrismaClient | Prisma.TransactionClient;

/** Por debajo de esto el "saldo" es ruido de redondeo, no dinero por cobrar. */
const MIN_BALANCE = 0.01;

/**
 * Ventana en la que todavía se le pide el saldo al cliente. Debe coincidir con
 * BALANCE_AFTER_CHECKOUT_MAX_DAYS de la app (apps/mobile/src/lib/format.ts): un
 * push que lleve a un detalle sin botón de pago es peor que no mandar nada.
 *
 * Importa por el cierre automático de reservas atrasadas, que puede cerrar hoy
 * una visita de hace meses; y porque en las visitas viejas el saldo suele ser un
 * cobro de mostrador que nunca se registró, no dinero real por cobrar.
 */
const MAX_DAYS_AFTER_END = 30;

/**
 * Manda el aviso de saldo pendiente si corresponde. Idempotente y seguro de
 * llamar de más: devuelve `false` sin efectos si ya se avisó, si la visita aún
 * no termina o si no queda nada por cobrar.
 *
 * NO lanza.
 */
export async function notifyBalanceDue(
  prisma: Db,
  reservationId: string,
): Promise<boolean> {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, groupId: true, ownerId: true },
    });
    if (!reservation) return false;

    // La visita completa: una fila por mascota.
    const siblings = reservation.groupId
      ? await prisma.reservation.findMany({
          where: {
            groupId: reservation.groupId,
            ownerId: reservation.ownerId,
          },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            balanceReminderAt: true,
            reservationType: true,
            checkOut: true,
            appointmentAt: true,
            updatedAt: true,
            pet: { select: { name: true } },
            payments: {
              where: { status: { in: ["PAID", "PARTIAL"] } },
              select: { amount: true },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : await prisma.reservation.findMany({
          where: { id: reservation.id },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            balanceReminderAt: true,
            reservationType: true,
            checkOut: true,
            appointmentAt: true,
            updatedAt: true,
            pet: { select: { name: true } },
            payments: {
              where: { status: { in: ["PAID", "PARTIAL"] } },
              select: { amount: true },
            },
          },
        });

    // Ya se avisó (por cualquiera de las hermanas).
    if (siblings.some((r) => r.balanceReminderAt !== null)) return false;

    // La visita no ha terminado: alguna mascota sigue dentro. Se reintentará
    // cuando cierre la última, así el cliente recibe un solo aviso.
    const active = siblings.filter((r) => r.status !== "CANCELLED");
    if (active.length === 0) return false;
    if (active.some((r) => r.status !== "CHECKED_OUT")) return false;

    // Saldo de la VISITA entera: en multi-mascota el anticipo se reparte entre
    // las filas, así que mirar una sola daría una cifra que no es la que el
    // cliente tiene que pagar.
    // Visita demasiado vieja: el cobro vuelve a ser cosa del equipo.
    const end =
      active[0].checkOut ?? active[0].appointmentAt ?? active[0].updatedAt;
    if (end) {
      const days = Math.floor((Date.now() - end.getTime()) / 86_400_000);
      if (days > MAX_DAYS_AFTER_END) return false;
    }

    const remaining = active.reduce((sum, r) => {
      const paid = r.payments.reduce((s, p) => s + Number(p.amount), 0);
      return sum + (Number(r.totalAmount) - paid);
    }, 0);
    if (remaining <= MIN_BALANCE) return false;

    const monto = `$${Math.round(remaining).toLocaleString("es-MX")}`;
    const type = active[0].reservationType ?? "STAY";
    const que =
      type === "BATH"
        ? "el baño"
        : type === "DAYCARE"
          ? "la guardería"
          : "la estancia";

    await notifyUser(prisma as PrismaClient, {
      userId: reservation.ownerId,
      type: "GENERAL",
      title: `Queda un saldo de ${monto}`,
      body: `Ya terminó ${que}. Puedes pagar el saldo desde la app y ver el desglose de lo que incluye.`,
      data: {
        reservationId: active[0].id,
        groupKey: groupKeyOf(reservation),
        kind: "BALANCE_DUE",
      },
    });

    await prisma.reservation.updateMany({
      where: { id: { in: active.map((r) => r.id) } },
      data: { balanceReminderAt: new Date() },
    });

    return true;
  } catch (err) {
    console.error("[notifyBalanceDue]", reservationId, err);
    return false;
  }
}
