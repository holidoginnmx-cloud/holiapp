import type { PrismaClient, User } from "@prisma/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface GuestIdentity {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
}

export type ResolveGuestResult =
  | { ok: true; user: User; created: boolean }
  | { ok: false; status: number; error: string };

// Resuelve (o crea) el usuario invitado de la tienda web a partir de su email.
// Es el mismo patrón "walk-in" documentado en el schema: clientes sin cuenta
// Clerk viven con clerkId=null + originLegacy=true; cuando luego se registran
// con Clerk, `resolveDbUserFromClerk` (middleware/auth.ts) los vincula por email
// y heredan sus reservas/mascotas.
//
// - Si ya existe una fila con ese email SIN clerkId → se reusa (no duplica).
// - Si la fila ya tiene clerkId → la persona tiene cuenta: 409 ("inicia sesión").
//   No tocamos clerkId aquí, así que no hay riesgo de secuestro de cuenta.
// - Cuenta desactivada → 403 (mismo criterio que el auth obligatorio).
export async function resolveOrCreateGuestUser(
  prisma: PrismaClient,
  id: GuestIdentity
): Promise<ResolveGuestResult> {
  const email = id.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: "Email válido requerido" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.clerkId) {
      return {
        ok: false,
        status: 409,
        error: "Este correo ya tiene una cuenta. Inicia sesión para reservar.",
      };
    }
    if (!existing.isActive) {
      return {
        ok: false,
        status: 403,
        error: "Tu cuenta está desactivada. Contacta al hotel.",
      };
    }
    return { ok: true, user: existing, created: false };
  }

  const user = await prisma.user.create({
    data: {
      clerkId: null,
      email,
      firstName: id.firstName?.trim() || "Cliente",
      lastName: id.lastName?.trim() || "",
      phone: id.phone?.trim() || null,
      role: "OWNER",
      originLegacy: true,
    },
  });
  return { ok: true, user, created: true };
}
