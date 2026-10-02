/**
 * Método de un cobro que captura el EQUIPO desde la app (efectivo,
 * transferencia o tarjeta en la terminal física).
 *
 * El porqué: la app solo ofrecía efectivo/transferencia, así que un cobro con
 * terminal se registraba mal o no se registraba. La tarjeta exige el TIPO
 * (débito/crédito/Amex) porque la comisión de la terminal cambia por tipo y el
 * negocio la absorbe: sin él no se puede calcular el neto que de verdad cae.
 *
 * Misma fórmula que el panel web (`lib/comision-tarjeta.ts` en
 * holidog-inn-web-app): tasa de Config → Tarifas (`LodgingPricing.cardFee*`),
 * × 1.16 si `cardFeeIvaIncluded`, redondeada a centavos. `amount` sigue siendo
 * SIEMPRE el bruto que pagó el cliente; la comisión viaja aparte en
 * `cardFee*` (si se neteara, se descontaría dos veces en los reportes).
 */
import { Prisma } from "@holidoginn/db";
import type { PrismaClient } from "@holidoginn/db";

export const MANUAL_METHODS = ["CASH", "TRANSFER", "CARD"] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];

export const CARD_BRANDS = ["DEBIT", "CREDIT", "AMEX"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

const IVA = 0.16;

const CARD_BRAND_LABEL: Record<CardBrand, string> = {
  DEBIT: "débito",
  CREDIT: "crédito",
  AMEX: "Amex",
};

export type ParsedManualMethod =
  | { ok: true; method: ManualMethod; cardBrand: CardBrand | null }
  | { ok: false; error: string };

/**
 * Valida método + tipo de tarjeta del body. `method` ausente = CASH (el
 * default histórico de estos endpoints). Con método ≠ CARD el tipo se ignora.
 */
export function parseManualMethod(
  rawMethod: unknown,
  rawCardBrand: unknown,
): ParsedManualMethod {
  const method = rawMethod ?? "CASH";
  if (!MANUAL_METHODS.includes(method as ManualMethod)) {
    return { ok: false, error: "Método inválido" };
  }
  if (method !== "CARD") {
    return { ok: true, method: method as ManualMethod, cardBrand: null };
  }
  if (!CARD_BRANDS.includes(rawCardBrand as CardBrand)) {
    return {
      ok: false,
      error: "Indica el tipo de tarjeta (débito, crédito o Amex)",
    };
  }
  return { ok: true, method: "CARD", cardBrand: rawCardBrand as CardBrand };
}

/** Etiqueta corta para la nota por default del pago: "CASH", "CARD débito". */
export function methodTag(method: ManualMethod, cardBrand: CardBrand | null): string {
  return method === "CARD" && cardBrand ? `CARD ${CARD_BRAND_LABEL[cardBrand]}` : method;
}

export type CardFeeCfg = {
  debitPct: number;
  creditPct: number;
  amexPct: number;
  ivaIncluded: boolean;
};

/** Comisión de la terminal (pura, para poder probarla sin base). */
export function computeCardFee(
  amount: number,
  cfg: CardFeeCfg,
  brand: CardBrand,
): { pct: number; fee: number } {
  const base =
    brand === "DEBIT" ? cfg.debitPct : brand === "CREDIT" ? cfg.creditPct : cfg.amexPct;
  const pct = base * (cfg.ivaIncluded ? 1 + IVA : 1);
  return { pct, fee: Math.round(amount * pct * 100) / 100 };
}

type PricingReader = Pick<PrismaClient, "lodgingPricing">;

/**
 * Columnas de snapshot (`cardBrand`, `cardFeePct`, `cardFeeAmount`) para el
 * `payment.create`. Con método ≠ CARD van en null. Si no hay tasas
 * configuradas, se guarda el tipo sin comisión (el cobro no se bloquea por eso;
 * el admin puede corregirlo desde el panel).
 */
export async function cardFeeSnapshot(
  db: PricingReader,
  method: ManualMethod,
  cardBrand: CardBrand | null,
  amount: number,
): Promise<{
  cardBrand: string | null;
  cardFeePct: Prisma.Decimal | null;
  cardFeeAmount: Prisma.Decimal | null;
}> {
  if (method !== "CARD" || !cardBrand) {
    return { cardBrand: null, cardFeePct: null, cardFeeAmount: null };
  }
  const row = await db.lodgingPricing.findFirst();
  if (!row) return { cardBrand, cardFeePct: null, cardFeeAmount: null };
  const { pct, fee } = computeCardFee(
    amount,
    {
      debitPct: Number(row.cardFeeDebitPct),
      creditPct: Number(row.cardFeeCreditPct),
      amexPct: Number(row.cardFeeAmexPct),
      ivaIncluded: row.cardFeeIvaIncluded,
    },
    cardBrand,
  );
  return {
    cardBrand,
    cardFeePct: new Prisma.Decimal(pct),
    cardFeeAmount: new Prisma.Decimal(fee),
  };
}
