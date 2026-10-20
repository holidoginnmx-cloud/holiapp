/**
 * Despacho de pedidos de la tienda en línea: la guía del envío y el mensaje que
 * se le manda al cliente.
 *
 * El equipo captura paquetería + número de guía desde la app (Ajustes → Pedidos
 * de la tienda). Al guardarla:
 *   - al cliente le llega un CORREO automático con la guía (el correo de
 *     confirmación le promete «te compartiremos la guía en cuanto salga»);
 *   - la app ofrece abrir WhatsApp con el mismo mensaje ya escrito. WhatsApp no
 *     se manda solo: no hay API de WhatsApp Business, así que el equipo solo
 *     toca «Enviar».
 *
 * El texto se arma AQUÍ y no en la app: así el correo y el WhatsApp dicen lo
 * mismo, y cambiarlo no requiere OTA.
 */

import type { PrismaClient } from "@holidoginn/db";
import { orderShippedTemplate, sendEmail } from "./email";

/** Paqueterías que se ofrecen como atajo. Se acepta cualquier otro nombre. */
export const CARRIERS = ["Estafeta", "DHL", "FedEx", "Paquetexpress", "Redpack", "UPS"] as const;

/**
 * Link de rastreo directo, solo para paqueterías con una URL estable que acepta
 * la guía como parámetro. Para las demás el mensaje indica rastrear en su
 * página: un link roto en el primer mensaje al cliente se ve peor que no
 * mandar link.
 */
export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  const n = encodeURIComponent(trackingNumber.trim());
  switch (carrier.trim().toLowerCase()) {
    case "dhl":
      return `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${n}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "ups":
      return `https://www.ups.com/track?loc=es_MX&tracknum=${n}`;
    default:
      return null;
  }
}

/**
 * Teléfono del cliente para el WhatsApp, en 10 dígitos.
 *
 * Desde 2026-10-20 el checkout pide teléfono y llega aquí como el primero
 * (`order.phone`); si falta, el del perfil. Los pedidos anteriores no lo
 * tienen: se busca en la dirección, donde los clientes lo escribían porque la
 * paquetería lo pide (el #8 traía «…Ixtapaluca 56535,5583355414»). El código
 * postal son 5 dígitos, así que solo se acepta una corrida de exactamente 10 (o
 * 12 con lada 52). Es una sugerencia: el equipo la puede corregir antes de
 * abrir WhatsApp.
 */
export function guessCustomerPhone(
  userPhone: string | null | undefined,
  shippingAddress: string | null | undefined
): string | null {
  const desdePerfil = (userPhone ?? "").replace(/\D/g, "");
  if (desdePerfil.length >= 10) return desdePerfil.slice(-10);

  const addr = shippingAddress ?? "";
  // Corridas de dígitos permitiendo espacios/guiones internos ("55 8335 5414"),
  // pero nunca comas: así el CP pegado con coma no se suma al teléfono.
  const corridas = addr.match(/\+?\d[\d -]{8,}\d/g) ?? [];
  for (const c of corridas) {
    const d = c.replace(/\D/g, "");
    if (d.length === 10) return d;
    if (d.length === 12 && d.startsWith("52")) return d.slice(2);
    if (d.length === 13 && d.startsWith("521")) return d.slice(3);
  }
  return null;
}

/**
 * Cómo se le nombra el pedido AL CLIENTE: por lo que compró, no por el folio
 * interno («#8» no le dice nada). "Pelota de tenis", "Collar y Correa",
 * "Collar, Correa y 2 productos más".
 */
