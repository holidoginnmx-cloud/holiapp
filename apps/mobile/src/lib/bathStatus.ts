import { COLORS } from "@/constants/colors";

// Estado de un baño, derivado en un solo lugar.
//
// El status de la reserva no alcanza para contarlo: un baño ya hecho pero con
// saldo pendiente se queda en CONFIRMED a propósito (para poder cobrarlo al
// entregar), y se veía idéntico a uno que ni ha empezado. Estas funciones
// distinguen los tres momentos: pendiente → hecho, falta cobrar → concluido.
//
// Vivían duplicadas en las tres pantallas de baños; cualquier cambio de
// criterio tenía que hacerse tres veces.

type AddonLike = {
  completedAt?: string | Date | null;
  extraPrice?: string | number | null;
  extraPaymentStatus?: string | null;
  variant?: { serviceType?: { code?: string } | null } | null;
};

export type BathLike = {
  reservationType?: string;
  status?: string;
  addons?: AddonLike[] | null;
};

export function getBathAddon<T extends AddonLike>(bath: {
  addons?: T[] | null;
}): T | undefined {
  return (bath.addons ?? []).find((a) => a.variant?.serviceType?.code === "BATH");
}

/** Físicamente terminado: el equipo ya marcó el servicio como hecho. */
export function isBathPhysicallyDone(bath: BathLike): boolean {
  return !!getBathAddon(bath)?.completedAt;
}

/** Concluido: además ya se liquidó el saldo (extras + anticipo). */
export function isBathConcluded(bath: BathLike): boolean {
  if (bath.reservationType === "BATH") return bath.status === "CHECKED_OUT";
  return !!getBathAddon(bath)?.completedAt;
}

/** Hecho pero sin cobrar: lo que hay que ver de lejos al entregar al perro. */
export function isBathReadyToCollect(bath: BathLike): boolean {
  return (
    isBathPhysicallyDone(bath) &&
    bath.status !== "CHECKED_OUT" &&
    bath.status !== "CANCELLED"
  );
}

export function bathOutstandingBalance(bath: {
  totalAmount: string | number;
  payments?: { amount: string | number }[] | null;
  addons?: AddonLike[] | null;
}): { deposit: number; extras: number; total: number } {
  const paid = (bath.payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const deposit = Math.max(0, Number(bath.totalAmount) - paid);
  const extras = (bath.addons ?? []).reduce((sum, a) => {
    if (
      a.variant?.serviceType?.code === "BATH" &&
      a.extraPrice !== null &&
      a.extraPrice !== undefined &&
      a.extraPaymentStatus !== "PAID"
    ) {
      return sum + Number(a.extraPrice);
    }
    return sum;
  }, 0);
  return { deposit, extras, total: deposit + extras };
}

export type BathBadge = {
  kind: "concluded" | "readyToCollect" | "pending";
  label: string;
  bg: string;
  text: string;
};

/** La etiqueta que ve el equipo. Un solo nombre por concepto, en toda la app. */
export function deriveBathBadge(bath: BathLike): BathBadge {
  if (isBathConcluded(bath)) {
    return {
      kind: "concluded",
      label: "Concluida",
      bg: COLORS.successBg,
      text: COLORS.successText,
    };
  }
  if (isBathReadyToCollect(bath)) {
    return {
      kind: "readyToCollect",
      label: "Baño listo · por cobrar",
      bg: COLORS.warningBg,
      text: COLORS.warningText,
    };
  }
  return {
    kind: "pending",
    label: "Pendiente",
    bg: COLORS.infoBg,
    text: COLORS.infoText,
  };
}
