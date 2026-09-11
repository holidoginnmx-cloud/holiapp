import { randomBytes, randomInt } from "node:crypto";

/**
 * Invitaciones para compartir una mascota (tabla `pet_invites`).
 *
 * Una invitación se identifica de DOS formas, según por dónde llegue la
 * persona:
 *
 *   - `token`: 128 bits (32 hex) que viajan en la liga que se manda por WhatsApp. Es lo
 *     único que protege la invitación, así que no se puede adivinar.
 *   - `code`: 8 caracteres que se teclean dentro de la app. Existe porque la
 *     app NO tiene universal links: quien todavía no la tiene instalada abre la
 *     liga en el navegador, se baja la app desde la App Store y, al abrirla, la
 *     liga ya no lo está esperando. El código es lo único que sobrevive a ese
 *     viaje, y por eso es corto: hay que poder dictarlo por teléfono.
 */

/** Una semana: suficiente para que a la pareja le dé tiempo, corto para que no quede viva para siempre. */
export const INVITE_TTL_DAYS = 7;

/**
 * Tope de gente con la que se puede compartir un perro (pareja + familia, no
 * una lista de correo). Cada invitación VIVA aparta un lugar: así el tope no se
 * esquiva mandando diez ligas a la vez y aceptándolas todas.
 *
 * Solo aplica al autoservicio. El equipo puede vincular a mano sin tope.
 */
export const MAX_CO_OWNERS = 3;

/**
 * Sin 0/O ni 1/I/L: el código se dicta por teléfono y se teclea a mano, y esas
 * son exactamente las parejas que la gente confunde.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * Hexadecimal y no base64url a propósito: base64url trae guiones, y el guion es
 * justo lo que `normalizeInviteKey` quita para aceptar "ABCD-EFGH". Con
 * base64url, 3 de cada 10 ligas no se habrían encontrado.
 */
export function newInviteToken(): string {
  return randomBytes(16).toString("hex");
}

export function newInviteCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}

/**
 * Lo que el usuario teclea viene con guiones, espacios y minúsculas ("abcd
 * 1234", "ABCD-EFGH"). Se normaliza antes de buscar; el guión que se muestra en
 * pantalla es cosmético y no se guarda.
 */
export function normalizeInviteKey(raw: string): string {
  return raw.trim().replace(/[\s-]/g, "");
}

/** Cómo se le enseña el código a la gente: dos bloques de cuatro se leen mejor. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function inviteExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InviteState = {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

export type InviteStatus = "valid" | "used" | "revoked" | "expired";

export function inviteStatus(invite: InviteState, now: Date = new Date()): InviteStatus {
  if (invite.acceptedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/** Filtro de "invitaciones que todavía sirven", usado por las tres consultas. */
export function liveInviteWhere(now: Date = new Date()) {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

/** URL pública de la invitación, en el dominio del hotel (misma forma que las cotizaciones). */
export function publicInviteUrl(token: string): string {
  const base = (process.env.PUBLIC_SITE_URL ?? "https://holidoginn.com.mx").replace(/\/$/, "");
  return `${base}/invitacion/${token}`;
}

/**
 * El mensaje que se comparte por WhatsApp, ya escrito. Lleva el código además
 * de la liga para quien todavía no tiene la app: la liga no lo sigue después
 * de instalarla, el código sí.
 */
export function inviteShareText(
  petName: string,
  inviterName: string,
  url: string,
  code: string,
): string {
  return [
    `${inviterName} te comparte a ${petName} en la app de Holidog Inn 🐾`,
    "",
    "Con esta liga vas a poder ver su cartilla, sus reportes y sus fotos, y reservar tú también:",
    url,
    "",
    `Si todavía no tienes la app (por ahora solo iPhone), descárgala y en «Mis mascotas» toca «Tengo un código de invitación»: ${formatInviteCode(code)}`,
  ].join("\n");
}
