/**
 * Aviso a los ADMIN de que un CLIENTE pagó algo desde la app o el sitio.
 *
 * El porqué: el equipo se enteraba de una reserva nueva, pero de ningún pago.
 * Un saldo liquidado en línea o unos extras de baño pagados con tarjeta solo
 * se descubrían abriendo la reserva.
 *
 * Dos decisiones que no son accidente:
 *
 *  - Solo ADMIN. El staff crea reservas pero no ve dinero (ingresos, tarifas y
 *    precios son solo de admin); un push con el monto se saltaría esa regla.
 *  - Solo pagos que hace el cliente. Lo que captura el equipo (efectivo,
 *    terminal, mostrador) no avisa: quien lo registró ya lo sabe, y avisar de
 *    cada cobro de caja sería puro ruido.
 *
 * El anticipo o pago total AL RESERVAR no pasa por aquí: va dentro del mismo
 * aviso de reserva nueva (`notifyNewReservation`, parámetro `paid`), para que
 * una reserva no vibre dos veces.
 */
import type { PrismaClient } from "@holidoginn/db";
import { notifyUsers, adminsActivosIds } from "./notify";

/** Qué se pagó. Define el texto del aviso. */
export type TeamPaymentConcept =
  /** Saldo pendiente de la reserva, liquidado desde la app. */
  | "BALANCE"
  /** Baño agregado a una estancia que ya existía. */
  | "BATH_ADDON"
  /** Extras que el equipo le cotizó al baño (nudos, deslanado…). */
  | "BATH_EXTRAS"
  /** Noches extra de una extensión aprobada. */
  | "EXTENSION";

/** "$1,200" / "$1,200.50" — sin centavos cuando no los hay. */
export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("es-MX", { maximumFractionDigits: 2 })}`;
}

function serviceLabel(reservationType: string | null | undefined): string {
  if (reservationType === "BATH") return "del baño";
  if (reservationType === "DAYCARE") return "de la guardería";
  return "de la estancia";
}

/**
 * Arma título y cuerpo. Pura y exportada aparte para poder probarla sin base.
 */
export function buildTeamPaymentMessage(params: {
  amount: number;
  concept: TeamPaymentConcept;
  petName?: string | null;
  reservationType?: string | null;
}): { title: string; body: string } {
  const { amount, concept, reservationType } = params;
  const pet = params.petName?.trim() || "una mascota";

  const what =
    concept === "BALANCE"
      ? `Saldo ${serviceLabel(reservationType)} de ${pet}`
      : concept === "BATH_ADDON"
        ? `Baño agregado a la estancia de ${pet}`
        : concept === "BATH_EXTRAS"
          ? `Extras del baño de ${pet}`
          : `Extensión de la estancia de ${pet}`;

  return {
    title: `💰 Pago recibido · ${formatMoney(amount)}`,
    body: `${what}. Pagó en línea con tarjeta.`,
  };
}

/**
 * Avisa a los ADMIN activos. Nunca lanza: el pago ya se cobró y registró, y un
 * push fallido jamás debe convertir eso en un error para el cliente.
 */
export async function notifyPaymentToAdmins(
  prisma: PrismaClient,
  params: {
    reservationId: string;
    amount: number;
    concept: TeamPaymentConcept;
  }
): Promise<void> {
  try {
    const { reservationId, amount, concept } = params;
    if (!(amount > 0)) return;

    const targets = await adminsActivosIds(prisma);
    if (targets.length === 0) return;

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { reservationType: true, pet: { select: { name: true } } },
    });

    const msg = buildTeamPaymentMessage({
      amount,
      concept,
      petName: reservation?.pet?.name,
      reservationType: reservation?.reservationType,
    });

    const pushed = await notifyUsers(prisma, targets, {
      type: "PAYMENT_RECEIVED",
      title: msg.title,
      body: msg.body,
      data: {
        reservationId,
        reservationType: reservation?.reservationType ?? null,
        kind: "TEAM_PAYMENT",
        concept,
        amount,
      },
    });

    console.info("[notifyPaymentToAdmins]", {
      reservationId,
      concept,
      amount,
      targets: targets.length,
      pushed,
    });
  } catch (err) {
    console.error("[notifyPaymentToAdmins] falló:", err);
  }
}
