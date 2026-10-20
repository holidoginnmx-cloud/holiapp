/**
 * Avisos al equipo (ADMIN) de las ventas de la tienda en línea.
 *
 * Por qué existe: el pedido #8 (19-oct-2026, primera venta real con envío
 * nacional) se pagó a las 00:36. El push genérico «🛍️ Nuevo pedido en la
 * tienda · Pedido #8 por $310» SÍ salió a los 4 admins, pero de madrugada, sin
 * decir qué se vendió ni que había que mandar un paquete; nadie lo leyó y el
 * pedido se descubrió de casualidad en el panel. Dos arreglos:
 *
 *   1. El aviso inmediato dice qué se compró, cuánto y qué hay que hacer
 *      (mandarlo / llevarlo / tenerlo listo), con prioridad alta.
 *   2. Un recordatorio diario (desde las 9:00 del hotel) mientras haya pedidos
 *      en línea pagados sin despachar. Un aviso de madrugada se pierde; uno que
 *      se repite cada mañana, no.
 *
 * "Sin despachar" = status PAID y, si es envío nacional, sin número de guía. Se
 * apaga capturando la guía (app o panel web) o pasando el pedido a «Entregado».
 * Solo canal ONLINE: las ventas de mostrador se entregan en el acto y se quedan
 * en PAID para siempre.
 */
import type { Prisma, PrismaClient } from "@holidoginn/db";
import { adminsActivosIds, notifyUsers } from "./notify";
import { localMinutesOfDay, localYMD } from "./bathAvailability";
import { formatMoney } from "./notifyTeamPayment";

export type Fulfillment = "PICKUP" | "LOCAL_DELIVERY" | "NATIONAL_SHIPPING";

const QUE_HACER: Record<Fulfillment, string> = {
  NATIONAL_SHIPPING:
    "📦 Envío nacional: hay que mandarlo y capturar la guía (toca este aviso).",
  LOCAL_DELIVERY: "🛵 Entrega a domicilio en Hermosillo: hay que coordinar con el cliente.",
  PICKUP: "🏪 Lo recoge en el hotel: hay que tenerlo listo.",
};

const ETIQUETA: Record<Fulfillment, string> = {
  NATIONAL_SHIPPING: "envío nacional",
  LOCAL_DELIVERY: "entrega a domicilio",
  PICKUP: "recoge en el hotel",
};

// ─────────────────────────────────────────────────────────────────────────────
//  Aviso inmediato
// ─────────────────────────────────────────────────────────────────────────────

export type NewOrderInput = {
  orderNumber: number;
  total: number;
  fulfillmentType: Fulfillment;
  items: { name: string; quantity: number }[];
  /** Nombre del cliente con cuenta, o el correo del pedido de invitado. */
  customer: string | null;
};

/** "2× Pelota de tenis, Collar y 3 más". */
function resumenArticulos(items: NewOrderInput["items"]): string {
  const nombres = items.map((it) =>
    it.quantity > 1 ? `${it.quantity}× ${it.name}` : it.name
  );
  if (nombres.length <= 2) return nombres.join(", ");
  return `${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}

export function buildNewOrderMessage(o: NewOrderInput): { title: string; body: string } {
  const quien = o.customer?.trim() ? ` · ${o.customer.trim()}` : "";
  return {
    title: `🛍️ Venta en la tienda: ${formatMoney(o.total)}`,
    body:
      `Pedido #${o.orderNumber}${quien}: ${resumenArticulos(o.items)}.\n` +
      QUE_HACER[o.fulfillmentType],
  };
}

