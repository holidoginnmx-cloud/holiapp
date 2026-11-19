import { Prisma } from "@holidoginn/db";
import type { PrismaClient } from "@holidoginn/db";
import type { OpError, OpResult } from "./reservationAdminOps";

// Locales (no importados de reservationAdminOps): ese módulo importa éste para
// el cobro de la cuenta, y una importación circular de valores es frágil.
const fail = (status: number, error: string, code?: string): OpError => ({
  ok: false,
  status,
  error,
  code,
});
const ok = <T>(data: T): OpResult<T> => ({ ok: true, data });

/**
 * Productos de la tienda en la CUENTA de una reserva (Javier, 18-nov-2026).
 *
 * El cliente que viene por su perro se lleva una correa: antes había que hacer
 * una venta de mostrador aparte del cobro de la estancia. Ahora el producto se
 * agrega a la cuenta de la reserva y se cobra junto con ella.
 *
 * Modelo:
 *   · Una cuenta = un pedido `channel COUNTER, status PENDING` con
 *     `reservationId`. Los productos que se agregan después se suman a ese
 *     mismo pedido (si por una carrera nacieran dos, todo el código suma los
 *     PENDING de la reserva, así que no se pierde nada).
 *   · El stock se descuenta AL AGREGAR (el producto ya se lo llevó o quedó
 *     apartado), con la misma regla que la venta de mostrador: piso en 0.
 *     Quitarlo de la cuenta lo devuelve.
 *   · Al cobrar la cuenta (`registerManualPayment` del panel web y
 *     `/admin/payments/manual` de la app) se pagan PRIMERO los productos
 *     completos —un Payment por pedido, con `orderId`— y el resto va a la
 *     reserva. Así el dinero del producto cuenta como TIENDA en las vistas de
 *     ingresos y no infla el hospedaje, y el pedido pasa a PAID.
 *   · El saldo que ve el EQUIPO suma los productos pendientes. La app del
 *     cliente no cambia: el producto se cobra en el mostrador.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const ACCOUNT_ORDER_INCLUDE = {
  items: {
    select: {
      id: true,
      productNameSnapshot: true,
      variantTitleSnapshot: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      variantId: true,
    },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.OrderInclude;

/** "Default Title" es el título de la variante única de Shopify: no dice nada. */
export function variantLabel(title: string | null | undefined): string | null {
  return title && title !== "Default Title" ? title : null;
}

