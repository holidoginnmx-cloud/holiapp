import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@holidoginn/db";

// Header donde el storefront envía el token del carrito de invitado (cookie).
export const CART_TOKEN_HEADER = "x-cart-token";

export function getCartToken(request: FastifyRequest): string | null {
  const v = request.headers[CART_TOKEN_HEADER];
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

// Carrito ACTIVE del usuario (si está logueado) o del token de invitado.
// Si `create` y no existe, lo crea. Devuelve null si es invitado sin token.
export async function resolveActiveCart(
  prisma: PrismaClient,
  userId: string | null,
  token: string | null,
  create: boolean
) {
  if (userId) {
    const existing = await prisma.cart.findFirst({
      where: { userId, status: "ACTIVE" },
    });
    if (existing) return existing;
    if (!create) return null;
    return prisma.cart.create({ data: { userId } });
  }
  if (token) {
    const existing = await prisma.cart.findFirst({
      where: { sessionToken: token, status: "ACTIVE" },
    });
    if (existing) return existing;
    if (!create) return null;
    try {
      return await prisma.cart.create({ data: { sessionToken: token } });
    } catch {
      // Carrera: otra petición concurrente con el mismo token ya creó el carrito
      // (sessionToken es @unique). Reintentar la lectura.
      const retry = await prisma.cart.findFirst({
        where: { sessionToken: token, status: "ACTIVE" },
      });
      if (retry) return retry;
      throw new Error("No se pudo resolver el carrito");
    }
  }
  return null;
}

export type CartItemDetail = {
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  inStock: boolean;
  maxQuantity: number | null; // null = sin límite (no controla stock)
};

export type CartDetail = {
  id: string;
  items: CartItemDetail[];
  subtotal: number;
  count: number;
};

// Carga el detalle del carrito recalculando precios desde la variante actual
// (no confía en el snapshot, para reflejar cambios de precio del admin).
export async function loadCartDetail(
  prisma: PrismaClient,
  cartId: string
): Promise<CartDetail> {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    include: {
      variant: {
        include: {
          inventory: true,
          product: { include: { images: { orderBy: { sortOrder: "asc" } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const detail: CartItemDetail[] = items.map((it) => {
    const v = it.variant;
    const tracks = v.inventory?.trackInventory ?? false;
    const qtyAvailable = v.inventory?.quantity ?? 0;
    const unitPrice = Number(v.price);
    const primary = v.product.images.find((i) => i.isPrimary) ?? v.product.images[0] ?? null;
    return {
      variantId: v.id,
      productId: v.productId,
      productSlug: v.product.slug,
      name: v.product.name,
      variantTitle: v.title,
      imageUrl: primary?.url ?? null,
      unitPrice,
      quantity: it.quantity,
      lineTotal: Number((unitPrice * it.quantity).toFixed(2)),
      inStock: v.isActive && v.product.isActive && (!tracks || qtyAvailable > 0),
      maxQuantity: tracks ? qtyAvailable : null,
    };
  });

  const subtotal = Number(detail.reduce((s, i) => s + i.lineTotal, 0).toFixed(2));
  const count = detail.reduce((s, i) => s + i.quantity, 0);
  return { id: cartId, items: detail, subtotal, count };
}
