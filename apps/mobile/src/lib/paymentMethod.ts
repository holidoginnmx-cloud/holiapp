/**
 * Método de un cobro que captura el equipo (efectivo, transferencia o tarjeta
 * en la terminal). Con tarjeta se pide el TIPO porque la comisión de la
 * terminal cambia por tipo: la API calcula el neto con las tasas de
 * Config → Tarifas (ver packages/api/src/lib/manualPayment.ts).
 */
import { Alert, Platform, type AlertButton } from "react-native";

export type ManualPaymentMethod = "CASH" | "TRANSFER" | "CARD";
export type CardBrand = "DEBIT" | "CREDIT" | "AMEX";

/** Lo que viaja a los endpoints de pago manual. */
export interface ManualMethodPayload {
  method: ManualPaymentMethod;
  /** Solo con method = CARD. */
  cardBrand?: CardBrand;
}

export const MANUAL_METHOD_OPTIONS: { key: ManualPaymentMethod; label: string }[] = [
  { key: "CASH", label: "Efectivo" },
  { key: "TRANSFER", label: "Transferencia" },
  { key: "CARD", label: "Tarjeta" },
];

export const CARD_BRAND_OPTIONS: { key: CardBrand; label: string }[] = [
  { key: "DEBIT", label: "Débito" },
  { key: "CREDIT", label: "Crédito" },
  { key: "AMEX", label: "Amex" },
];

/**
 * Arma el payload; null si es tarjeta y aún no se eligió el tipo (el botón de
 * registrar debe quedar deshabilitado: el equipo tiene que preguntarle al
 * cliente si es débito o crédito).
 */
export function manualMethodPayload(
  method: ManualPaymentMethod,
  cardBrand: CardBrand | null,
): ManualMethodPayload | null {
  if (method !== "CARD") return { method };
  return cardBrand ? { method, cardBrand } : null;
}

/**
 * "¿Cómo recibiste el pago?" en dos pasos: método y, si es tarjeta, el tipo.
 * En dos pasos porque Android solo admite 3 botones por Alert; ahí se cancela
 * tocando fuera o con "atrás" (`cancelable`).
 */
export function askPaymentMethod(
  title: string,
  message: string,
  onPick: (payload: ManualMethodPayload) => void,
): void {
  const cancel: AlertButton[] =
    Platform.OS === "ios" ? [{ text: "Cancelar", style: "cancel" }] : [];
  const askCardBrand = () =>
    Alert.alert(
      "Tipo de tarjeta",
      "Pregúntale al cliente si es débito o crédito.",
      [
        ...CARD_BRAND_OPTIONS.map(({ key, label }) => ({
          text: label,
          onPress: () => onPick({ method: "CARD" as const, cardBrand: key }),
        })),
        ...cancel,
      ],
      { cancelable: true },
    );
  Alert.alert(
    title,
    message,
    [
      { text: "Efectivo", onPress: () => onPick({ method: "CASH" }) },
      { text: "Transferencia", onPress: () => onPick({ method: "TRANSFER" }) },
      { text: "Tarjeta", onPress: askCardBrand },
      ...cancel,
    ],
    { cancelable: true },
  );
}
