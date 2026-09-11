import type { PrismaClient, User } from "@prisma/client";
import { normalizePhone } from "./phone";
import { normalizePetName } from "./petName";
import { adminsActivosIds, notifyUsers } from "./notify";

/**
 * Solicitudes de vinculación de ficha: quién las abre y cuándo.
 *
 * Hasta 2026-09 la única forma de que una llegara al equipo era que el cliente
 * pulsara "Pedir que me vinculen mi ficha". Andrea Castro buscó su ficha, la
 * encontró, NO pulsó el botón, siguió como nueva y registró otra vez a Drago
 * —que estaba hospedado— con la nota de que muerde a otros perros. Nadie se
 * enteró. Aquí vive lo que la abre sin depender de ese botón:
 *   · al buscar la ficha y no poder mandarle código (ruta /users/claim/lookup);
 *   · cuando pone en su perfil un teléfono que ya tiene ficha;
 *   · a mano, por el equipo o por el barrido de cuentas repetidas.
 */

export type OrigenSolicitud = "CLIENT" | "AUTO" | "ADMIN";

/**
 * Fichas legacy (OWNER activo SIN app vinculada) que coinciden con el teléfono
 * ya normalizado (últimos 10 dígitos) o, como respaldo, con el correo exacto.
 */
export async function findLegacyCandidates(
  prisma: PrismaClient,
  phone: string | null,
  email: string | null,
  excludeId: string,
): Promise<string[]> {
  let ids: string[] = [];
  if (phone) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE "clerkId" IS NULL AND "isActive" = true AND role = 'OWNER'
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phone}
      LIMIT 10
    `;
    ids = rows.map((r) => r.id);
  }
  if (ids.length === 0 && email) {
    const byEmail = await prisma.user.findMany({
      where: { email, clerkId: null, isActive: true, role: "OWNER" },
      select: { id: true },
    });
    ids = byEmail.map((u) => u.id);
  }
  return ids.filter((id) => id !== excludeId);
}

/**
 * Solo las fichas con al menos una mascota activa: una ficha vacía no tiene
 * nada que vincular, y abrirle solicitud solo le llena la bandeja al equipo.
 */
export async function fichasConMascotas(prisma: PrismaClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.pet.findMany({
    where: { ownerId: { in: ids }, isActive: true },
    select: { ownerId: true },
    distinct: ["ownerId"],
  });
  const con = new Set(rows.map((r) => r.ownerId));
  return ids.filter((id) => con.has(id));
}

function avisoDeSolicitud(origen: OrigenSolicitud, nombre: string, contacto: string) {
  const quien = nombre || "Un cliente";
  switch (origen) {
    case "AUTO":
      return {
        title: "Posible cliente repetido",
        body: `${quien} se registró en la app con un teléfono (${contacto}) que ya tiene ficha. Revisa si es la misma persona y vincúlala para que no se le dupliquen sus mascotas.`,
      };
    case "ADMIN":
      return {
        title: "Cuenta repetida por revisar",
        body: `${quien} tiene cuenta en la app y además una ficha sin vincular. Revísala y vincúlala.`,
      };
    default:
      return {
        title: "Alguien pide vincular su ficha",
        body: `${quien} (${contacto}) instaló la app y no pudimos mandarle un código. Revisa su solicitud.`,
      };
  }
}

export type AbrirSolicitudOpts = {
  source: OrigenSolicitud;
  typedPhone?: string | null;
  typedEmail?: string | null;
  note?: string | null;
  /** Avisar a los admins (default sí). */
  avisar?: boolean;
  /** Quien la abre, para no mandarle a él su propio aviso. */
  actorId?: string | null;
  /**
   * Detección pasiva: si el equipo ya rechazó una de esta cuenta (p. ej. es la
   * pareja que comparte teléfono con el dueño de la ficha), no volver a abrirla
   * cada vez que edite su perfil.
   */
  saltarSiRechazada?: boolean;
};

/**
 * Abre la solicitud, o devuelve la que ya estaba pendiente: una a la vez por
 * persona, para no llenarle la bandeja al equipo con el mismo cliente. `null`
 * solo con `saltarSiRechazada` y una rechazada previa.
 */
export async function abrirSolicitudClaim(
  prisma: PrismaClient,
  requester: Pick<User, "id" | "firstName" | "lastName" | "email">,
  opts: AbrirSolicitudOpts,
): Promise<{ id: string; alreadyPending: boolean } | null> {
  const previa = await prisma.claimRequest.findFirst({
    where: {
      requesterId: requester.id,
      status: opts.saltarSiRechazada ? { in: ["PENDING", "REJECTED"] } : "PENDING",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, source: true },
  });
  if (previa) {
    if (previa.status !== "PENDING") return null;
    // El cliente la pide él mismo y ya había una que abrió el sistema o el
    // equipo: se vuelve suya, con su nota y lo que tecleó. Si no, el equipo
    // leería "no la pidió el cliente" cuando sí la pidió.
    if (opts.source === "CLIENT" && previa.source !== "CLIENT") {
      await prisma.claimRequest.update({
        where: { id: previa.id },
        data: {
          source: "CLIENT",
          ...(opts.typedPhone?.trim() ? { typedPhone: opts.typedPhone.trim().slice(0, 40) } : {}),
          ...(opts.typedEmail?.trim() ? { typedEmail: opts.typedEmail.trim().toLowerCase() } : {}),
          ...(opts.note?.trim() ? { note: opts.note.trim().slice(0, 300) } : {}),
        },
      });
    }
    return { id: previa.id, alreadyPending: true };
  }

  const nombre = [requester.firstName, requester.lastName].filter(Boolean).join(" ").trim();
  const solicitud = await prisma.claimRequest.create({
    data: {
      requesterId: requester.id,
      // Copia del solicitante: su cuenta desaparece al consolidarse (el merge
      // la borra y la ficha vieja hereda su identidad), así que sin esto el
      // historial quedaría sin nombre.
      requesterName: nombre || null,
      requesterEmail: requester.email ?? null,
      typedPhone: opts.typedPhone?.trim().slice(0, 40) || null,
      typedEmail: opts.typedEmail?.trim().toLowerCase() || null,
      note: opts.note?.trim().slice(0, 300) || null,
      source: opts.source,
    },
  });

  if (opts.avisar !== false) {
    const contacto = solicitud.typedPhone ?? solicitud.typedEmail ?? "sin dato";
    // Solo ADMIN: son los únicos que pueden aprobarla.
    const admins = await adminsActivosIds(prisma, opts.actorId ?? requester.id);
    await notifyUsers(prisma, admins, {
      type: "GENERAL",
      ...avisoDeSolicitud(opts.source, nombre, contacto),
      data: { kind: "CLAIM_REQUEST", claimRequestId: solicitud.id },
    });
  }
  return { id: solicitud.id, alreadyPending: false };
}

/**
 * Detección pasiva: una cuenta de la app cuyo teléfono coincide con una ficha
 * sin vincular que tiene mascotas. Abre la solicitud AUTO (una sola vez).
 */
export async function detectarFichaPorTelefono(
  prisma: PrismaClient,
  user: Pick<User, "id" | "firstName" | "lastName" | "email" | "phone" | "role" | "clerkId" | "isActive">,
): Promise<{ id: string; alreadyPending: boolean } | null> {
  if (user.role !== "OWNER" || !user.clerkId || !user.isActive) return null;
  const tel = normalizePhone(user.phone);
  if (!tel) return null;
  const fichas = await fichasConMascotas(prisma, await findLegacyCandidates(prisma, tel, null, user.id));
  if (fichas.length === 0) return null;
  return abrirSolicitudClaim(prisma, user, {
    source: "AUTO",
    typedPhone: user.phone,
    saltarSiRechazada: true,
  });
}

// Palabras que no distinguen a un perro: "La Chula" y "La Güera" no son el mismo.
const RELLENO = new Set(["el", "la", "los", "las", "mi", "don", "dona", "sr", "sra", "lil", "baby"]);

/**
 * La palabra que identifica al perro: la primera que no sea relleno, y solo si
 * tiene 3 letras o más. El equipo captura "Drago Castro" y el cliente escribe
 * "Drago"; "" = no alcanza para decir que son el mismo.
 */
export function claveNombre(nombre: string): string {
  const palabra = normalizePetName(nombre)
    .split(/[^a-z0-9]+/)
    .find((t) => t && !RELLENO.has(t));
  return palabra && palabra.length >= 3 ? palabra : "";
}

/**
 * ¿El perro que está registrando ya está en la ficha que pidió vincular? Por
 * nombre completo normalizado, o por la palabra clave (`claveNombre`).
 */
export async function mascotaEnFichaPendiente(
  prisma: PrismaClient,
  owner: Pick<User, "id" | "phone">,
  nombre: string,
): Promise<{ id: string; name: string } | null> {
  const completo = normalizePetName(nombre);
  const clave = claveNombre(nombre);
  if (!completo) return null;
  const pendiente = await prisma.claimRequest.findFirst({
    where: { requesterId: owner.id, status: "PENDING" },
    select: { typedPhone: true, typedEmail: true },
  });
  if (!pendiente) return null;
  const fichas = await findLegacyCandidates(
    prisma,
    normalizePhone(pendiente.typedPhone ?? owner.phone),
    pendiente.typedEmail,
    owner.id,
  );
  if (fichas.length === 0) return null;
  const mascotas = await prisma.pet.findMany({
    where: { ownerId: { in: fichas }, isActive: true },
    select: { id: true, name: true },
  });
  return (
    mascotas.find(
      (m) => normalizePetName(m.name) === completo || (clave !== "" && claveNombre(m.name) === clave),
    ) ?? null
  );
}

// ─── Barrido de cuentas repetidas ─────────────────────────────

type Persona = { id: string; firstName: string; lastName: string | null; phone: string | null };

export function tokensNombre(p: Pick<Persona, "firstName" | "lastName">): string[] {
  return normalizePetName(`${p.firstName ?? ""} ${p.lastName ?? ""}`)
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
}

/**
 * Empareja cuentas de la app con fichas sin vincular, por teléfono o por
 * nombre. Por nombre exige que el PRIMER y el ÚLTIMO token de la cuenta estén
 * en la ficha: "Jorge Hernández" ↔ "JORGE ROBERTO HERNANDEZ LLAMAS" sí, pero
 * "Luis Enrique Inda" ↔ "Luis Enrique Olivarría" no. Es una lista para que la
 * revise una persona, nunca para fusionar sola.
 */
export function emparejarCuentas(
  apps: Persona[],
  fichas: Persona[],
): { appId: string; fichaId: string; por: "telefono" | "nombre" }[] {
  const pares: { appId: string; fichaId: string; por: "telefono" | "nombre" }[] = [];
  const fichasTok = fichas.map((f) => ({ f, tel: normalizePhone(f.phone), tok: new Set(tokensNombre(f)) }));
  for (const a of apps) {
    const tel = normalizePhone(a.phone);
    const tok = tokensNombre(a);
    for (const { f, tel: telF, tok: tokF } of fichasTok) {
      if (tel && tel === telF) {
        pares.push({ appId: a.id, fichaId: f.id, por: "telefono" });
      } else if (tok.length >= 2 && tokF.has(tok[0]) && tokF.has(tok[tok.length - 1])) {
        pares.push({ appId: a.id, fichaId: f.id, por: "nombre" });
      }
    }
  }
  return pares;
}

/** Lo que devuelve el barrido: pares con lo necesario para decidir. */
export async function detectarCuentasRepetidas(prisma: PrismaClient) {
  const campos = { id: true, firstName: true, lastName: true, phone: true, email: true, createdAt: true } as const;
  const [apps, fichasTodas] = await Promise.all([
    prisma.user.findMany({ where: { role: "OWNER", isActive: true, clerkId: { not: null } }, select: campos }),
    prisma.user.findMany({ where: { role: "OWNER", isActive: true, clerkId: null }, select: campos }),
  ]);
  const conMascotas = new Set(await fichasConMascotas(prisma, fichasTodas.map((f) => f.id)));
  const fichas = fichasTodas.filter((f) => conMascotas.has(f.id));
  const pares = emparejarCuentas(apps, fichas);
  if (pares.length === 0) return [];

  const ids = [...new Set(pares.flatMap((p) => [p.appId, p.fichaId]))];
  const [mascotas, pendientes] = await Promise.all([
    prisma.pet.findMany({
      where: { ownerId: { in: ids }, isActive: true },
      select: { ownerId: true, name: true, _count: { select: { reservations: true } } },
    }),
    prisma.claimRequest.findMany({
      where: { requesterId: { in: pares.map((p) => p.appId) }, status: "PENDING" },
      select: { requesterId: true },
    }),
  ]);
  const conPendiente = new Set(pendientes.map((p) => p.requesterId));
  const persona = (id: string) => {
    const u = [...apps, ...fichas].find((x) => x.id === id)!;
    return {
      id: u.id,
      nombre: `${u.firstName} ${u.lastName ?? ""}`.trim(),
      telefono: u.phone,
      email: u.email,
      creada: u.createdAt,
      mascotas: mascotas
        .filter((m) => m.ownerId === id)
        .map((m) => ({ nombre: m.name, reservas: m._count.reservations })),
    };
  };
  return pares.map((p) => ({
    por: p.por,
    solicitudPendiente: conPendiente.has(p.appId),
    cuentaApp: persona(p.appId),
    ficha: persona(p.fichaId),
  }));
}