export function orderLabel(items: { name: string }[]): string {
  const nombres = items.map((it) => it.name.trim()).filter(Boolean);
  if (nombres.length === 0) return "tu compra";
  if (nombres.length === 1) return nombres[0];
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`;
  const resto = nombres.length - 2;
  return `${nombres[0]}, ${nombres[1]} y ${resto} producto${resto === 1 ? "" : "s"} más`;
}

export type ShipmentMessageInput = {
  items: { name: string }[];
  firstName: string | null;
  carrier: string;
  trackingNumber: string;
};

/** Mensaje de WhatsApp (texto plano, con emojis como el resto de los avisos). */
export function buildShipmentMessage(d: ShipmentMessageInput): string {
  const saludo = d.firstName?.trim() ? `¡Hola, ${d.firstName.trim()}!` : "¡Hola!";
  const url = trackingUrl(d.carrier, d.trackingNumber);
  const rastreo = url
    ? `🔎 Rastréalo aquí: ${url}`
    : `🔎 Puedes rastrearlo en la página de ${d.carrier.trim()} con tu número de guía.`;
  return [
    `${saludo} 🐾 Tu pedido de Holidog Inn ya va en camino: ${orderLabel(d.items)}.`,
    "",
    `📦 Paquetería: ${d.carrier.trim()}`,
    `🔢 Número de guía: ${d.trackingNumber.trim()}`,
    rastreo,
    "",
    "Cualquier duda, aquí estamos. ¡Gracias por tu compra! 🛍️",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Guardar la guía (lo comparten la app y el panel web)
// ─────────────────────────────────────────────────────────────────────────────

/** Correos inventados de las fichas sin cuenta: no hay a quién mandarles. */
const WALKIN_EMAIL_RE = /@holidoginn\.local$/i;

export type GuardarGuiaResult =
  | { ok: true; emailSentTo: string | null; emailSkipped: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Guarda paquetería + guía y, si la guía es nueva o cambió, le manda el correo
 * al cliente. Volver a guardar la MISMA guía (doble clic, reintento) no repite
 * el correo; corregirla sí, para que tenga la buena.
 *
 * Una sola implementación para la app (`/admin/store/orders/:id/shipment`) y
 * el panel web (`/internal/store/orders/:id/shipment`): antes el panel escribía
 * la guía directo en Supabase y el cliente nunca se enteraba.
 */
export async function guardarGuiaPedido(
  prisma: PrismaClient,
  orderId: string,
  input: { carrier?: string | null; trackingNumber?: string | null }
): Promise<GuardarGuiaResult> {
  const carrier = (input.carrier ?? "").trim().slice(0, 80);
  const trackingNumber = (input.trackingNumber ?? "").trim().slice(0, 120);
  if (!carrier || !trackingNumber) {
    return { ok: false, status: 400, error: "Falta la paquetería o el número de guía" };
  }

  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { productNameSnapshot: true } },
      user: { select: { firstName: true } },
    },
  });
  if (!o) return { ok: false, status: 404, error: "Pedido no encontrado" };
  if (o.fulfillmentType !== "NATIONAL_SHIPPING") {
    return { ok: false, status: 400, error: "Este pedido no es de envío nacional" };
  }
  if (o.status !== "PAID" && o.status !== "FULFILLED") {
    return { ok: false, status: 409, error: "El pedido no está pagado" };
  }

  const cambio = o.trackingCarrier !== carrier || o.trackingNumber !== trackingNumber;
  await prisma.order.update({
    where: { id: o.id },
    data: { trackingCarrier: carrier, trackingNumber },
  });

  let emailSentTo: string | null = null;
  const to = o.email?.trim().toLowerCase();
  if (cambio && to && !WALKIN_EMAIL_RE.test(to)) {
    const ok = await sendEmail({
      to,
      ...orderShippedTemplate({
        orderLabel: orderLabel(o.items.map((it) => ({ name: it.productNameSnapshot }))),
        firstName: o.user?.firstName ?? null,
        carrier,
        trackingNumber,
        trackingUrl: trackingUrl(carrier, trackingNumber),
      }),
    });
    if (ok) emailSentTo = to;
  }
  return { ok: true, emailSentTo, emailSkipped: !cambio };
}
