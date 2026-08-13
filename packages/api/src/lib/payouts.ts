/**
 * Conciliación de los depósitos SPEI que Stripe manda a la cuenta del hotel.
 *
 * PROBLEMA: al banco llega un SPEI de "Stripe Payments Mexico" por un monto
 * agregado — digamos $663.80 — que junta los cobros de varios clientes. El SPEI
 * no trae referencia útil, así que la única forma de saber de qué reservas era
 * ese dinero era abrir el dashboard de Stripe y cruzar a mano.
 *
 * Este módulo reconstruye el desglose: baja del payout sus balance transactions,
 * las cruza contra nuestros pagos / pedidos de tienda, y lo guarda en
 * `stripe_payouts` + `stripe_payout_lines` para que ambos clientes (app móvil
 * admin y admin web) lo lean sin hablar con Stripe.
 *
 * INVARIANTE: SUM(line.net) === payout.amount. Por eso se guardan TODAS las
 * líneas, también las que no cruzan con nada nuestro. Ocultar una línea porque
 * no supimos identificarla haría que el desglose no cuadre y el dueño creería
 * que le faltan pesos.
 */
import Stripe from "stripe";
import { Prisma } from "@holidoginn/db";
import type { PrismaClient } from "@holidoginn/db";

/**
 * Cliente Stripe perezoso. Instanciarlo al importar tumbaría el módulo en
 * cualquier entorno sin `STRIPE_SECRET_KEY` — incluidos los tests, que solo
 * usan las funciones puras de cruce y nunca tocan la red.
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

/** Techo de líneas por depósito. Un payout real trae decenas, no miles. */
const MAX_LINES = 2000;

/**
 * Centavos → pesos, sin pasar por float. `663_80 / 100` en JS puede dar
 * 663.8000000000001 y ensuciar el cuadre al centavo, que es justo lo único
 * que esta feature promete.
 */
