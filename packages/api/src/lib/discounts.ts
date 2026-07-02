import type { PrismaClient, DiscountCode } from "@prisma/client";

// Resultado de resolver un código de descuento contra un subtotal y un alcance.
// - error != null  → el código se ingresó pero NO es válido (mensaje amigable).
// - error == null && discountCodeId == null → no se ingresó código (sin descuento).
// - error == null && discountCodeId != null → código válido; `discountTotal` aplica.
export interface ResolvedDiscount {
  discountTotal: number;
  discountCodeId: string | null;
  dc: DiscountCode | null;
  error: string | null;
}

// Valida y calcula el descuento de un código, centralizando la lógica que antes
// vivía inline en la tienda (orders.ts). La usan la tienda, las reservas de
// hotel/baño y sus endpoints de validación en vivo. Todos los códigos aplican
// por igual en tienda y reservas (no hay alcance). NO verifica `firstOrderOnly`
// (es específico de la tienda: depende de userId/email y del historial de
// Orders; se checa en su call-site).
//
// El monto se calcula SIEMPRE aquí, server-side, y queda acotado a [0, subtotal].
export async function resolveDiscount(
  prisma: PrismaClient,
  opts: { code?: string | null; subtotal: number }
): Promise<ResolvedDiscount> {
  const none: ResolvedDiscount = {
    discountTotal: 0,
    discountCodeId: null,
    dc: null,
    error: null,
  };

  const code = (opts.code ?? "").trim().toUpperCase();
  if (!code) return none;

  const subtotal = Number(opts.subtotal);
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return { ...none, error: "Código inválido o expirado" };
  }

  const dc = await prisma.discountCode.findUnique({ where: { code } });
  const now = new Date();
  const vigente =
    dc &&
    dc.isActive &&
    (!dc.startsAt || dc.startsAt <= now) &&
    (!dc.endsAt || dc.endsAt >= now) &&
    (dc.maxUses === null || dc.usesCount < dc.maxUses);

  if (!dc || !vigente) {
    return { ...none, dc, error: "Código inválido o expirado" };
  }
  if (dc.minSubtotal && subtotal < Number(dc.minSubtotal)) {
    return {
      ...none,
      dc,
      error: `Aplica desde ${Number(dc.minSubtotal).toFixed(2)} de subtotal`,
    };
  }

  // value siempre >= 0 (defensa por si se insertó un código inválido en BD).
  const value = Math.max(0, Number(dc.value));
  let discountTotal =
    dc.type === "PERCENT"
      ? Number(((subtotal * value) / 100).toFixed(2))
      : Math.min(value, subtotal);
  discountTotal = Math.min(Math.max(0, discountTotal), subtotal);

  return { discountTotal, discountCodeId: dc.id, dc, error: null };
}
