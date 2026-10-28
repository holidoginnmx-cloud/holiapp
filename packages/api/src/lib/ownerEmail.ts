import { z } from "zod";

// El equipo le pone a la ficha el correo que el cliente le pasó por WhatsApp.
// No hay que vincular nada a mano: cuando el cliente se registra en la app con
// ESE correo, `resolveDbUserFromClerk` (middleware/auth.ts) encuentra la ficha
// por email y le pega su cuenta, con mascotas e historial. Por eso el correo se
// guarda en minúsculas: Clerk los manda así y la búsqueda es exacta.

const WALKIN_EMAIL_RE = /@holidoginn\.local$/i;
const EmailSchema = z.string().trim().toLowerCase().email().max(160);

type Ficha = {
  id: string;
  role: string;
  clerkId: string | null;
  email: string;
};

/** Quien YA tiene ese correo (sin importar mayúsculas), si es otro registro. */
type Ocupante = {
  id: string;
  firstName: string;
  lastName: string | null;
  clerkId: string | null;
  isActive: boolean;
};

export type DecisionCorreo =
  | { ok: true; email: string; sinCambio: boolean }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error: string;
      code?: "TIENE_APP" | "CORREO_OCUPADO";
      ocupante?: { id: string; nombre: string; tieneApp: boolean; activo: boolean };
    };

export function parseCorreoFicha(raw: unknown): string | null {
  const parsed = EmailSchema.safeParse(raw);
  if (!parsed.success || WALKIN_EMAIL_RE.test(parsed.data)) return null;
  return parsed.data;
}

export function decidirCorreoFicha(
  ficha: Ficha | null,
  email: string | null,
  ocupante: Ocupante | null,
): DecisionCorreo {
  if (!ficha) return { ok: false, status: 404, error: "Cliente no encontrado" };
  if (!email) return { ok: false, status: 400, error: "Ese correo no se ve válido." };
  if (ficha.role !== "OWNER") {
    return { ok: false, status: 400, error: "Solo se le asigna correo a la ficha de un cliente." };
  }
  // Ya entra a la app: su correo es el de su cuenta de Clerk. Cambiarlo aquí
  // no le cambia el inicio de sesión, solo dejaría la ficha diciendo otro.
  if (ficha.clerkId) {
    return {
      ok: false,
      status: 409,
      code: "TIENE_APP",
      error: "Este cliente ya usa la app: su correo es con el que entra y no se cambia desde aquí.",
    };
  }
  if (ocupante && ocupante.id !== ficha.id) {
    const nombre = `${ocupante.firstName} ${ocupante.lastName ?? ""}`
      .replace(/\s+[-—–.]+$/, "")
      .trim();
    const tieneApp = !!ocupante.clerkId;
    return {
      ok: false,
      status: 409,
      code: "CORREO_OCUPADO",
      // El caso típico: el cliente ya se registró por su cuenta y quedó con
      // dos registros. Ponerle el correo a la ficha no los junta; eso es
      // «Juntar con otra ficha».
      error: tieneApp
        ? `Ese correo ya tiene cuenta en la app (${nombre}). Si es la misma persona, usa «Juntar con otra ficha».`
        : `Ese correo ya está en la ficha de ${nombre}${ocupante.isActive ? "" : " (dada de baja)"}.`,
      ocupante: { id: ocupante.id, nombre, tieneApp, activo: ocupante.isActive },
    };
  }
  return { ok: true, email, sinCambio: ficha.email.toLowerCase() === email };
}
