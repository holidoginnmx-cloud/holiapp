import { FastifyInstance } from "fastify";
import { Prisma } from "@holidoginn/db";
import { createOptionalAuthMiddleware } from "../middleware/auth";
import {
  getCartToken,
  loadCartDetail,
  resolveActiveCart,
} from "../lib/store";

// ---------------------------------------------------------------------------
// Tienda en línea — carrito. Auth OPCIONAL: usuario logueado (Clerk) o invitado
// (token en header X-Cart-Token, generado por el storefront en cookie httpOnly).
//   GET    /store/cart
//   POST   /store/cart/items           { variantId, quantity }
//   PATCH  /store/cart/items/:variantId { quantity }   (0 elimina)
//   DELETE /store/cart/items/:variantId
//   POST   /store/cart/merge           fusiona carrito invitado al del usuario
// ---------------------------------------------------------------------------

const EMPTY = (id: string | null) => ({
  id,
  items: [] as never[],
  subtotal: 0,
  count: 0,
});

export default async function cartRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const optionalAuth = createOptionalAuthMiddleware(prisma);

  fastify.get("/store/cart", { preHandler: [optionalAuth] }, async (request) => {
    const userId = request.userId ?? null;
    const token = getCartToken(request);
    const cart = await resolveActiveCart(prisma, userId, token, false);
    if (!cart) return EMPTY(null);
    return loadCartDetail(prisma, cart.id);
  });

  fastify.post<{ Body: { variantId?: string; quantity?: number } }>(
    "/store/cart/items",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const { variantId, quantity = 1 } = request.body ?? {};
      if (!variantId || quantity < 1) {
        return reply.status(400).send({ error: "variantId y quantity (>=1) requeridos" });
      }

      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        include: { inventory: true, product: true },
      });
      if (!variant || !variant.isActive || !variant.product.isActive) {
        return reply.status(404).send({ error: "Variante no disponible" });
      }

      const userId = request.userId ?? null;
      const token = getCartToken(request);
      const cart = await resolveActiveCart(prisma, userId, token, true);
      if (!cart) {
        return reply.status(400).send({ error: "Falta el token de carrito" });
      }

      const existing = await prisma.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
      });
      const desired = (existing?.quantity ?? 0) + quantity;

      // Respetar stock si la variante lo controla.
      const tracks = variant.inventory?.trackInventory ?? false;
      const max = variant.inventory?.quantity ?? 0;
      const finalQty = tracks ? Math.min(desired, max) : desired;
      if (tracks && max <= 0) {
        return reply.status(409).send({ error: "Sin existencias" });
      }

      await prisma.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId } },
        create: {
          cartId: cart.id,
          variantId,
          quantity: finalQty,
          unitPriceSnapshot: new Prisma.Decimal(variant.price),
        },
        update: {
          quantity: finalQty,
          unitPriceSnapshot: new Prisma.Decimal(variant.price),
        },
      });

      return loadCartDetail(prisma, cart.id);
    }
  );

  fastify.patch<{ Params: { variantId: string }; Body: { quantity?: number } }>(
    "/store/cart/items/:variantId",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const { variantId } = request.params;
      const quantity = request.body?.quantity ?? 0;

      const userId = request.userId ?? null;
      const token = getCartToken(request);
      const cart = await resolveActiveCart(prisma, userId, token, false);
      if (!cart) return reply.status(404).send({ error: "Carrito no encontrado" });

      if (quantity <= 0) {
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
        return loadCartDetail(prisma, cart.id);
      }

      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        include: { inventory: true },
      });
      if (!variant) return reply.status(404).send({ error: "Variante no encontrada" });

      const tracks = variant.inventory?.trackInventory ?? false;
      const max = variant.inventory?.quantity ?? 0;
      const finalQty = tracks ? Math.min(quantity, max) : quantity;

      await prisma.cartItem.updateMany({
        where: { cartId: cart.id, variantId },
        data: { quantity: finalQty },
      });

      return loadCartDetail(prisma, cart.id);
    }
  );

  fastify.delete<{ Params: { variantId: string } }>(
    "/store/cart/items/:variantId",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const userId = request.userId ?? null;
      const token = getCartToken(request);
      const cart = await resolveActiveCart(prisma, userId, token, false);
      if (!cart) return reply.status(404).send({ error: "Carrito no encontrado" });
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id, variantId: request.params.variantId },
      });
      return loadCartDetail(prisma, cart.id);
    }
  );

  // Fusiona el carrito de invitado (token) en el carrito del usuario logueado.
  // Se llama tras iniciar sesión. Suma cantidades por variante.
  fastify.post(
    "/store/cart/merge",
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const userId = request.userId ?? null;
      if (!userId) return reply.status(401).send({ error: "Requiere sesión" });
      const token = getCartToken(request);
      if (!token) return loadCartDetail(prisma, (await resolveActiveCart(prisma, userId, null, true))!.id);

      const guestCart = await prisma.cart.findFirst({
        where: { sessionToken: token, status: "ACTIVE" },
        include: { items: true },
      });
      const userCart = await resolveActiveCart(prisma, userId, null, true);
      if (!userCart) return reply.status(500).send({ error: "No se pudo crear el carrito" });

      if (guestCart && guestCart.id !== userCart.id) {
        for (const item of guestCart.items) {
          const existing = await prisma.cartItem.findUnique({
            where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
          });
          // Topar la cantidad fusionada al stock disponible para no dejar el
          // carrito en un estado inválido que falle en el checkout.
          const variant = await prisma.productVariant.findUnique({
            where: { id: item.variantId },
            include: { inventory: true },
          });
          const tracks = variant?.inventory?.trackInventory ?? false;
          const max = variant?.inventory?.quantity ?? 0;
          const desired = (existing?.quantity ?? 0) + item.quantity;
          const finalQty = tracks ? Math.min(desired, max) : desired;
          if (finalQty <= 0) continue;
          await prisma.cartItem.upsert({
            where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
            create: {
              cartId: userCart.id,
              variantId: item.variantId,
              quantity: finalQty,
              unitPriceSnapshot: item.unitPriceSnapshot,
            },
            update: { quantity: finalQty },
          });
        }
        // Liberar el carrito de invitado SOLO si sigue ACTIVE (evita pisar un
        // CONVERTED que pudo haber dejado el webhook de pago).
        await prisma.cart.updateMany({
          where: { id: guestCart.id, status: "ACTIVE" },
          data: { status: "ABANDONED", sessionToken: null },
        });
      }

      return loadCartDetail(prisma, userCart.id);
    }
  );
}
