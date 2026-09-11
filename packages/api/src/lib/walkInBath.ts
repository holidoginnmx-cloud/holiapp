import type { PrismaClient } from "@holidoginn/db";
import type { WalkInBath } from "@holidoginn/shared";
import { randomUUID } from "crypto";
import { normalizePhone } from "./phone";
import { billableBathSize } from "./pricing";
import { tallaChocaConCuartoActivo } from "./petSize";
import { findPetByName } from "./petName";
import { sharedPetIds } from "./petAccess";
import { evaluateStart, localYMD } from "./bathAvailability";
import { loadScheduleCfg, loadBusyIntervals, resolveBathDuration, ensureConfig } from "./bathAvailabilityDb";
import { createTeamReservation, type CreatedReservation } from "./reservationTeamCreate";
import type { OpResult } from "./reservationAdminOps";

/**
 * Baño de INVITADO (walk-in de mostrador).
 *
 * Alguien toca el timbre con un perro y pide un baño. No sabemos de quién es,
 * nunca escribió, y no hay tiempo de llenar un expediente con el perro en la
 * correa: hasta ahora eso significaba abandonar la captura, y con ella el
 * ingreso. Aquí se crea la reserva con cuatro datos —nombre del cliente,
 * teléfono, nombre del perro y talla— y se cobra.
 *
 * Las filas de `users` y `pets` son REALES: la agenda, el cobro y el historial
 * las necesitan. Lo que se omite es el EXPEDIENTE (peso, cartilla, contactos),
 * no el registro. Quedan marcadas con `expressIntakeAt` para poder completarlas
 * después, y el cliente puede reclamar su ficha por SMS el día que instale la
 * app (nace con `clerkId: null` y teléfono, que es lo que busca el claim).
 *
 * ── Por qué es un endpoint aparte y no una rama de `createTeamReservation` ──
 * Esa función son 555 líneas que sirven a los tres servicios y al lock de
 * cuartos. Meterle una rama haría que CADA alta de hospedaje pasara por código
 * nuevo, y el costo de un bug ahí no es "no se bañó a Camila", es "se perdió
 * una noche de un cuarto". Además, así la restricción "sólo baño" queda
 * garantizada por construcción: el hospedaje SÍ exige cartilla y el baño no, y
 * esa asimetría es justo lo que hace viable capturar sin expediente.
 *
 * ── Transaccionalidad ──
 * `createTeamReservation` abre su propia transacción, así que el alta del
 * dueño y del perro no puede ir dentro. En vez de eso: todo lo que puede
 * fallar se verifica ANTES de escribir (paso 3), y si aun así la reserva falla
 * por una carrera, se borran SÓLO las filas que creamos en esta petición
 * (nunca una que reusamos). Es el mismo patrón del alta rápida del panel web.
 */

const fail = (
  status: number,
  error: string,
  code?: string,
  extra?: Record<string, unknown>
): OpResult<never> => ({ ok: false, status, error, code, extra });

/** Ficha existente que choca por teléfono, con sus perros, para poder preguntar. */
export type OwnerCandidate = {
  id: string;
  name: string;
  phone: string | null;
  pets: { id: string; name: string; size: string; weight: number | null }[];
};

export type WalkInBathData = {
  reservation: CreatedReservation;
  owner: { id: string; name: string; phone: string | null; created: boolean };
  pet: { id: string; name: string; size: string; photoUrl: string | null; created: boolean };
  pricing: { amount: number; variantId: string | null; sizeSource: "declared" | "weight" };
  agendaWarnings: string[];
  warnings: string[];
};

export type WalkInBathParams = {
  /** Body YA validado con `WalkInBathSchema`. */
  input: WalkInBath;
  /** Quién captura (se le excluye del aviso de reserva nueva). */
  actorUserId: string | null;
  source?: "APP_ADMIN" | "SITIO_WEB";
};

