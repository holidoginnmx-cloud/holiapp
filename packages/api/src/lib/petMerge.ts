import type { Pet, Prisma } from "@prisma/client";

/**
 * Fusión de dos fichas del MISMO perro en una sola.
 *
 * Pasa cuando un cliente de siempre instala la app, no vincula su ficha y
 * registra a su perro otra vez. El caso que lo motivó (10-sep-2026): el equipo
 * tenía a "Drago Castro" con una estancia en curso y casi nada de expediente;
 * la dueña registró a "Drago" con su cartilla aprobada, veterinario, contactos
 * y la nota de que muerde a otros perros. Lo que había antes para esto era
 * "descartar la repetida", que desactivaba al perro nuevo y con él escondía
 * justo esos datos —y se negaba si tenía reservas—.
 *
 * Aquí el destino (`into`) sobrevive con su id —sus reservas, fotos de la
 * estancia y pagos ya apuntan a él— y absorbe lo que traiga el origen (`from`):
 *   · conserva lo que ya tiene y completa lo vacío;
 *   · las notas se suman (son el lugar de las advertencias de conducta);
 *   · la cartilla viaja completa si la del origen está en mejor estado;
 *   · todo lo que cuelga de `petId` se re-apunta al destino;
 *   · el origen queda inactivo, no se borra.
 */

type Tx = Prisma.TransactionClient;

export type PetMergePair = {
  from: string;
  into: string;
  /** Quedarse con el nombre del origen (el que escribió el cliente). */
  useSourceName?: boolean;
};

export class PetMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PetMergeError";
  }
}

// Expediente que se completa cuando el destino no lo tiene. El peso no está
// aquí: viaja junto con la talla (ver abajo).
const CAMPOS_A_COMPLETAR = [
  "breed",
  "birthDate",
  "photoUrl",
  "sex",
  "behavior",
  "walkPreference",
  "healthIssues",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
  "vetName",
  "vetPhone",
  "feedingSchedule",
  "feedingAmount",
  "foodType",
  "feedingInstructions",
  "diet",
  "personality",
  "groomingMinutes",
] as const satisfies readonly (keyof Pet)[];

// La cartilla se mueve como bloque: mezclar las fotos de una con el estado de
// la otra dejaría un "aprobada" que nadie aprobó.
const CAMPOS_CARTILLA = [
  "cartillaUrl",
  "cartillaPhotos",
  "cartillaStatus",
  "cartillaReviewedAt",
  "cartillaReviewedById",
  "cartillaRejectionReason",
  "cartillaApprovalNote",
] as const satisfies readonly (keyof Pet)[];

const RANGO_CARTILLA: Record<string, number> = { APPROVED: 3, PENDING: 2, REJECTED: 1 };
const rangoCartilla = (s: string | null) => (s ? (RANGO_CARTILLA[s] ?? 0) : 0);

const vacio = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const paraComparar = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Suma las notas sin repetir: si el texto del origen ya está en el destino (el
 * equipo pudo haberlo pegado a mano mientras tanto), no se vuelve a agregar.
 */
export function mergeNotes(destino: string | null, origen: string | null): string | null {
  const a = destino?.trim() || null;
  const b = origen?.trim() || null;
  if (!b) return a;
  if (!a) return b;
  if (paraComparar(a).includes(paraComparar(b))) return a;
  return `${a}\n\n${b}`;
}

/** Qué cambia en el destino. Pura: la regla vive aquí y se prueba sin BD. */
export function planPetMerge(
  from: Pet,
  into: Pet,
  opts: { useSourceName?: boolean } = {},
): Prisma.PetUncheckedUpdateInput {
  const data: Record<string, unknown> = {};

  for (const campo of CAMPOS_A_COMPLETAR) {
    if (vacio(into[campo]) && !vacio(from[campo])) data[campo] = from[campo];
  }

  // Peso y talla juntos: la talla sale del peso (derivePetSize), así que
  // tomar uno sin el otro dejaría una talla que no corresponde.
  if (into.weight == null && from.weight != null) {
    data.weight = from.weight;
    data.size = from.size;
    data.sizeDeclared = from.sizeDeclared;
  } else if (into.weight == null && !into.sizeDeclared && from.sizeDeclared) {
    data.size = from.size;
    data.sizeDeclared = true;
  }

  // Si alguna de las dos dice que sí, es que alguien lo sabe.
  if (!into.isNeutered && from.isNeutered) data.isNeutered = true;
  if (!into.vetEmergency24h && from.vetEmergency24h) data.vetEmergency24h = true;

  const notas = mergeNotes(into.notes, from.notes);
  if (notas !== (into.notes?.trim() || null)) data.notes = notas;

  if (rangoCartilla(from.cartillaStatus) > rangoCartilla(into.cartillaStatus)) {
    for (const campo of CAMPOS_CARTILLA) data[campo] = from[campo];
  }

  const nombre = from.name.trim();
  if (opts.useSourceName && nombre && nombre !== into.name) data.name = nombre;

  return data as Prisma.PetUncheckedUpdateInput;
}

/**
 * Fusiona `fromId` en `intoId` dentro de la transacción que le pasen. Devuelve
 * los campos que se copiaron (para el log).
 */
export async function mergePetInto(
  tx: Tx,
  fromId: string,
  intoId: string,
  opts: { useSourceName?: boolean } = {},
): Promise<{ copiedFields: string[] }> {
  if (fromId === intoId) {
    throw new PetMergeError("No se puede fusionar una mascota consigo misma.");
  }
  const [from, into] = await Promise.all([
    tx.pet.findUnique({ where: { id: fromId } }),
    tx.pet.findUnique({ where: { id: intoId } }),
  ]);
  if (!from || !into) {
    throw new PetMergeError("Alguna de las dos mascotas ya no existe.");
  }
  if (!into.isActive) {
    throw new PetMergeError(`${into.name} está dada de baja: no puede recibir la fusión.`);
  }

  const data = planPetMerge(from, into, opts);
  const copiedFields = Object.keys(data);
  if (copiedFields.length > 0) {
    await tx.pet.update({ where: { id: intoId }, data });
  }

  // Todo lo que cuelga de la mascota. Las reservas incluidas: son la razón de
  // que "descartar" no alcanzara (con historial no se podía).
  const mover = { where: { petId: fromId }, data: { petId: intoId } };
  await tx.reservation.updateMany(mover);
  await tx.vaccine.updateMany(mover);
  await tx.deworming.updateMany(mover);
  await tx.stayUpdate.updateMany(mover);
  await tx.behaviorTag.updateMany(mover);
  await tx.staffAlert.updateMany(mover);
  await tx.quotePet.updateMany(mover);

  // Co-dueños: único (petId, userId). Sobran los que el destino ya tiene y el
  // dueño del destino (nadie es co-dueño de su propio perro).
  const yaEnDestino = await tx.petCoOwner.findMany({
    where: { petId: intoId },
    select: { userId: true },
  });
  await tx.petCoOwner.deleteMany({
    where: {
      petId: fromId,
      userId: { in: [into.ownerId, ...yaEnDestino.map((c) => c.userId)] },
    },
  });
  await tx.petCoOwner.updateMany(mover);

  await tx.pet.update({ where: { id: fromId }, data: { isActive: false } });

  return { copiedFields };
}
