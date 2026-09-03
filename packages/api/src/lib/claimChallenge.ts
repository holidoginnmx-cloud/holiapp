import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Reto de verificación para reclamar una cuenta preexistente.
 *
 * Antes, la única "prueba" de que una ficha legacy era tuya era conocer el
 * teléfono (o el correo): con eso `lookup` devolvía nombre y mascotas de
 * cualquiera y `confirm` movía mascotas, reservas y saldo al atacante y le
 * colgaba su `clerkId` a la ficha (y el cliente real ya no podía reclamarla).
 *
 * Ahora `lookup` manda un código de 6 dígitos al correo que YA está en la
 * ficha (no al que diga el cliente) y devuelve un reto firmado; `verify`
 * comprueba el código y devuelve un token de claim; `confirm` solo acepta ese
 * token. Todo es stateless (sin tabla ni migración): el reto lleva dentro qué
 * cuenta lo pidió, qué fichas cubre, cuándo expira y el hash del código, y va
 * firmado con HMAC para que no se pueda fabricar ni modificar.
 *
 * Fuerza bruta: 10^6 códigos, 10 minutos de vida y el rate limit de la ruta
 * `/users/claim/verify` (ver users.ts). Suficiente para lo que protege.
 */

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CLAIM_TOKEN_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  const s =
    process.env.CLAIM_CODE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.CLERK_SECRET_KEY ||
    "";
  if (!s) throw new Error("Falta CLAIM_CODE_SECRET (o CRON_SECRET) para firmar retos de claim");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function hashCode(code: string, salt: string): string {
  return createHmac("sha256", secret()).update(`${salt}:${code}`).digest("base64url");
}

function pack(obj: unknown): string {
  const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function unpack<T>(token: string): T | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

type ChallengePayload = {
  t: "claim-challenge";
  /** Usuario (cuenta nueva de Clerk) que pidió el reto. */
  uid: string;
  /** Fichas legacy que el reto cubre (las que encontró el lookup). */
  ids: string[];
  /** Hash del código + sal. */
  h: string;
  s: string;
  exp: number;
};

type ClaimTokenPayload = {
  t: "claim-token";
  uid: string;
  ids: string[];
  exp: number;
};

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createChallenge(uid: string, ids: string[], code: string): string {
  const s = randomBytes(8).toString("base64url");
  const payload: ChallengePayload = {
    t: "claim-challenge",
    uid,
    ids,
    h: hashCode(code, s),
    s,
    exp: Date.now() + CHALLENGE_TTL_MS,
  };
  return pack(payload);
}

export type VerifyResult =
  | { ok: true; ids: string[] }
  | { ok: false; reason: "invalid" | "expired" | "wrong-code" };

export function verifyChallenge(token: string, uid: string, code: string): VerifyResult {
  const p = unpack<ChallengePayload>(token);
  if (!p || p.t !== "claim-challenge" || p.uid !== uid || !Array.isArray(p.ids)) {
    return { ok: false, reason: "invalid" };
  }
  if (Date.now() > p.exp) return { ok: false, reason: "expired" };
  const given = Buffer.from(hashCode(code.trim(), p.s));
  const want = Buffer.from(p.h);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: "wrong-code" };
  }
  return { ok: true, ids: p.ids };
}

export function createClaimToken(uid: string, ids: string[]): string {
  const payload: ClaimTokenPayload = {
    t: "claim-token",
    uid,
    ids,
    exp: Date.now() + CLAIM_TOKEN_TTL_MS,
  };
  return pack(payload);
}

export function readClaimToken(token: string, uid: string): string[] | null {
  const p = unpack<ClaimTokenPayload>(token);
  if (!p || p.t !== "claim-token" || p.uid !== uid || !Array.isArray(p.ids)) return null;
  if (Date.now() > p.exp) return null;
  return p.ids;
}

/** "juan.perez@gmail.com" → "j***z@gmail.com" (para decirle a dónde se mandó). */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const first = user[0] ?? "";
  const last = user.length > 1 ? user[user.length - 1] : "";
  return `${first}***${last}@${domain}`;
}