/** Nunca lanza: lo llama el webhook de Stripe, que no debe reintentar por un aviso. */
export async function avisarPedidoNuevo(
  prisma: PrismaClient,
  orderId: string,
  input: NewOrderInput
): Promise<void> {
  try {
    const admins = await adminsActivosIds(prisma);
    if (admins.length === 0) return;
    await notifyUsers(prisma, admins, {
      type: "GENERAL",
      ...buildNewOrderMessage(input),
      data: { kind: "STORE_ORDER", orderId, orderNumber: input.orderNumber },
      priority: "high",
    });
  } catch (err) {
    console.error("[tienda] avisarPedidoNuevo falló:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Recordatorio diario de pedidos sin despachar
// ─────────────────────────────────────────────────────────────────────────────

/** Ventana del recordatorio en hora del hotel: nunca de madrugada. */
const REMINDER_FROM_HOUR = 9;
const REMINDER_UNTIL_HOUR = 21;

const PENDING_KIND = "STORE_ORDERS_PENDING";

/**
 * Pedido en línea pagado que todavía no sale: sin guía si es envío nacional, o
 * sin marcar «Entregado» si se recoge / se lleva a domicilio. Fuente única: la
 * usan el recordatorio y la lista de la app (routes/adminStoreOrders.ts).
 */
export const PEDIDO_SIN_DESPACHAR = {
  channel: "ONLINE",
  status: "PAID",
  paidAt: { not: null },
  OR: [
    { fulfillmentType: { not: "NATIONAL_SHIPPING" } },
    { trackingNumber: null },
    { trackingNumber: "" },
  ],
} satisfies Prisma.OrderWhereInput;

export type PendingOrder = {
  orderNumber: number;
  fulfillmentType: Fulfillment;
  paidAt: Date;
};

/** Días de calendario DEL HOTEL entre dos instantes ("hoy" nunca sale de UTC). */
function diasHotel(desde: Date, hasta: Date): number {
  const a = Date.parse(`${localYMD(desde)}T00:00:00Z`);
  const b = Date.parse(`${localYMD(hasta)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function haceCuanto(paidAt: Date, now: Date): string {
  const d = diasHotel(paidAt, now);
  if (d <= 0) return "pagado hoy";
  if (d === 1) return "pagado ayer";
  return `pagado hace ${d} días`;
}

export function buildPendingOrdersMessage(
  orders: PendingOrder[],
  now: Date
): { title: string; body: string } {
  const n = orders.length;
  const hayEnvio = orders.some((o) => o.fulfillmentType === "NATIONAL_SHIPPING");
  const title =
    n === 1
      ? `📦 Tienes 1 pedido de la tienda sin ${hayEnvio ? "enviar" : "entregar"}`
      : `📦 Tienes ${n} pedidos de la tienda pendientes`;
  const lineas = orders.map(
    (o) => `#${o.orderNumber} · ${ETIQUETA[o.fulfillmentType]} · ${haceCuanto(o.paidAt, now)}`
  );
  const cierre = hayEnvio
    ? "Toca este aviso para capturar la guía; al guardarla se le avisa al cliente y esto se apaga."
    : "Toca este aviso para marcarlo como «Entregado» y que deje de avisar.";
  return { title, body: `${lineas.join("\n")}\n${cierre}` };
}

export async function sendPendingStoreOrderReminders(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<{ sent: number }> {
  const hour = Math.floor(localMinutesOfDay(now) / 60);
  if (hour < REMINDER_FROM_HOUR || hour >= REMINDER_UNTIL_HOUR) return { sent: 0 };

  const day = localYMD(now);
  const yaAvisado = await prisma.notification.findFirst({
    where: {
      type: "GENERAL",
      AND: [
        { data: { path: ["kind"], equals: PENDING_KIND } },
        { data: { path: ["day"], equals: day } },
      ],
    },
    select: { id: true },
  });
  if (yaAvisado) return { sent: 0 };

  const rows = await prisma.order.findMany({
    where: PEDIDO_SIN_DESPACHAR,
    select: { orderNumber: true, fulfillmentType: true, paidAt: true },
    orderBy: { paidAt: "asc" },
  });
  if (rows.length === 0) return { sent: 0 };

  const admins = await adminsActivosIds(prisma);
  if (admins.length === 0) return { sent: 0 };

  const orders: PendingOrder[] = rows.map((r) => ({
    orderNumber: r.orderNumber,
    fulfillmentType: r.fulfillmentType as Fulfillment,
    paidAt: r.paidAt as Date,
  }));
  await notifyUsers(prisma, admins, {
    type: "GENERAL",
    ...buildPendingOrdersMessage(orders, now),
    data: { kind: PENDING_KIND, day, orderNumbers: orders.map((o) => o.orderNumber) },
    priority: "high",
  });
  return { sent: admins.length };
}
