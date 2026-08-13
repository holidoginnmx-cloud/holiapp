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
