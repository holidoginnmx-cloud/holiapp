import { useQuery } from "@tanstack/react-query";
import { getPublicLodgingPricing } from "@/lib/api/pricing";
import { formatCurrency } from "@/lib/format";

/**
 * Tarifa por hora de guardería vigente (Config → Tarifas), ya formateada
 * ("$35"). Comparte la caché con el wizard de reserva.
 *
 * Antes los textos decían "$25/h" quemado y la tarifa real ya era otra. Mientras
 * carga (o si no está configurada) devuelve null y los textos omiten el monto:
 * mejor sin número que con uno viejo.
 */
export function useDaycareHourPrice(): string | null {
  const { data } = useQuery({
    queryKey: ["pricing", "lodging"],
    queryFn: getPublicLodgingPricing,
    staleTime: 5 * 60 * 1000,
  });
  const price = data?.daycareHourPrice ?? 0;
  return price > 0 ? formatCurrency(price) : null;
}

/** Subtítulo del selector de hora de recogida de un hospedaje. */
export function subtituloRecogida(hourPrice: string | null): string {
  return `¿A qué hora planeas recogerlo? Después de la 1:00 pm aplica guardería${
    hourPrice ? ` (${hourPrice}/h)` : ""
  }.`;
}