function fromCents(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

/** Unix (segundos) → Date. */
function fromUnix(seconds: number): Date {
  return new Date(seconds * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Resolución del PaymentIntent detrás de un balance transaction
// ─────────────────────────────────────────────────────────────────────────────

export type SourceRefs = {
  chargeId: string | null;
  paymentIntentId: string | null;
  /** `re_...` — sólo en líneas de reembolso. Ver el comentario del matching. */
  refundId: string | null;
  /**
   * Metadata que el charge trae de su PaymentIntent. Es el único rastro de a
   * quién pertenece un cobro que nunca llegó a `payments`, y viene ya en el
   * `expand: data.source` — no cuesta una llamada extra.
   */
  metadata: Record<string, string> | null;
};

const NO_REFS: SourceRefs = {
  chargeId: null,
  paymentIntentId: null,
  refundId: null,
  metadata: null,
};

/** Metadata vacía → null, para no guardar `{}` en media tabla. */
function limpiarMetadata(m: unknown): Record<string, string> | null {
  if (!m || typeof m !== "object") return null;
  const obj = m as Record<string, string>;
  return Object.keys(obj).length > 0 ? obj : null;
}

/**
 * Saca `charge`, `payment_intent` y `refund` del `source` expandido de un
 * balance transaction. Stripe mete objetos distintos según el tipo de
 * movimiento y solo los charges traen el PI directo; refunds y disputas hay
 * que rastrearlos.
 */
export function extractRefs(bt: Stripe.BalanceTransaction): SourceRefs {
  const src = bt.source;
  if (!src || typeof src === "string") return NO_REFS;

  const idOf = (v: unknown): string | null =>
    typeof v === "string"
      ? v
      : v && typeof v === "object" && "id" in v
        ? String((v as { id: string }).id)
        : null;

  switch (src.object) {
    case "charge":
      return {
        chargeId: src.id,
        paymentIntentId: idOf(src.payment_intent),
        refundId: null,
        metadata: limpiarMetadata(src.metadata),
      };
    case "refund":
      return {
        chargeId: idOf(src.charge),
        paymentIntentId: idOf(src.payment_intent),
        refundId: src.id,
        metadata: limpiarMetadata(src.metadata),
      };
    case "dispute":
      return {
        chargeId: idOf(src.charge),
        paymentIntentId: idOf(src.payment_intent),
        refundId: null,
        metadata: limpiarMetadata(src.metadata),
      };
    default:
      // application_fee, transfer, payout, fee_refund… no cuelgan de un cobro
      // nuestro. La línea igual se guarda, como ajuste sin identificar.
      return NO_REFS;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cruce de una línea contra nuestros datos
// ─────────────────────────────────────────────────────────────────────────────

/** Índices `pi_...` → id, precalculados en batch para no hacer N+1. */
export type MatchMaps = {
  byPi: Map<string, string>;
  orderByPi: Map<string, string>;
  addonPaymentByPi: Map<string, string>;
  /** pi original → id del Payment REFUNDED con id sintético. */
  refundByPi: Map<string, string>;
};

export function isRefundType(t: string): boolean {
  return t === "refund" || t === "payment_refund" || t === "refund_failure";
}

/**
 * Decide a qué pago o pedido nuestro corresponde una línea del depósito.
 *
 * Pura y exportada aparte porque es donde vive toda la lógica sutil (los tres
 * formatos de reembolso) y es lo que cubren los tests.
 */
export function matchLine(
  type: string,
  refs: SourceRefs,
  maps: MatchMaps
): { paymentId: string | null; orderId: string | null } {
  const { paymentIntentId: pi, refundId } = refs;

  if (isRefundType(type)) {
    // Tres formatos posibles, en orden de preferencia:
    //   1. `re_...`                 → cancelación (lib/refund.ts) o recorte de
    //                                 estadía (routes/changeRequests.ts)
    //   2. `${pi}_refund_${charge}` → webhook charge.refunded
    //   3. el pago ORIGINAL         → reembolso hecho a mano desde el dashboard
    //      de Stripe, que nunca creó su fila. Identifica peor, pero al menos
    //      dice de qué reserva salió el dinero.
    const paymentId =
      (refundId ? maps.byPi.get(refundId) : undefined) ??
      (pi ? (maps.refundByPi.get(pi) ?? maps.byPi.get(pi)) : undefined) ??
      null;
    return { paymentId, orderId: null };
  }

  if (!pi) return { paymentId: null, orderId: null };

  return {
    paymentId: maps.byPi.get(pi) ?? maps.addonPaymentByPi.get(pi) ?? null,
    orderId: maps.orderByPi.get(pi) ?? null,
  };
}

/**
 * Quita la transacción del propio payout.
 *
 * Al listar balance transactions por `payout=po_...`, Stripe incluye una de tipo
 * `payout` con el total en NEGATIVO. Si no se filtra, la suma de las líneas da
 * cero y el desglose sale vacío. Es el error clásico de esta API.
 */
export function excluirTransaccionDelPayout<T extends { type: string }>(txns: T[]): T[] {
  return txns.filter((t) => t.type !== "payout");
}

// ─────────────────────────────────────────────────────────────────────────────
//  syncPayout
// ─────────────────────────────────────────────────────────────────────────────

export type SyncPayoutResult = {
  payoutId: string;
  amount: number;
  lineCount: number;
  matched: number;
  unmatched: number;
  /** |SUM(net) − amount| < 0.01 */
  cuadra: boolean;
  diferencia: number;
};

/**
 * Baja un payout de Stripe con su desglose y lo persiste. Idempotente: el PK de
 * cada línea es el `txn_...` de Stripe, así que volver a correrlo es un UPSERT.
 */
export async function syncPayout(
  prisma: PrismaClient,
  payoutId: string
): Promise<SyncPayoutResult> {
  const payout = await getStripe().payouts.retrieve(payoutId);

  // `expand: data.source` evita un round-trip por línea para llegar al charge.
  const txns = await getStripe()
    .balanceTransactions.list({ payout: payoutId, limit: 100, expand: ["data.source"] })
    .autoPagingToArray({ limit: MAX_LINES });

  const lines = excluirTransaccionDelPayout(txns);

  // ── Cruce contra nuestros datos, en batch ─────────────────────────────────
  // Un payout puede traer decenas de líneas; resolverlas de a una serían
  // decenas de round-trips a Postgres por cada apertura de pantalla.
  const refs = new Map<string, SourceRefs>();
  for (const bt of lines) refs.set(bt.id, extractRefs(bt));

  const piIds = [...new Set([...refs.values()].map((r) => r.paymentIntentId).filter((v): v is string => !!v))];
  const refundIds = [...new Set([...refs.values()].map((r) => r.refundId).filter((v): v is string => !!v))];

  const [payments, refundPayments, orders, addons] = await Promise.all([
    // Los reembolsos hechos por cancelación (lib/refund.ts) o por recorte de
    // estadía (routes/changeRequests.ts) guardan el `re_...` en esta misma
    // columna, así que la búsqueda por igualdad cubre cobros Y esos reembolsos.
    piIds.length || refundIds.length
      ? prisma.payment.findMany({
          where: { stripePaymentIntentId: { in: [...piIds, ...refundIds] } },
          select: { id: true, stripePaymentIntentId: true },
        })
      : Promise.resolve([]),
    // Tercera forma de guardar un reembolso: el webhook `charge.refunded` usa un
    // id sintético `${pi}_refund_${charge}` que no se encuentra por igualdad.
    // Son tres formatos distintos para lo mismo — hay que probar los tres o los
    // reembolsos salen como "no identificados" y el desglose confunde al dueño.
    piIds.length
      ? prisma.payment.findMany({
          where: { OR: piIds.map((pi) => ({ stripePaymentIntentId: { startsWith: `${pi}_refund_` } })) },
          select: { id: true, stripePaymentIntentId: true },
        })
      : Promise.resolve([]),
    // Los pedidos de tienda NO generan filas en `payments` pero sí viajan en el
    // mismo depósito.
    piIds.length
      ? prisma.order.findMany({
          where: { stripePaymentIntentId: { in: piIds } },
          select: { id: true, stripePaymentIntentId: true },
        })
      : Promise.resolve([]),
    // Extras de baño cobrados aparte, que cuelgan del add-on y no del pago.
    piIds.length
      ? prisma.reservationAddon.findMany({
          where: { extraStripePaymentIntentId: { in: piIds } },
          select: { id: true, extraStripePaymentIntentId: true, paymentId: true },
        })
      : Promise.resolve([]),
  ]);

  const byPi = new Map(payments.map((p) => [p.stripePaymentIntentId!, p.id]));
  const orderByPi = new Map(orders.map((o) => [o.stripePaymentIntentId!, o.id]));
  const addonByPi = new Map(addons.map((a) => [a.extraStripePaymentIntentId!, a]));
  const refundByPi = new Map<string, string>();
  for (const rp of refundPayments) {
    const pi = rp.stripePaymentIntentId?.split("_refund_")[0];
    if (pi) refundByPi.set(pi, rp.id);
  }

  const maps: MatchMaps = {
    byPi: new Map(payments.map((p) => [p.stripePaymentIntentId!, p.id])),
    orderByPi: new Map(orders.map((o) => [o.stripePaymentIntentId!, o.id])),
    addonPaymentByPi: new Map(
      addons
        .filter((a) => a.paymentId)
        .map((a) => [a.extraStripePaymentIntentId!, a.paymentId!])
    ),
    refundByPi: new Map(
      refundPayments
        .map((rp) => [rp.stripePaymentIntentId?.split("_refund_")[0], rp.id] as const)
        .filter((e): e is readonly [string, string] => !!e[0])
    ),
  };

  const rows = lines.map((bt) => {
    const refsBt = refs.get(bt.id)!;
    const { paymentId, orderId } = matchLine(bt.type, refsBt, maps);

    const meta = refsBt.metadata;
    return {
      id: bt.id,
      payoutId,
      type: bt.type,
      gross: fromCents(bt.amount),
      fee: fromCents(bt.fee),
      net: fromCents(bt.net),
      description: bt.description ?? null,
      chargeId: refsBt.chargeId,
      stripePaymentIntentId: refsBt.paymentIntentId,
      paymentId,
      orderId,
      stripeMetadata: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
      metaOwnerId: meta?.ownerId ?? null,
      // Hospedaje manda `petIds` (csv, puede traer varias); baño y guardería,
      // `petId`. Se guarda tal cual y se parte al leer.
      metaPetIds: meta?.petIds ?? meta?.petId ?? null,
      // Los cobros de saldo, extensión y add-ons traen el id de la reserva
      // literal — y algunos NO traen ownerId, así que este es su único hilo.
      metaReservationId: meta?.reservationId ?? null,
    };
  });

  // ── Persistencia ──────────────────────────────────────────────────────────
  const payoutData = {
    amount: fromCents(payout.amount),
    currency: payout.currency,
    status: payout.status,
    arrivalDate: fromUnix(payout.arrival_date),
    stripeCreatedAt: fromUnix(payout.created),
    failureMessage: payout.failure_message ?? null,
  };

  await prisma.$transaction([
    prisma.stripePayout.upsert({
      where: { id: payoutId },
      create: { id: payoutId, ...payoutData },
      update: payoutData,
    }),
    // Si Stripe reasignó una transacción a otro payout, la vieja debe
    // desaparecer o el total dejaría de cuadrar.
    prisma.stripePayoutLine.deleteMany({
      where: { payoutId, id: { notIn: rows.map((r) => r.id) } },
    }),
    ...rows.map((r) =>
      prisma.stripePayoutLine.upsert({
        where: { id: r.id },
        create: r,
        update: r,
      })
    ),
  ]);

  // Aprovechamos el viaje: si un pago nuestro no tenía registrada la comisión
  // de Stripe (balance transaction que estaba `pending` al cobrar), la línea ya
  // la trae. Mismo criterio que stripeWebhooks.ts: NUNCA se toca `amount`, que
  // siempre queda bruto.
  await backfillFeesFromLines(prisma, rows);

  const sumNet = rows.reduce((acc, r) => acc.add(r.net), new Prisma.Decimal(0));
  const diferencia = sumNet.minus(payoutData.amount);
  const matched = rows.filter((r) => r.paymentId || r.orderId).length;

  return {
    payoutId,
    amount: payoutData.amount.toNumber(),
    lineCount: rows.length,
    matched,
    unmatched: rows.length - matched,
    cuadra: diferencia.abs().lessThan(0.01),
    diferencia: diferencia.toNumber(),
  };
}

/** Rellena `payments.stripeFeeAmount` donde falte, usando el fee de la línea. */
async function backfillFeesFromLines(
  prisma: PrismaClient,
  rows: { paymentId: string | null; fee: Prisma.Decimal; type: string }[]
): Promise<void> {
  const candidates = rows.filter(
    (r) => r.paymentId && !r.type.startsWith("refund") && r.fee.greaterThan(0)
  );
  if (candidates.length === 0) return;

  try {
    const pending = await prisma.payment.findMany({
      where: { id: { in: candidates.map((c) => c.paymentId!) }, stripeFeeAmount: null },
      select: { id: true },
    });
    const pendingIds = new Set(pending.map((p) => p.id));
    await Promise.all(
      candidates
        .filter((c) => pendingIds.has(c.paymentId!))
        .map((c) =>
          prisma.payment.update({
            where: { id: c.paymentId! },
            data: { stripeFeeAmount: c.fee },
          })
        )
    );
  } catch (err) {
    // Best-effort: es un extra, no debe tumbar la conciliación del depósito.
    console.warn("[payouts] no se pudo backfillear stripeFeeAmount:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  syncRecentPayouts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sincroniza los N depósitos más recientes. Es la base del script de backfill
 * (que trae el histórico) y del botón "actualizar" de las pantallas.
 *
 * Los payouts se procesan en serie a propósito: en paralelo se dispararía el
 * rate limit de Stripe y además cada uno hace su propia transacción en Postgres.
 */
export async function syncRecentPayouts(
  prisma: PrismaClient,
  opts: { limit?: number } = {}
): Promise<SyncPayoutResult[]> {
  const list = await getStripe().payouts.list({ limit: opts.limit ?? 10 });
  const results: SyncPayoutResult[] = [];
  for (const p of list.data) {
    try {
      results.push(await syncPayout(prisma, p.id));
    } catch (err) {
      console.error(`[payouts] falló el sync de ${p.id}:`, err);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
//  getPayoutBreakdown — lectura enriquecida para las pantallas
// ─────────────────────────────────────────────────────────────────────────────

export type PayoutLineMatch = {
  /**
   * `SIN_REGISTRAR`: sabemos de quién es el cobro por la metadata de Stripe,
   * pero NO existe como pago en la base. El dinero entró y la reserva figura
   * debiéndolo, así que la pantalla tiene que decirlo, no disimularlo.
   */
  kind: "RESERVATION" | "STORE_ORDER" | "REFUND" | "SIN_REGISTRAR";
  paymentId: string | null;
  reservationId: string | null;
  orderId: string | null;
  orderNumber: number | null;
  /** TODAS las mascotas del grupo, no solo la de la reserva que cargó el cobro. */
  petNames: string[];
  ownerName: string | null;
  serviceLabel: string;
  paidAt: string | null;
};

export type PayoutLineDTO = {
  id: string;
  type: string;
  gross: number;
  fee: number;
  net: number;
  description: string | null;
  stripePaymentIntentId: string | null;
  match: PayoutLineMatch | null;
};

export type PayoutBreakdown = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: string;
  stripeCreatedAt: string;
  syncedAt: string;
  failureMessage: string | null;
  totals: {
    gross: number;
    fees: number;
    net: number;
    matched: number;
    unmatched: number;
    /** Identificados por metadata pero SIN pago registrado en la base. */
    sinRegistrar: number;
    /** Suma bruta de esos cobros: dinero que entró y no está en los ingresos. */
    sinRegistrarMonto: number;
  };
  /** El desglose suma exactamente el monto que llegó al banco. */
  cuadra: boolean;
  diferencia: number;
  lines: PayoutLineDTO[];
};

const SERVICE_LABEL: Record<string, string> = {
  STAY: "Hospedaje",
  BATH: "Estética",
  DAYCARE: "Guardería",
};

/** Servicio según el `type` de la metadata; sin `type` es hospedaje. */
function servicioDeMetadata(meta: Record<string, unknown> | null): string {
  const t = typeof meta?.type === "string" ? meta.type : null;
  if (t === "bath_appointment" || t === "bath_addon" || t === "bath_extra") return "Estética";
  if (t === "daycare") return "Guardería";
  if (meta?.source === "store") return "Tienda";
  return "Hospedaje";
}

type LineaHuerfana = {
  id: string;
  metaOwnerId: string | null;
  metaPetIds: string | null;
  metaReservationId: string | null;
  stripeMetadata: unknown;
};

/** Tipo de reserva que le corresponde a un cobro, según su metadata. */
function tipoEsperado(meta: Record<string, unknown> | null): "STAY" | "BATH" | "DAYCARE" {
  const t = typeof meta?.type === "string" ? meta.type : null;
  if (t === "bath_appointment" || t === "bath_addon" || t === "bath_extra") return "BATH";
  if (t === "daycare") return "DAYCARE";
  return "STAY";
}

/**
 * Cuánto puede alejarse la fecha de la metadata de la que guarda la reserva.
 *
 * No es un número único porque cada tipo guarda la fecha en otra escala:
 * - BATH: la metadata manda el instante exacto de la cita y la reserva guarda
 *   ESE MISMO instante. Una hora es de sobra, y estrecharla evita que dos citas
 *   del mismo día se confundan.
 * - DAYCARE: la metadata manda `date` como "YYYY-MM-DD" (medianoche) y la
 *   reserva ancla a mediodía UTC → 12 h de diferencia estructural.
 * - STAY: la metadata manda el check-in en hora del hotel y la reserva lo
 *   guarda a medianoche UTC → hasta 7 h, y el día puede correrse.
 */
const VENTANA_POR_TIPO: Record<"STAY" | "BATH" | "DAYCARE", number> = {
  BATH: 60 * 60 * 1000,
  DAYCARE: 24 * 60 * 60 * 1000,
  STAY: 36 * 60 * 60 * 1000,
};

export type ReservaCandidata = {
  id: string;
  ownerId: string;
  petId: string;
  reservationType: string;
  status: string;
  checkIn: Date | null;
  appointmentAt: Date | null;
};

/**
 * Elige a qué reserva pertenece un cobro, o `null` si no se puede afirmar.
 *
 * Pura y exportada para poder probarla: aquí vivían dos errores que solo se ven
 * con datos reales. Tomaba la PRIMERA candidata dentro de la ventana en vez de
 * la más cercana —y sin orden estable, así que la ganadora podía cambiar entre
 * corridas— y no filtraba por tipo, de modo que el baño del día de salida se
 * colgaba de la estancia.
 *
 * Ante un empate prefiere no vincular: mandar al admin a la reserva equivocada
 * es peor que no ofrecerle el enlace, porque el siguiente paso natural es
 * registrar el pago ahí.
 */
export function elegirReserva(
  candidatas: ReservaCandidata[],
  criterio: {
    ownerId: string | null;
    petIds: string[];
    tipo: "STAY" | "BATH" | "DAYCARE";
    fecha: Date;
  }
): string | null {
  const ventana = VENTANA_POR_TIPO[criterio.tipo];
  const distancias = candidatas
    .filter(
      (r) =>
        r.ownerId === criterio.ownerId &&
        criterio.petIds.includes(r.petId) &&
        r.reservationType === criterio.tipo &&
        r.status !== "CANCELLED"
    )
    .map((r) => {
      const ref = criterio.tipo === "STAY" ? r.checkIn : r.appointmentAt;
      return ref ? { id: r.id, d: Math.abs(ref.getTime() - criterio.fecha.getTime()) } : null;
    })
    .filter((x): x is { id: string; d: number } => !!x && x.d <= ventana)
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));

  const [mejor, segunda] = distancias;
  if (!mejor) return null;
  const ambiguo = !!segunda && Math.abs(segunda.d - mejor.d) < 60_000;
  return ambiguo ? null : mejor.id;
}

/**
 * Reconstruye cliente, mascotas y —si todavía existe— la reserva de un cobro
 * que nunca se registró como pago, usando la metadata que Stripe conservó.
 *
 * La reserva se busca por dueño + mascota + fecha porque la metadata NO trae el
 * `reservationId` (se genera después del cobro). La ventana de ±36 h absorbe
 * que la metadata guarde la fecha en hora del hotel y la base la guarde a
 * medianoche UTC. Si no aparece, igual devolvemos cliente y mascota: saber de
 * quién es el dinero ya resuelve la pregunta, aunque la reserva se haya
 * borrado o cancelado.
 */
async function resolverDesdeMetadata(
  prisma: PrismaClient,
  lineas: LineaHuerfana[]
): Promise<Map<string, PayoutLineMatch>> {
  const out = new Map<string, PayoutLineMatch>();
  if (lineas.length === 0) return out;

  const ownerIds = [...new Set(lineas.map((l) => l.metaOwnerId).filter((v): v is string => !!v))];
  const petIds = [
    ...new Set(lineas.flatMap((l) => (l.metaPetIds ?? "").split(",").map((s) => s.trim()).filter(Boolean))),
  ];

  // Las metadatas de saldo, extensión y add-ons traen el reservationId literal:
  // esas no hay que adivinarlas.
  const resvIds = [
    ...new Set(lineas.map((l) => l.metaReservationId).filter((v): v is string => !!v)),
  ];

  const [owners, pets, exactas] = await Promise.all([
    ownerIds.length
      ? prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    petIds.length
      ? prisma.pet.findMany({ where: { id: { in: petIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    resvIds.length
      ? prisma.reservation.findMany({
          where: { id: { in: resvIds } },
          select: {
            id: true,
            reservationType: true,
            pet: { select: { name: true } },
            owner: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const petById = new Map(pets.map((p) => [p.id, p.name]));
  const exactaById = new Map(exactas.map((r) => [r.id, r]));

  // Reservas candidatas para el cruce heurístico: mismas mascotas, mismo dueño.
  // `orderBy` fija un orden estable — sin él Postgres devuelve lo que le
  // convenga y el ganador cambiaría entre corridas.
  const candidatas =
    ownerIds.length && petIds.length
      ? await prisma.reservation.findMany({
          where: { ownerId: { in: ownerIds }, petId: { in: petIds } },
          select: {
            id: true,
            ownerId: true,
            petId: true,
            reservationType: true,
            status: true,
            checkIn: true,
            appointmentAt: true,
          },
          orderBy: [{ appointmentAt: "asc" }, { checkIn: "asc" }, { id: "asc" }],
        })
      : [];

  const nombreDe = (o?: { firstName: string; lastName: string } | null) =>
    o ? [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || null : null;

  for (const l of lineas) {
    const meta = (l.stripeMetadata ?? null) as Record<string, unknown> | null;
    const ids = (l.metaPetIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const nombres = ids.map((id) => petById.get(id)).filter((n): n is string => !!n);
    const owner = l.metaOwnerId ? ownerById.get(l.metaOwnerId) : undefined;

    // ── Vía exacta ─────────────────────────────────────────────────────────
    const exacta = l.metaReservationId ? exactaById.get(l.metaReservationId) : undefined;
    if (exacta) {
      out.set(l.id, {
        kind: "SIN_REGISTRAR",
        paymentId: null,
        reservationId: exacta.id,
        orderId: null,
        orderNumber: null,
        petNames: nombres.length > 0 ? nombres : exacta.pet?.name ? [exacta.pet.name] : [],
        ownerName: nombreDe(owner) ?? nombreDe(exacta.owner),
        serviceLabel: SERVICE_LABEL[exacta.reservationType] ?? servicioDeMetadata(meta),
        paidAt: null,
      });
      continue;
    }

    // ── Vía heurística: dueño + mascota + tipo + fecha más cercana ─────────
    const tipo = tipoEsperado(meta);
    // La guardería manda la fecha en `date`, no en appointmentAt ni checkIn.
    const fechaRaw = (meta?.appointmentAt ?? meta?.checkIn ?? meta?.date) as string | undefined;
    const fecha = fechaRaw ? new Date(fechaRaw) : null;

    const reservationId =
      fecha && !Number.isNaN(fecha.getTime())
        ? elegirReserva(candidatas, {
            ownerId: l.metaOwnerId,
            petIds: ids,
            tipo,
            fecha,
          })
        : null;

    out.set(l.id, {
      kind: "SIN_REGISTRAR",
      paymentId: null,
      reservationId,
      orderId: null,
      orderNumber: null,
      petNames: nombres,
      ownerName: nombreDe(owner),
      serviceLabel: servicioDeMetadata(meta),
      paidAt: null,
    });
  }

  return out;
}

export async function getPayoutBreakdown(
  prisma: PrismaClient,
  payoutId: string
): Promise<PayoutBreakdown | null> {
  const payout = await prisma.stripePayout.findUnique({
    where: { id: payoutId },
    include: {
      lines: {
        orderBy: [{ net: "desc" }],
        include: {
          payment: {
            select: {
              id: true,
              paidAt: true,
              reservation: {
                select: {
                  id: true,
                  groupId: true,
                  reservationType: true,
                  pet: { select: { name: true } },
                  owner: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
          order: { select: { id: true, orderNumber: true, paidAt: true, email: true } },
        },
      },
    },
  });
  if (!payout) return null;

  // ── Mascotas del grupo ────────────────────────────────────────────────────
  // En una reserva de varias mascotas se crea un Payment POR reserva, pero el
  // `stripePaymentIntentId` se guarda SOLO en el primero (ver
  // routes/reservations.ts). Sin esto, un cobro de tres perros se mostraría
  // como si fuera de uno.
  const groupIds = [
    ...new Set(
      payout.lines
        .map((l) => l.payment?.reservation?.groupId)
        .filter((g): g is string => !!g)
    ),
  ];
  const grupos = groupIds.length
    ? await prisma.reservation.findMany({
        where: { groupId: { in: groupIds } },
        select: { groupId: true, pet: { select: { name: true } } },
      })
    : [];
  const petsByGroup = new Map<string, string[]>();
  for (const r of grupos) {
    if (!r.groupId) continue;
    const arr = petsByGroup.get(r.groupId) ?? [];
    if (r.pet?.name) arr.push(r.pet.name);
    petsByGroup.set(r.groupId, arr);
  }

  // ── Cobros que nunca llegaron a `payments` ────────────────────────────────
  // Se resuelven por la metadata de Stripe. Sin esto la pantalla los muestra
  // como "movimiento sin reserva asociada", que es justo NO contestar la
  // pregunta que motivó la feature.
  // Basta con CUALQUIERA de los dos hilos: los cobros de saldo traen
  // `reservationId` pero no `ownerId`, y exigir el dueño los dejaba fuera.
  const huerfanas = payout.lines.filter(
    (l) => !l.payment && !l.order && (l.metaOwnerId || l.metaReservationId)
  );
  const desdeMeta = await resolverDesdeMetadata(prisma, huerfanas);

  const lines: PayoutLineDTO[] = payout.lines.map((l) => {
    let match: PayoutLineMatch | null = null;

    if (l.order) {
      match = {
        kind: "STORE_ORDER",
        paymentId: null,
        reservationId: null,
        orderId: l.order.id,
        orderNumber: l.order.orderNumber,
        petNames: [],
        ownerName: l.order.email,
        serviceLabel: "Tienda",
        paidAt: l.order.paidAt?.toISOString() ?? null,
      };
    } else if (l.payment) {
      const resv = l.payment.reservation;
      const petNames = resv?.groupId
        ? (petsByGroup.get(resv.groupId) ?? [])
        : resv?.pet?.name
          ? [resv.pet.name]
          : [];
      const owner = resv?.owner;
      match = {
        kind: l.type.startsWith("refund") || l.type === "payment_refund" ? "REFUND" : "RESERVATION",
        paymentId: l.payment.id,
        reservationId: resv?.id ?? null,
        orderId: null,
        orderNumber: null,
        petNames,
        ownerName: owner ? [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() || null : null,
        serviceLabel: SERVICE_LABEL[resv?.reservationType ?? ""] ?? "Reserva",
        paidAt: l.payment.paidAt?.toISOString() ?? null,
      };
    } else {
      // Último recurso: la metadata de Stripe. Sigue quedando `null` para las
      // líneas que de verdad no son de nadie (comisiones, ajustes).
      match = desdeMeta.get(l.id) ?? null;
    }

    return {
      id: l.id,
      type: l.type,
      gross: Number(l.gross),
      fee: Number(l.fee),
      net: Number(l.net),
      description: l.description,
      stripePaymentIntentId: l.stripePaymentIntentId,
      match,
    };
  });

  const sum = (pick: (l: PayoutLineDTO) => number) => lines.reduce((a, l) => a + pick(l), 0);
  const netTotal = sum((l) => l.net);
  const amount = Number(payout.amount);
  const diferencia = Number((netTotal - amount).toFixed(2));

  return {
    id: payout.id,
    amount,
    currency: payout.currency,
    status: payout.status,
    arrivalDate: payout.arrivalDate.toISOString(),
    stripeCreatedAt: payout.stripeCreatedAt.toISOString(),
    syncedAt: payout.syncedAt.toISOString(),
    failureMessage: payout.failureMessage,
    totals: {
      gross: Number(sum((l) => l.gross).toFixed(2)),
      fees: Number(sum((l) => l.fee).toFixed(2)),
      net: Number(netTotal.toFixed(2)),
      matched: lines.filter((l) => l.match).length,
      unmatched: lines.filter((l) => !l.match).length,
      sinRegistrar: lines.filter((l) => l.match?.kind === "SIN_REGISTRAR").length,
      sinRegistrarMonto: Number(
        lines
          .filter((l) => l.match?.kind === "SIN_REGISTRAR")
          .reduce((a, l) => a + l.gross, 0)
          .toFixed(2)
      ),
    },
    cuadra: Math.abs(diferencia) < 0.01,
    diferencia,
    lines,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  listPayouts
// ─────────────────────────────────────────────────────────────────────────────

export type PayoutSummary = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: string;
  lineCount: number;
  /** Mascotas/clientes representativos, para reconocer el depósito de un vistazo. */
  preview: string[];
};

/**
 * Lista de depósitos para la pantalla. `amount` filtra por el monto exacto que
 * el dueño ve en su estado de cuenta — es la forma natural de buscar: "me
 * llegaron $663.80, ¿de qué son?".
 */
export async function listPayouts(
  prisma: PrismaClient,
  opts: { limit?: number; amount?: number } = {}
): Promise<PayoutSummary[]> {
  const payouts = await prisma.stripePayout.findMany({
    where: opts.amount != null
      ? {
          // Tolerancia de un centavo: el monto llega del cliente como float.
          amount: { gte: opts.amount - 0.01, lte: opts.amount + 0.01 },
        }
      : undefined,
    orderBy: { arrivalDate: "desc" },
    take: opts.limit ?? 20,
    include: {
      lines: {
        select: {
          metaPetIds: true,
          payment: {
            select: { reservation: { select: { pet: { select: { name: true } } } } },
          },
          order: { select: { orderNumber: true } },
        },
      },
    },
  });

  // Nombres de las mascotas que solo se conocen por la metadata (cobros que
  // nunca llegaron a `payments`). Sin esto la lista muestra "3 movimientos" y
  // hay que abrir el depósito para saber de quién era.
  const idsDeMeta = [
    ...new Set(
      payouts.flatMap((p) =>
        p.lines.flatMap((l) =>
          (l.metaPetIds ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        )
      )
    ),
  ];
  const petsMeta = idsDeMeta.length
    ? await prisma.pet.findMany({
        where: { id: { in: idsDeMeta } },
        select: { id: true, name: true },
      })
    : [];
  const petNameById = new Map(petsMeta.map((p) => [p.id, p.name]));

  return payouts.map((p) => {
    const names: string[] = [];
    const push = (n: string | undefined | null) => {
      if (n && !names.includes(n)) names.push(n);
    };
    for (const l of p.lines) {
      if (l.payment?.reservation?.pet?.name) push(l.payment.reservation.pet.name);
      else if (l.order) push("Tienda");
      else {
        for (const id of (l.metaPetIds ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
          push(petNameById.get(id));
        }
      }
    }
    return {
      id: p.id,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      arrivalDate: p.arrivalDate.toISOString(),
      lineCount: p.lines.length,
      preview: names.slice(0, 4),
    };
  });
}
