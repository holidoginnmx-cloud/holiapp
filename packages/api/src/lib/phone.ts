// Normaliza un teléfono a sus últimos 10 dígitos (estándar nacional MX),
// descartando espacios, guiones, paréntesis y lada de país/larga distancia
// (+52, 044, 01, etc.). Los teléfonos en la BD están en formato libre (el admin
// los captura tal cual), así que comparamos por esta forma canónica.
// Devuelve null si no hay al menos 10 dígitos.
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
