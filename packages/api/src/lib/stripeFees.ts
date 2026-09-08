/**
 * Comisión de Stripe por cobro (`payments.stripeFeeAmount`).
 *
 * PROBLEMA: `amount` es SIEMPRE el bruto y los ingresos restan la comisión
 * ellos mismos (ver packages/db/sql/dashboard_views.sql). Mientras
 * `stripeFeeAmount` sea null, el ingreso se cuenta en bruto y el dueño ve
 * pesos que nunca le cayeron.
 *
 * Stripe conoce la comisión desde el instante del cobro —viaja en el
 * `balance_transaction` del charge, mucho antes de que el dinero se deposite—
 * así que no hay razón para esperar al payout. Este módulo es la única fuente
 * de esa escritura y lo usan los tres caminos que la necesitan:
 *
 *   1. el webhook `payment_intent.succeeded` (al instante, caso normal),
 *   2. el cron `/internal/stripe-fees-sync` (red de seguridad diaria),
 *   3. `npm run backfill:stripe-fees` (histórico, a mano).
 *
 * La conciliación del depósito (lib/payouts.ts) también la rellena si llega
 * primero; todas las escrituras filtran por `stripeFeeAmount: null`, así que
 * conviven sin pisarse.
 */
import Stripe from "stripe";
import { Prisma } from "@holidoginn/db";
import type { PrismaClient } from "@holidoginn/db";

/**
 * Cliente Stripe perezoso, mismo criterio que lib/payouts.ts: instanciarlo al
 * importar tumbaría el módulo en cualquier entorno sin `STRIPE_SECRET_KEY`,
 * incluidos los tests que solo usan las funciones puras.
 */
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2025-03-31.basil",
    });
  }
  return _stripe;
}

/**
 * Centavos → pesos sin pasar por float: `4733 / 100` en JS puede dar
 * 47.330000000000005 y ensuciar el neto al centavo.
 */
function fromCents(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

/**
 * Los reembolsos se guardan con un id sintético (`${piId}_refund_${chargeId}`)
 * o con el `re_...` de Stripe: ninguno es un PaymentIntent y pedirlos devuelve
 * 404. No tienen comisión propia que registrar.
 */
export function esPaymentIntentReal(piId: string): boolean {
  return piId.startsWith("pi_") && !piId.includes("_refund_");
}

export type ComisionStripe = {
  fee: Prisma.Decimal;
  /** Día en que Stripe libera el dinero (`balance_transaction.available_on`). */
  availableOn: Date | null;
};

/**
 * Lee la comisión real del PaymentIntent. Devuelve null cuando Stripe aún no
 * la publica: en cobros con tarjeta MXN el `balance_transaction` puede venir
 * `pending` y sin `fee`, y en ese caso hay que reintentar más tarde — por eso
 * ningún llamador debe interpretar null como "este cobro no tiene comisión".
 */
export async function leerComisionStripe(piId: string): Promise<ComisionStripe | null> {
  const pi = await getStripe().paymentIntents.retrieve(piId, {
    expand: ["latest_charge.balance_transaction"],
  });
  const charge = pi.latest_charge as Stripe.Charge | null;
  const bt = charge?.balance_transaction;
  if (!bt || typeof bt === "string" || bt.fee == null) return null;

  return {
    fee: fromCents(bt.fee),
    availableOn: bt.available_on ? new Date(bt.available_on * 1000) : null,
  };
}

/**
 * Guarda la comisión de un pago concreto. No toca `amount` (sigue bruto) y es
 * best-effort: si Stripe falla, se registra y se sigue — el cron la recoge
 * después. Devuelve true solo si escribió.
 */
export async function guardarComisionStripe(
  prisma: PrismaClient,
  paymentId: string,
  piId: string,
  log: (msg: string, err: unknown) => void = (msg, err) => console.warn(msg, err)
): Promise<boolean> {
  if (!esPaymentIntentReal(piId)) return false;
  try {
    const comision = await leerComisionStripe(piId);
    if (!comision) return false;
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        stripeFeeAmount: comision.fee,
        stripeAvailableOn: comision.availableOn,
      },
    });
    return true;
  } catch (err) {
    log(`[stripe-fees] no se pudo obtener la comisión del PI ${piId}:`, err);
    return false;
  }
}

export type SyncFeesResult = {
  /** Pagos que se revisaron (Stripe con PI real y algo faltante). */
  revisados: number;
  actualizados: number;
  /** Stripe aún no publica la comisión; se recogen en la corrida siguiente. */
  pendientes: number;
  errores: number;
  detalle: { paymentId: string; fee: string; neto: string }[];
};

/**
 * Rellena la comisión de todos los pagos de Stripe a los que les falte.
 *
 * Idempotente y reejecutable: solo mira los que tienen algún campo en null, así
 * que correrlo dos veces seguidas no pide nada de más a Stripe. Es la red de
 * seguridad de la que cuelgan el cron diario y el script de backfill.
 */
export async function syncPendingStripeFees(
  prisma: PrismaClient,
  opts: { limit?: number; onRow?: (linea: string) => void } = {}
): Promise<SyncFeesResult> {
  const pagos = await prisma.payment.findMany({
    where: {
      method: "STRIPE",
      stripePaymentIntentId: { not: null },
      // También los que ya tienen comisión pero les falta la fecha en que
      // Stripe libera el dinero (columna agregada después).
      OR: [{ stripeFeeAmount: null }, { stripeAvailableOn: null }],
    },
    select: { id: true, amount: true, stripePaymentIntentId: true },
    orderBy: { createdAt: "desc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const res: SyncFeesResult = {
    revisados: 0,
    actualizados: 0,
    pendientes: 0,
    errores: 0,
    detalle: [],
  };

  // En serie a propósito: son pocos y en paralelo se dispararía el rate limit
  // de Stripe (mismo criterio que syncRecentPayouts).
  for (const p of pagos) {
    const piId = p.stripePaymentIntentId!;
    if (!esPaymentIntentReal(piId)) continue;
    res.revisados++;

    try {
      const comision = await leerComisionStripe(piId);
      if (!comision) {
        res.pendientes++;
        opts.onRow?.(`   … ${p.id}  comisión aún no disponible (balance pending)`);
        continue;
      }
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          stripeFeeAmount: comision.fee,
          stripeAvailableOn: comision.availableOn,
        },
      });
      const neto = new Prisma.Decimal(p.amount).minus(comision.fee);
      res.actualizados++;
      res.detalle.push({
        paymentId: p.id,
        fee: comision.fee.toString(),
        neto: neto.toString(),
      });
      opts.onRow?.(
        `   ✔ ${p.id}  bruto=${p.amount}  comisión=${comision.fee}  neto=${neto}`
      );
    } catch (err) {
      res.errores++;
      opts.onRow?.(
        `   ✖ ${p.id}  PI=${piId}  — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return res;
}
