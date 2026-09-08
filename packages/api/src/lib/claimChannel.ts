/**
 * Qué canal se usa para mandar el código de vinculación.
 *
 * El orden es SMS y luego correo, y no al revés, porque así son los datos
 * reales del negocio: de las fichas de clientes sin app, ~85% tiene teléfono
 * capturado y solo ~16% tiene un correo de verdad (el resto son direcciones
 * `@holidoginn.local` que genera el sistema al dar de alta un walk-in). El
 * correo se conserva porque hay clientes que solo tienen eso.
 *
 * Se decide aquí, fuera de la ruta, para poder probar la cascada completa sin
 * BD ni red.
 */

export type ClaimChannel = "sms" | "email" | "none";

export type ChannelPlan =
  /** Intentar SMS; si el envío falla, `fallback` dice si queda correo. */
  | { first: "sms"; fallbackEmail: boolean }
  | { first: "email"; fallbackEmail: false }
  | { first: "none"; fallbackEmail: false };

/**
 * @param hasSmsTarget  hay un teléfono en la ficha del que se pudo sacar E.164
 * @param hasRealEmail  hay al menos un correo que no sea `@holidoginn.local`
 * @param prefer        el cliente pidió explícitamente otro canal ("no me llegó
 *                      el SMS, mándenmelo al correo"). Sin esto, quien cambió de
 *                      número quedaría atrapado: la cascada solo cae a correo si
 *                      el ENVÍO falla, no si el SMS llega a una línea que ya no
 *                      es suya.
 */
export function planChannel(
  hasSmsTarget: boolean,
  hasRealEmail: boolean,
  prefer?: "email" | "sms",
): ChannelPlan {
  if (prefer === "email" && hasRealEmail) return { first: "email", fallbackEmail: false };
  if (hasSmsTarget) return { first: "sms", fallbackEmail: hasRealEmail };
  if (hasRealEmail) return { first: "email", fallbackEmail: false };
  return { first: "none", fallbackEmail: false };
}

/** El otro canal que se le puede ofrecer al cliente desde la pantalla. */
export function alternateChannel(
  used: ClaimChannel,
  hasSmsTarget: boolean,
  hasRealEmail: boolean,
): "email" | "sms" | undefined {
  if (used === "sms" && hasRealEmail) return "email";
  if (used === "email" && hasSmsTarget) return "sms";
  return undefined;
}