export async function createWalkInBath(
  prisma: PrismaClient,
  params: WalkInBathParams
): Promise<OpResult<WalkInBathData>> {
  const { input } = params;
  const warnings: string[] = [];

  const appointmentAt = new Date(input.appointmentAt);
  if (Number.isNaN(appointmentAt.getTime())) {
    return fail(400, "La fecha de la cita no es válida", "VALIDATION");
  }

  const phone = normalizePhone(input.owner.phone);
  if (!phone) {
    return fail(400, "El teléfono debe tener al menos 10 dígitos", "PHONE_INVALID");
  }

  // ── 1. ¿Ya conocemos a esta persona? (LECTURA) ─────────────────────────
  // Mismo predicado que POST /users: los teléfonos están en formato libre, así
  // que se comparan por sus últimos 10 dígitos. LIMIT 5 y no 1 a propósito: los
  // clientes preexistentes vienen fragmentados en varias fichas (ver
  // lib/userMerge.ts), y quien captura merece verlas todas para elegir.
  let ownerId: string | null = null;
  let ownerCreated = false;
  let ownerName = input.owner.name.trim();

  if (input.confirmReuseOwnerId) {
    const chosen = await prisma.user.findUnique({
      where: { id: input.confirmReuseOwnerId },
      select: { id: true, firstName: true, lastName: true, phone: true, isActive: true },
    });
    if (!chosen || !chosen.isActive) {
      return fail(404, "Ese cliente ya no existe", "OWNER_NOT_FOUND");
    }
    if (normalizePhone(chosen.phone) !== phone) {
      return fail(400, "Ese cliente no tiene el teléfono que capturaste", "OWNER_MISMATCH");
    }
    ownerId = chosen.id;
    // La ficha existente fue curada por alguien: el walk-in NO la pisa.
    ownerName = `${chosen.firstName} ${chosen.lastName}`.replace(/\s*—\s*$/, "").trim();
  } else {
    const dups = await prisma.$queryRaw<
      { id: string; firstName: string; lastName: string; phone: string | null }[]
    >`
      SELECT id, "firstName", "lastName", phone FROM users
      WHERE "isActive" = true
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phone}
      ORDER BY "createdAt" ASC
      LIMIT 5
    `;
    if (dups.length > 0 && !input.forceNewOwner) {
      // Se PREGUNTA, no se bloquea. Diferencia deliberada con POST /users, que
      // corta sin salida: allá quien captura no tiene al cliente enfrente, aquí
      // sí y puede confirmarlo de viva voz.
      const petsByOwner = await prisma.pet.findMany({
        where: { ownerId: { in: dups.map((d) => d.id) }, isActive: true },
        select: { id: true, name: true, size: true, weight: true, ownerId: true },
        orderBy: { createdAt: "asc" },
      });
      const candidates: OwnerCandidate[] = dups.map((d) => ({
        id: d.id,
        name: `${d.firstName} ${d.lastName}`.replace(/\s*—\s*$/, "").trim(),
        phone: d.phone,
        pets: petsByOwner
          .filter((p) => p.ownerId === d.id)
          .map((p) => ({ id: p.id, name: p.name, size: p.size, weight: p.weight })),
      }));
      const first = candidates[0].name;
      return fail(
        409,
        dups.length === 1
          ? `Ese teléfono ya es de ${first}. ¿Es la misma persona?`
          : `Ese teléfono aparece en ${dups.length} fichas (${first}…). ¿Cuál es?`,
        "WALKIN_PHONE_EXISTS",
        { candidates }
      );
    }
  }

  // ── 2. ¿Ya conocemos a este perro? (LECTURA) ───────────────────────────
  let petId: string | null = null;
  let petCreated = false;
  let existingPet: {
    id: string;
    name: string;
    size: string;
    sizeDeclared: boolean;
    weight: number | null;
    photoUrl: string | null;
  } | null = null;

  if (ownerId) {
    if (input.confirmReusePetId) {
      const chosen = await prisma.pet.findUnique({
        where: { id: input.confirmReusePetId },
        select: {
          id: true, name: true, size: true, sizeDeclared: true,
          weight: true, photoUrl: true, ownerId: true, isActive: true,
        },
      });
      const shared = await sharedPetIds(prisma, ownerId);
      const accesible =
        chosen && chosen.isActive && (chosen.ownerId === ownerId || shared.includes(chosen.id));
      if (!accesible) return fail(404, "Esa mascota ya no existe", "PET_NOT_FOUND");
      existingPet = chosen;
      petId = chosen!.id;
    } else {
      // Incluye las mascotas COMPARTIDAS (pareja/familia que comparte perro).
      const shared = await sharedPetIds(prisma, ownerId);
      const suyas = await prisma.pet.findMany({
        where: {
          isActive: true,
          ...(shared.length > 0 ? { OR: [{ ownerId }, { id: { in: shared } }] } : { ownerId }),
        },
        select: { id: true, name: true, size: true, sizeDeclared: true, weight: true, photoUrl: true },
      });
      // `findPetByName` normaliza espacios y acentos: es el candado que atrapa
      // el caso "DUGAN " (con espacio final) que partió un expediente en dos.
      // Solo el nombre EXACTO, no el parecido (`findSimilarPetByName`): la
      // pantalla del baño sin cita no tiene "es otro perro" (nadie manda
      // `forceNewPet`), así que con "Luna" y "Luna Negra" el equipo solo podría
      // cancelar o cargarle el baño a la otra perra.
      const match = findPetByName(suyas, input.pet.name);
      if (match && !input.forceNewPet) {
        return fail(
          409,
          `${ownerName} ya tiene un perro llamado ${match.name}. ¿Es el mismo?`,
          "WALKIN_PET_EXISTS",
          { pet: { id: match.id, name: match.name, size: match.size, weight: match.weight } }
        );
      }
    }
  }

  // Talla con la que se va a cobrar y agendar. Si el perro ya existía CON peso,
  // el peso gana: es mejor dato que un vistazo desde el mostrador.
  // Talla con la que se va a cobrar y agendar. Tiene que ser EXACTAMENTE la que
  // resolverá `createTeamReservation` leyendo la ficha: si aquí se validara una
  // variante y allá se cobrara otra, el pre-flight dejaría pasar un baño que
  // después revienta con VARIANT_UNAVAILABLE, o peor, cobra otro precio.
  //
  // Por eso una ficha que YA sabe su talla (porque la pesaron, o porque alguien
  // la declaró viendo al perro) manda sobre el vistazo de hoy: son mejores
  // datos, y son los que va a usar el servidor de todos modos.
  const fichaMandaTalla = !!existingPet && (existingPet.weight != null || existingPet.sizeDeclared);
  const sizeParaCobro = (
    fichaMandaTalla ? billableBathSize(existingPet!) : input.pet.size
  ) as "XS" | "S" | "M" | "L" | "XL";
  const usaPeso = existingPet?.weight != null;
  if (fichaMandaTalla && sizeParaCobro !== input.pet.size) {
    warnings.push(
      usaPeso
        ? `${existingPet!.name} ya estaba registrado con ${existingPet!.weight} kg: se cobró como talla ${sizeParaCobro}, no ${input.pet.size}.`
        : `${existingPet!.name} ya tenía talla ${sizeParaCobro} en su ficha: se cobró esa, no ${input.pet.size}.`
    );
  }

  // ── 3. PRE-FLIGHT: todo lo que puede fallar, ANTES de escribir ─────────
  const cfg = await ensureConfig(prisma);
  if (!cfg.isActive) {
    return fail(400, "La agenda de baños está desactivada", "BATH_DISABLED");
  }
  const bathType = await prisma.serviceType.findUnique({ where: { code: "BATH" } });
  if (!bathType) return fail(500, "Servicio de baño no configurado", "SERVICE_MISSING");

  const variant = await prisma.serviceVariant.findUnique({
    where: {
      serviceTypeId_petSize_deslanado_corte: {
        serviceTypeId: bathType.id,
        petSize: sizeParaCobro === "XS" ? "S" : sizeParaCobro,
        deslanado: input.deslanado,
        corte: input.corte,
      },
    },
  });
  if (!variant || !variant.isActive) {
    return fail(
      400,
      `No hay precio configurado para talla ${sizeParaCobro}${input.corte ? " con corte" : ""}${input.deslanado ? " con deslanado" : ""}. Escribe el total a cobrar.`,
      "VARIANT_UNAVAILABLE"
    );
  }

  if (input.staffId) {
    const staffUser = await prisma.user.findUnique({ where: { id: input.staffId } });
    if (!staffUser || staffUser.role !== "STAFF") {
      return fail(400, "El staff asignado no es válido", "INVALID_STAFF");
    }
  }

  const schedule = await loadScheduleCfg(prisma);
  const { durationMinutes } = await resolveBathDuration(
    prisma,
    { variantId: variant.id, petId },
    schedule
  );
  const dateYMD = localYMD(appointmentAt);
  const busy = await loadBusyIntervals(prisma, dateYMD, schedule);
  const verdict = evaluateStart(appointmentAt, durationMinutes, schedule, busy);
  const agendaWarnings = verdict.ok ? [] : [`${input.pet.name.trim()}: ${verdict.message}`];
  if (agendaWarnings.length > 0 && !input.scheduleOverride) {
    return fail(409, agendaWarnings.join(" "), "AGENDA_CONFLICT", { warnings: agendaWarnings });
  }

  // ── 4. ESCRIBIR: dueño y perro ─────────────────────────────────────────
  if (!ownerId) {
    // Ficha walk-in: sin cuenta, con correo placeholder. `originLegacy` la deja
    // vinculable cuando el cliente se registre con ese mismo correo, y el
    // teléfono la deja reclamable por SMS. NUNCA poner clerkId ni otro rol: de
    // eso depende que `findLegacyCandidates` la encuentre.
    const created = await prisma.user.create({
      data: {
        email: `walkin+${randomUUID()}@holidoginn.local`,
        firstName: ownerName,
        // Convención de las ~360 fichas capturadas por el equipo: el nombre
        // completo va en firstName y lastName queda con el guión largo.
        lastName: "—",
        phone: input.owner.phone.trim(),
        role: "OWNER",
        originLegacy: true,
        expressIntakeAt: new Date(),
      },
      select: { id: true, phone: true },
    });
    ownerId = created.id;
    ownerCreated = true;
  }

  if (!petId) {
    const created = await prisma.pet.create({
      data: {
        ownerId,
        name: input.pet.name.trim(),
        // Verbatim: NO pasa por derivePetSize ni por sizeFromWeight, que sin
        // peso devolverían "M"/"S" y tirarían a la basura la talla que alguien
        // acaba de elegir viendo al perro.
        size: input.pet.size,
        sizeDeclared: true,
        weight: null,
        photoUrl: input.pet.photoUrl ?? null,
        expressIntakeAt: new Date(),
      },
      select: { id: true, name: true, size: true, photoUrl: true },
    });
    petId = created.id;
    petCreated = true;
  } else if (existingPet) {
    // Ficha reusada: sólo se AGREGA lo que falta, nunca se pisa lo que hay.
    const patch: Record<string, unknown> = {};
    if (input.pet.photoUrl && !existingPet.photoUrl) patch.photoUrl = input.pet.photoUrl;
    // Sin peso, la talla que alguien acaba de ver vale más que el "M" default.
    // Salvo que el perro esté hospedado en un cuarto que no la admita: ahí se
    // deja como está (misma salvaguarda que `derivePetSize`), y el baño se cobra
    // igual — no vale la pena tumbar la captura por corregir una ficha.
    if (existingPet.weight == null && !existingPet.sizeDeclared) {
      const cuarto = await tallaChocaConCuartoActivo(prisma, petId, input.pet.size);
      if (!cuarto) {
        patch.size = input.pet.size;
        patch.sizeDeclared = true;
      }
    }
    if (Object.keys(patch).length > 0) {
      await prisma.pet.update({ where: { id: petId }, data: patch });
    }
  }

  // ── 5. La reserva, por el camino de siempre ────────────────────────────
  const nota = [
    input.internalNotes?.trim() || null,
    input.forceNewOwner
      ? `[WALK-IN] Se creó una ficha nueva con un teléfono que ya existía (${input.owner.phone.trim()}), a criterio de quien capturó.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await createTeamReservation(prisma, {
    input: {
      reservationType: "BATH",
      ownerId,
      petId,
      appointmentAt,
      deslanado: input.deslanado,
      corte: input.corte,
      legalAccepted: true,
      // Nota del CLIENTE: un walk-in no deja recado, sólo hay nota interna.
      notes: null,
      internalNotes: nota || undefined,
      totalAmountOverride: input.totalAmountOverride,
      depositAgreed: input.depositAgreed,
      staffId: input.staffId,
      scheduleOverride: input.scheduleOverride,
    },
    actorUserId: params.actorUserId,
    source: params.source ?? "APP_ADMIN",
  });

  if (!res.ok) {
    // ── 6. Rollback compensatorio ACOTADO ────────────────────────────────
    // Sólo lo que nació en esta petición; una ficha reusada jamás se toca.
    // Van en try/catch: si el borrado falla, vale más devolver el error real
    // que un 500 opaco — el peor caso es un expediente huérfano que el
    // siguiente intento reusará por teléfono.
    try {
      if (petCreated && petId) await prisma.pet.delete({ where: { id: petId } });
      if (ownerCreated && ownerId) await prisma.user.delete({ where: { id: ownerId } });
    } catch {
      /* se ignora a propósito: manda el error original */
    }
    return res;
  }

  const row = res.data.reservations[0];
  return {
    ok: true,
    data: {
      reservation: row,
      owner: { id: ownerId, name: ownerName, phone: input.owner.phone.trim(), created: ownerCreated },
      pet: {
        id: petId!,
        name: row.pet?.name ?? input.pet.name.trim(),
        size: sizeParaCobro,
        photoUrl: input.pet.photoUrl ?? existingPet?.photoUrl ?? null,
        created: petCreated,
      },
      pricing: {
        amount: Number(row.totalAmount),
        variantId: variant.id,
        sizeSource: usaPeso ? "weight" : "declared",
      },
      agendaWarnings: res.data.agendaWarnings,
      warnings,
    },
  };
}
