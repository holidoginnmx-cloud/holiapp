/**
 * A qué número se le manda el código de vinculación, y a cuántos.
 *
 * Vive aparte de la ruta para poder razonarlo y probarlo sin BD ni red: es la
 * decisión con más filo del flujo, porque equivocarse significa mandarle el
 * código de una ficha ajena a un tercero.
 */

import { toE164 } from "./phone";

export type SmsTarget =
  | { ok: true; e164: string }
  | { ok: false; reason: "no-phone" | "unusable" | "ambiguous" };

/**
 * Reglas, en orden:
 *
 *  1. Se usa el teléfono DE LA FICHA, nunca el que tecleó quien está buscando.
 *     Ahí está toda la prueba de identidad: "controlas el contacto que la ficha
 *     ya tenía" — igual que con el correo, que tampoco se manda al que diga
 *     quien lo pide. Como la búsqueda primaria es por los últimos 10 dígitos,
 *     en el caso normal son el mismo; el caso que importa es la búsqueda por
 *     correo, donde pueden diferir.
 *  2. Se deduplica por E.164: las fichas duplicadas casi siempre comparten
 *     teléfono (por eso salieron juntas en la búsqueda), así que normalmente
 *     colapsa a uno solo. Un único SMS basta: el reto cubre todas las fichas
 *     candidatas, así que un solo código las desbloquea todas.
 *  3. Si quedan varios números distintos, gana el que coincide con lo tecleado.
 *  4. Si ninguno coincide, NO se manda nada. Pueden ser personas distintas, y
 *     mandarle un SMS pagado al teléfono de un tercero es justo el daño que hay
 *     que evitar. Se cae al respaldo de WhatsApp.
 */
export function pickSmsTarget(
  fichas: { phone: string | null }[],
  typedPhone: string | null, // últimos 10 dígitos, tal como los da normalizePhone
): SmsTarget {
  const crudos = fichas.map((f) => f.phone).filter((p): p is string => !!p);
  if (crudos.length === 0) return { ok: false, reason: "no-phone" };

  const nums = Array.from(new Set(crudos.map(toE164).filter((n): n is string => !!n)));
  if (nums.length === 0) return { ok: false, reason: "unusable" };
  if (nums.length === 1) return { ok: true, e164: nums[0]! };

  const coinciden = typedPhone ? nums.filter((n) => n.endsWith(typedPhone)) : [];
  return coinciden.length === 1
    ? { ok: true, e164: coinciden[0]! }
    : { ok: false, reason: "ambiguous" };
}
