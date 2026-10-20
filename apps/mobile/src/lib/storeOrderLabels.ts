import { COLORS } from "@/constants/colors";
import type { StoreOrder } from "@/lib/api";

// Etiquetas de los pedidos de la tienda (lista y detalle en app/admin).

export const FULFILLMENT_LABEL: Record<StoreOrder["fulfillmentType"], string> = {
  NATIONAL_SHIPPING: "Envío nacional",
  LOCAL_DELIVERY: "Entrega a domicilio",
  PICKUP: "Recoge en el hotel",
};

export function estadoPedido(o: StoreOrder): { label: string; bg: string; fg: string } {
  if (o.status === "REFUNDED") return { label: "Reembolsado", bg: COLORS.bgSection, fg: COLORS.textTertiary };
  if (o.status === "CANCELLED") return { label: "Cancelado", bg: COLORS.bgSection, fg: COLORS.textTertiary };
  if (o.pending) {
    return {
      label: o.fulfillmentType === "NATIONAL_SHIPPING" ? "Por enviar" : "Por entregar",
      bg: COLORS.warningBg,
      fg: COLORS.warningText,
    };
  }
  if (o.status === "FULFILLED") return { label: "Entregado", bg: COLORS.successBg, fg: COLORS.successText };
  return { label: "Enviado", bg: COLORS.infoBg, fg: COLORS.infoText };
}
