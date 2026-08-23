// ============================================================
// Comisión de pasarela — FUENTE ÚNICA compartida por mobile y api.
//
// Módulo puro (SIN zod), como ./pricing: la app puede importarlo sin arrastrar
// los esquemas al bundle.
//
// `payment.amount` es SIEMPRE el BRUTO: lo que el cliente entregó. Contra ese
// bruto se mide el saldo de la reserva (regla del modelo: total reserva =
// SUM(payments.amount)), así que restarle la comisión ahí dejaría a la reserva
// con un adeudo eterno por un costo que no es del cliente.
//
// La comisión vive aparte, en dos campos según por dónde entró el dinero:
//   · stripeFeeAmount — pagos hechos desde la app. La escribe el webhook de
//     Stripe con el `fee` del balance transaction; en MXN ese balance
//     transaction nace `pending` y sin `fee`, así que puede tardar (o quedarse
//     null hasta que corra el backfill).
//   · cardFeeAmount   — cobros con tarjeta en la terminal física (Getnet).
// En efectivo/transferencia ambos son null.
//
// Es el mismo neto que calculan las vistas del dashboard
// (packages/db/sql/dashboard_views.sql): amount - stripeFee - cardFee.
// ============================================================

/**
 * Un monto tal como llega de cada lado: `number` en la app, `string` cuando el
 * Decimal viajó en JSON, y el propio Decimal de Prisma en la API. `toFixed` es
 * lo único que los tres comparten, y sirve para tipar el Decimal sin importar
 * @holidoginn/db aquí (este módulo se bundlea en la app).
 */
export type Numeric = number | string | { toFixed(digits?: number): string };

/** Un pago, en la forma mínima que hace falta para sacarle la comisión. */
export type PaymentWithFees = {
  amount: Numeric;
  stripeFeeAmount?: Numeric | null;
  cardFeeAmount?: Numeric | null;
};

export type PaymentFeeBreakdown = {
  /** Lo que pagó el cliente. */
  gross: number;
  /** Lo que se quedó la pasarela (Stripe + terminal). Siempre > 0. */
  fee: number;
  /** Lo que le queda al negocio: gross - fee. */
  net: number;
};

/**
 * Decimal de Prisma, string de JSON o number: todo cae aquí. `Number()` sirve
 * para los tres (Decimal define `valueOf`). Lo no numérico vale 0 en vez de
 * propagar NaN: una comisión ilegible no debe borrar el renglón entero.
 */
function toNumber(value: Numeric | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Comisión total (Stripe + terminal) de un pago. 0 si no trae ninguna. */
export function paymentFee(payment: PaymentWithFees | null | undefined): number {
  if (!payment) return 0;
  const fee =
    toNumber(payment.stripeFeeAmount) + toNumber(payment.cardFeeAmount);
  return fee > 0 ? fee : 0;
}

/**
 * Desglose bruto/comisión/neto, o `null` cuando no hay comisión que mostrar:
 * efectivo, transferencia, o un cobro con tarjeta que Stripe todavía no
 * concilia. En esos casos el bruto ya ES el neto y una línea de
 * "comisión −$0.00" solo estorba.
 */
export function paymentFeeBreakdown(
  payment: PaymentWithFees | null | undefined,
): PaymentFeeBreakdown | null {
  const fee = paymentFee(payment);
  if (fee <= 0) return null;
  const gross = toNumber(payment!.amount);
  return { gross, fee, net: gross - fee };
}

/** Suma de comisiones de una lista de pagos (0 si ninguno trae comisión). */
export function totalPaymentFees(
  payments: readonly (PaymentWithFees | null | undefined)[] | null | undefined,
): number {
  return (payments ?? []).reduce((acc, p) => acc + paymentFee(p), 0);
}