/** Pedidos de la cuenta todavía sin cobrar. */
export function pendingAccountOrders(db: Db, reservationId: string) {
  return db.order.findMany({
    where: { reservationId, status: "PENDING" },
    include: ACCOUNT_ORDER_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

/** Todos los pedidos de la cuenta (pendientes y ya cobrados), para el detalle. */
export function accountOrders(db: Db, reservationId: string) {
  return db.order.findMany({
    where: { reservationId, status: { in: ["PENDING", "PAID", "FULFILLED"] } },
    include: ACCOUNT_ORDER_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

export function sumOrders(orders: { total: Prisma.Decimal | number }[]): number {
  return round2(orders.reduce((s, o) => s + Number(o.total), 0));
}

/**
 * Reparte un cobro entre los productos pendientes y la reserva. Los productos
 * se pagan COMPLETOS y primero; si el monto no alcanza, error (un producto a
 * medio pagar no tiene a qué Payment colgarse sin partir el pedido).
 *
 * `cardFeeAmount` es el recargo de tarjeta del cobro COMPLETO (snapshot que
 * calcula el panel web): se prorratea por monto, y el último pedazo se lleva
 * el residuo de redondeo para que la suma sea exacta.
 */
export function planAccountCharge(
  amount: number,
  orders: { id: string; total: Prisma.Decimal | number }[],
  cardFeeAmount: number | null = null
):
  | {
      ok: true;
      products: { orderId: string; amount: number; fee: number | null }[];
      remainder: number;
      remainderFee: number | null;
    }
  | { ok: false; productsTotal: number } {
  const productsTotal = sumOrders(orders);
  if (amount + 0.005 < productsTotal) return { ok: false, productsTotal };

  const pieces = orders.map((o) => ({ orderId: o.id, amount: round2(Number(o.total)) }));
  const remainder = round2(amount - productsTotal);

  if (cardFeeAmount == null || amount <= 0) {
    return {
      ok: true,
      products: pieces.map((p) => ({ ...p, fee: null })),
      remainder,
      remainderFee: null,
    };
  }
  let asignado = 0;
  const products = pieces.map((p) => {
    const fee = round2((cardFeeAmount * p.amount) / amount);
    asignado += fee;
    return { ...p, fee };
  });
  const remainderFee = round2(cardFeeAmount - asignado);
  // Sin remanente para la reserva, el residuo de redondeo va al último producto.
  if (remainder <= 0.005 && products.length > 0) {
    const last = products[products.length - 1]!;
    last.fee = round2((last.fee ?? 0) + remainderFee);
    return { ok: true, products, remainder: 0, remainderFee: null };
  }
  return { ok: true, products, remainder, remainderFee };
}

/** El mensaje para un cobro que no alcanza para los productos de la cuenta. */
export function msgCobroNoAlcanza(amount: number, productsTotal: number) {
  const m = (n: number) => n.toLocaleString("es-MX");
  return `El cobro ($${m(amount)}) no alcanza para los productos de la cuenta ($${m(productsTotal)}). Cobra al menos eso o quita los productos.`;
}

/**
 * Cobra los pedidos de la cuenta dentro de una transacción ya abierta. El
 * `updateMany` condicional evita cobrar dos veces el mismo pedido si dos
 * cobros corren a la vez: el segundo truena y su transacción se deshace.
 */
export async function settleAccountOrders(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    pieces: {
      orderId: string;
      amount: number;
      card: {
        cardBrand: string | null;
        cardFeePct: Prisma.Decimal | null;
        cardFeeAmount: Prisma.Decimal | null;
      };
    }[];
    method: "CASH" | "TRANSFER" | "CARD";
    paidAt: Date;
    reference?: string | null;
  }
) {
  const payments = [];
  for (const p of params.pieces) {
    // Condicional también sobre el TOTAL: si alguien agregó o quitó un
    // producto entre la lectura y aquí, el pedido ya no vale lo que se va a
    // cobrar y es mejor abortar (409, reintento) que cobrar de menos.
    const marcado = await tx.order.updateMany({
      where: { id: p.orderId, status: "PENDING", total: new Prisma.Decimal(p.amount) },
      data: { status: "PAID", paidAt: params.paidAt },
    });
    if (marcado.count === 0) throw new AccountConflictError();
    const order = await tx.order.findUniqueOrThrow({
      where: { id: p.orderId },
      select: { orderNumber: true },
    });
    payments.push(
      await tx.payment.create({
        data: {
          amount: new Prisma.Decimal(p.amount),
          method: params.method,
          status: "PAID",
          kind: "FULL",
          paidAt: params.paidAt,
          reservationId: null,
          orderId: p.orderId,
          userId: params.ownerId,
          reference: params.reference?.trim() || null,
          notes: `Productos en la cuenta de la reserva · pedido #${order.orderNumber}`,
          ...p.card,
        },
      })
    );
  }
  return payments;
}

/** Otro cobro pagó el mismo pedido mientras tanto. */
export class AccountConflictError extends Error {
  constructor() {
    super("Los productos de la cuenta ya se cobraron en otro pago. Recarga y revisa el saldo.");
    this.name = "AccountConflictError";
  }
}

// ─── Agregar / quitar ────────────────────────────────────────────────────────

export async function addProductToAccount(
  prisma: PrismaClient,
  params: { reservationId: string; variantId: string; quantity: number }
) {
  const quantity = Math.trunc(params.quantity);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
    return fail(400, "La cantidad debe ser entre 1 y 99", "VALIDATION");
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.reservationId },
    select: { id: true, status: true, ownerId: true, pet: { select: { name: true } } },
  });
  if (!reservation) return fail(404, "Reservación no encontrada", "NOT_FOUND");
  if (reservation.status === "CANCELLED") {
    return fail(400, "La reservación está cancelada", "CANCELLED");
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: params.variantId },
    select: {
      id: true,
      title: true,
      price: true,
      isActive: true,
      product: { select: { name: true, isActive: true } },
    },
  });
  if (!variant || !variant.isActive || !variant.product.isActive) {
    return fail(404, "El producto ya no está disponible", "NOT_FOUND");
  }

  const unit = round2(Number(variant.price));
  const res = await prisma.$transaction(async (tx) => {
    let order = await tx.order.findFirst({
      where: { reservationId: reservation.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    // Toma el candado de la fila con un update condicional: si un cobro está
    // pagando este pedido, esperamos a que termine y, ya PAID, el producto va a
    // un pedido nuevo en vez de colgarse de uno cobrado (no se cobraría nunca).
    if (order) {
      const vivo = await tx.order.updateMany({
        where: { id: order.id, status: "PENDING" },
        data: { updatedAt: new Date() },
      });
      if (vivo.count === 0) order = null;
    }
    if (!order) {
      order = await tx.order.create({
        data: {
          channel: "COUNTER",
          status: "PENDING",
          fulfillmentType: "PICKUP",
          subtotal: new Prisma.Decimal(0),
          total: new Prisma.Decimal(0),
          userId: reservation.ownerId,
          reservationId: reservation.id,
          notes: `Cuenta de la reserva de ${reservation.pet.name}`,
        },
        select: { id: true },
      });
    }
    const item = await tx.orderItem.create({
      data: {
        orderId: order.id,
        variantId: variant.id,
        productNameSnapshot: variant.product.name,
        variantTitleSnapshot: variant.title,
        unitPrice: new Prisma.Decimal(unit),
        quantity,
        lineTotal: new Prisma.Decimal(round2(unit * quantity)),
      },
    });
    // Decremento atómico con piso en 0, igual que crear_venta_mostrador. `::int`
    // obligatorio: Prisma manda los enteros como bigint (incidente 42883).
    const left = await tx.$queryRaw<{ quantity: number }[]>`
      update inventory
         set quantity = greatest(quantity - ${quantity}::int, 0), "updatedAt" = now()
       where "variantId" = ${variant.id} and "trackInventory" = true
      returning quantity`;
    await recomputeOrderTotals(tx, order.id);
    return { orderId: order.id, itemId: item.id, agotado: left[0]?.quantity === 0 };
  });

  return ok({
    success: true as const,
    ...res,
    productName: variant.product.name,
    unitPrice: unit,
    lineTotal: round2(unit * quantity),
  });
}

export async function removeProductFromAccount(
  prisma: PrismaClient,
  params: { reservationId: string; itemId: string }
) {
  const item = await prisma.orderItem.findUnique({
    where: { id: params.itemId },
    select: {
      id: true,
      quantity: true,
      variantId: true,
      order: { select: { id: true, status: true, reservationId: true } },
    },
  });
  if (!item || item.order.reservationId !== params.reservationId) {
    return fail(404, "Ese producto no está en la cuenta de esta reserva", "NOT_FOUND");
  }
  if (item.order.status !== "PENDING") {
    return fail(
      409,
      "Ese producto ya se cobró. Para devolverlo, haz el ajuste desde la tienda.",
      "ALREADY_PAID"
    );
  }

  await prisma.$transaction(async (tx) => {
    // Update condicional = candado de la fila: si el pedido se cobró entre la
    // lectura y aquí (o se está cobrando), no se borra.
    const vivo = await tx.order.updateMany({
      where: { id: item.order.id, status: "PENDING" },
      data: { updatedAt: new Date() },
    });
    if (vivo.count === 0) throw new AccountConflictError();
    if (item.variantId) {
      await tx.$executeRaw`
        update inventory
           set quantity = quantity + ${item.quantity}::int, "updatedAt" = now()
         where "variantId" = ${item.variantId} and "trackInventory" = true`;
    }
    await tx.orderItem.delete({ where: { id: item.id } });
    const quedan = await tx.orderItem.count({ where: { orderId: item.order.id } });
    if (quedan === 0) await tx.order.delete({ where: { id: item.order.id } });
    else await recomputeOrderTotals(tx, item.order.id);
  });

  return ok({ success: true as const });
}

async function recomputeOrderTotals(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { lineTotal: true } });
  const total = round2(items.reduce((s, i) => s + Number(i.lineTotal), 0));
  await tx.order.update({
    where: { id: orderId },
    data: { subtotal: new Prisma.Decimal(total), total: new Prisma.Decimal(total) },
  });
}

/**
 * Antes de borrar una reserva: si su cuenta tiene productos sin cobrar, el
 * borrado dejaría el stock descontado y la venta huérfana. Se pide quitarlos
 * (o cobrarlos) primero.
 */
export async function countPendingAccountOrders(db: Db, reservationIds: string[]) {
  return db.order.count({ where: { reservationId: { in: reservationIds }, status: "PENDING" } });
}

/**
 * Al cancelar una reserva, los productos de su cuenta que no se cobraron se
 * liberan: el pedido pasa a CANCELLED y el stock regresa. (Si el cliente sí se
 * llevó el producto, se registra como venta de mostrador normal.)
 */
export async function releasePendingAccountOrders(prisma: PrismaClient, reservationIds: string[]) {
  try {
    return await releasePendingAccountOrdersUnsafe(prisma, reservationIds);
  } catch (e) {
    // La cancelación ya se confirmó: si esto falla, mejor un log que un 500
    // que además se saltaría los avisos al cliente. Los productos se pueden
    // quitar a mano después desde la reserva.
    console.error("[reservationAccount] no se pudieron liberar productos", reservationIds, e);
    return 0;
  }
}

async function releasePendingAccountOrdersUnsafe(prisma: PrismaClient, reservationIds: string[]) {
  const orders = await prisma.order.findMany({
    where: { reservationId: { in: reservationIds }, status: "PENDING" },
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
  });
  for (const o of orders) {
    await prisma.$transaction(async (tx) => {
      const marcado = await tx.order.updateMany({
        where: { id: o.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (marcado.count === 0) return;
      for (const it of o.items) {
        if (!it.variantId) continue;
        await tx.$executeRaw`
          update inventory
             set quantity = quantity + ${it.quantity}::int, "updatedAt" = now()
           where "variantId" = ${it.variantId} and "trackInventory" = true`;
      }
    });
  }
  return orders.length;
}
