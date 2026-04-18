export const BUSINESS = {
  whatsappNumber: "5216622057580",
  whatsappDefaultMessage: "Hola, quiero info sobre una reservación",
} as const;

export function buildWhatsappUrl(message: string = BUSINESS.whatsappDefaultMessage) {
  return `https://wa.me/${BUSINESS.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
