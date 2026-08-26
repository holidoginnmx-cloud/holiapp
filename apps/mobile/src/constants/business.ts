export const BUSINESS = {
  whatsappNumber: "5216622057580",
  whatsappDefaultMessage: "Hola👋 vengo de la app de Holidog Inn...",
  whatsappOwnerInfoMessage: "Hola👋 vengo de la app de Holidog Inn...",
  /** Apple ID numérico de la app (= `ascAppId` de eas.json). */
  appStoreId: "6764478909",
  androidPackage: "com.holidoginn.app",
} as const;

export function buildWhatsappUrl(message: string = BUSINESS.whatsappDefaultMessage) {
  return `https://wa.me/${BUSINESS.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * WhatsApp hacia OTRO número (el del cliente), no el del hotel.
 *
 * `buildWhatsappUrl` sirve para "el cliente le escribe al hotel", que es lo que
 * hace el resto de la app. Las cotizaciones van al revés: el equipo le escribe
 * al cliente, con el mensaje y el link ya puestos. El número se normaliza a
 * dígitos y se le antepone la lada de México si viene en formato nacional
 * (10 dígitos), que es como lo captura el equipo.
 *
 * Devuelve null si el teléfono no sirve para armar el link — el llamador debe
 * ofrecer "copiar link" en ese caso, no abrir WhatsApp con un número roto.
 */
export function buildWhatsappUrlTo(
  phone: string | null | undefined,
  message: string,
): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  // 10 dígitos = nacional MX → 52 + 1 (móvil). Más de 10 ya trae lada.
  const target = digits.length === 10 ? `521${digits}` : digits;
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}
