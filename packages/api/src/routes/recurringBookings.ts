import { FastifyInstance } from "fastify";
import { Prisma } from "@holidoginn/db";
import type { PrismaClient, RecurringBooking } from "@holidoginn/db";
import {
  CreateRecurringBookingSchema,
  UpdateRecurringBookingSchema,
  SkipRecurringDateSchema,
  recurringBookingIssues,
  hotelTodayYMD,
  nextOccurrences,
  describeRecurrence,
  type RecurringBookingFields,
} from "@holidoginn/shared";
import { createAuthMiddleware, createStaffMiddleware } from "../middleware/auth";
import { createInternalGuard, logInternal } from "../lib/internalAuth";
import { sharedPetIds } from "../lib/petAccess";
import { generateRecurringOccurrences } from "../lib/recurringBookings";

// ─────────────────────────────────────────────────────────────────────────────
//  Citas recurrentes (ver lib/recurringBookings.ts)
//
//  GET    /recurring-bookings              lista (equipo)
//  GET    /recurring-bookings/:id          detalle
//  POST   /recurring-bookings              alta → genera de inmediato lo que ya toque
//  PATCH  /recurring-bookings/:id          editar / pausar / reanudar
//  POST   /recurring-bookings/:id/skip     saltar (o des-saltar) una fecha aún no creada
//  DELETE /recurring-bookings/:id          terminar (las citas ya creadas se quedan)
//  POST   /internal/recurring-bookings/generate   respaldo del ciclo (x-cron-secret)
//
//  ADMIN y STAFF crean y editan; el precio pactado (`totalAmountOverride`) es
//  solo de ADMIN: el STAFF ni lo ve ni lo cambia ("crear sí, dinero no").
// ─────────────────────────────────────────────────────────────────────────────

type SeriesWithOwner = RecurringBooking & {
  owner: { id: string; firstName: string; lastName: string; phone: string | null };
};

const ownerSelect = { select: { id: true, firstName: true, lastName: true, phone: true } };

/** Respuesta para la app: la serie + nombres + próximas fechas (y cuáles ya existen). */
async function present(
  prisma: PrismaClient,
  list: SeriesWithOwner[],
  isAdmin: boolean,
  now = new Date()
) {
  const today = hotelTodayYMD(now);
  const allPetIds = [...new Set(list.flatMap((s) => s.petIds))];
  const [pets, upcomingRows] = await Promise.all([
    prisma.pet.findMany({
      where: { id: { in: allPetIds } },
      select: { id: true, name: true, isActive: true, photoUrl: true },
    }),
    prisma.reservation.findMany({
      where: {
        recurringBookingId: { in: list.map((s) => s.id) },
        recurrenceDate: { gte: today },
      },
      select: {
        id: true,
        recurringBookingId: true,
        recurrenceDate: true,
        status: true,
        appointmentAt: true,
      },
      orderBy: { appointmentAt: "asc" },
    }),
  ]);
  const petById = new Map(pets.map((p) => [p.id, p]));

  return list.map((s) => {
    const rule = {
      intervalWeeks: s.intervalWeeks,
      weekdays: s.weekdays,
      anchorDate: s.anchorDate,
      endDate: s.endDate,
      skipDates: s.skipDates,
    };
    const created = upcomingRows.filter((r) => r.recurringBookingId === s.id);
    const upcoming = nextOccurrences(rule, today, 4).map((date) => {
      const row = created.find((r) => r.recurrenceDate === date);
      return {
        date,
        reservationId: row?.id ?? null,
        status: row?.status ?? null,
        // La cita existe pero el equipo la movió a otro día/hora.
        appointmentAt: row?.appointmentAt ?? null,
      };
    });
    const { totalAmountOverride, owner, ...rest } = s;
    return {
      ...rest,
      ...(isAdmin
        ? { totalAmountOverride: totalAmountOverride != null ? Number(totalAmountOverride) : null }
        : {}),
      owner,
      pets: s.petIds.map((id) => ({
        id,
        name: petById.get(id)?.name ?? "Mascota",
        isActive: petById.get(id)?.isActive ?? false,
        photoUrl: petById.get(id)?.photoUrl ?? null,
      })),
      summary: describeRecurrence(rule),
      upcoming,
    };
  });
}

/** Mascotas válidas para el dueño (suyas o compartidas) y activas. */
async function validatePets(
  prisma: PrismaClient,
  ownerId: string,
  petIds: string[]
): Promise<string | null> {
  const unique = [...new Set(petIds)];
  if (unique.length !== petIds.length) return "Hay mascotas repetidas";
  const pets = await prisma.pet.findMany({
    where: { id: { in: unique } },
    select: { id: true, ownerId: true, isActive: true, name: true },
  });
  if (pets.length !== unique.length) return "Mascota no encontrada";
  const shared = await sharedPetIds(prisma, ownerId);
  const ajena = pets.find((p) => p.ownerId !== ownerId && !shared.includes(p.id));
  if (ajena) return `${ajena.name} no pertenece a este cliente`;
  const inactiva = pets.find((p) => !p.isActive);
  if (inactiva) return `${inactiva.name} está dada de baja`;
  return null;
}

async function validateStaff(prisma: PrismaClient, staffId: string | null | undefined) {
  if (!staffId) return null;
  const u = await prisma.user.findUnique({ where: { id: staffId }, select: { role: true, isActive: true } });
  return u && u.role === "STAFF" && u.isActive ? null : "El staff asignado no es válido";
}

/** Columnas de Prisma a partir de los campos validados (alta o resultado de un PATCH). */
function toColumns(v: Partial<RecurringBookingFields>, isAdmin: boolean) {
  const data: Prisma.RecurringBookingUncheckedUpdateInput = {};
  if (v.reservationType !== undefined) data.reservationType = v.reservationType;
  if (v.petIds !== undefined) data.petIds = v.petIds;
  if (v.intervalWeeks !== undefined) data.intervalWeeks = v.intervalWeeks;
  if (v.weekdays !== undefined) data.weekdays = [...new Set(v.weekdays)].sort();
  if (v.anchorDate !== undefined) data.anchorDate = v.anchorDate;
  if (v.endDate !== undefined) data.endDate = v.endDate;
  if (v.startTime !== undefined) data.startTime = v.startTime;
  if (v.deslanado !== undefined) data.deslanado = v.deslanado;
  if (v.corte !== undefined) data.corte = v.corte;
  if (v.checkInTime !== undefined) data.checkInTime = v.checkInTime;
  if (v.checkOutTime !== undefined) data.checkOutTime = v.checkOutTime;
  if (v.homeDelivery !== undefined) {
    const d = v.homeDelivery;
    data.homeDelivery = !!d;
    data.homeDeliveryAddress = d?.address ?? null;
    data.homeDeliveryLat = d?.lat ?? null;
    data.homeDeliveryLng = d?.lng ?? null;
    data.homeDeliveryPlaceId = d?.placeId ?? null;
    data.homeDeliveryTrip = d?.trip ?? "PICKUP";
  }
  if (v.chargeDelivery !== undefined) data.chargeDelivery = v.chargeDelivery;
  if (v.totalAmountOverride !== undefined && isAdmin) {
    data.totalAmountOverride =
      v.totalAmountOverride != null ? new Prisma.Decimal(v.totalAmountOverride) : null;
  }
  if (v.internalNotes !== undefined) data.internalNotes = v.internalNotes?.trim() || null;
  if (v.staffId !== undefined) data.staffId = v.staffId || null;
  if (v.leadDays !== undefined) data.leadDays = v.leadDays;
  return data;
}

/** La serie guardada, en la forma de los campos validables (para fusionar un PATCH). */
function fieldsOf(s: RecurringBooking): RecurringBookingFields {
  return {
    reservationType: s.reservationType === "DAYCARE" ? "DAYCARE" : "BATH",
    ownerId: s.ownerId,
    petIds: s.petIds,
    intervalWeeks: s.intervalWeeks,
    weekdays: s.weekdays,
    anchorDate: s.anchorDate,
    endDate: s.endDate,
    startTime: s.startTime,
    checkInTime: s.checkInTime,
    checkOutTime: s.checkOutTime,
  };
}

export default async function recurringBookingsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  const authMiddleware = createAuthMiddleware(prisma);
  const staffMiddleware = createStaffMiddleware();
  const internalGuard = createInternalGuard(prisma);
  const team = { preHandler: [authMiddleware, staffMiddleware] };

  const load = (id: string) =>
    prisma.recurringBooking.findFirst({ where: { id, deletedAt: null }, include: { owner: ownerSelect } });

  fastify.get<{ Querystring: { ownerId?: string } }>("/recurring-bookings", team, async (request) => {
    const list = await prisma.recurringBooking.findMany({
      where: {
        deletedAt: null,
        ...(request.query.ownerId ? { ownerId: request.query.ownerId } : {}),
      },
      include: { owner: ownerSelect },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    return present(prisma, list, request.userRole === "ADMIN");
  });

  fastify.get<{ Params: { id: string } }>("/recurring-bookings/:id", team, async (request, reply) => {
    const s = await load(request.params.id);
    if (!s) return reply.status(404).send({ error: "Serie no encontrada" });
    const [out] = await present(prisma, [s], request.userRole === "ADMIN");
    return out;
  });

  fastify.post("/recurring-bookings", team, async (request, reply) => {
    const parsed = CreateRecurringBookingSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return reply.status(400).send({ error: msg, code: "VALIDATION" });
    }
    const v = parsed.data;
    const isAdmin = request.userRole === "ADMIN";

    const owner = await prisma.user.findUnique({ where: { id: v.ownerId }, select: { id: true } });
    if (!owner) return reply.status(404).send({ error: "Cliente no encontrado" });
    const petError = await validatePets(prisma, v.ownerId, v.petIds);
    if (petError) return reply.status(400).send({ error: petError, code: "VALIDATION" });
    const staffError = await validateStaff(prisma, v.staffId);
    if (staffError) return reply.status(400).send({ error: staffError, code: "VALIDATION" });

    const columns = toColumns(v, isAdmin) as Prisma.RecurringBookingUncheckedCreateInput;
    const created = await prisma.recurringBooking.create({
      data: {
        ...columns,
        reservationType: v.reservationType,
        petIds: v.petIds,
        intervalWeeks: v.intervalWeeks,
        weekdays: [...new Set(v.weekdays)].sort(),
        anchorDate: v.anchorDate,
        ownerId: v.ownerId,
        createdById: request.userId ?? null,
      },
    });
    request.log.info({ seriesId: created.id, by: request.userId }, "[recurrentes] serie creada");

    // La próxima cita aparece YA en la agenda (si cae dentro de la ventana).
    const gen = await generateRecurringOccurrences(prisma, new Date(), { seriesId: created.id });
    const s = await load(created.id);
    const [out] = await present(prisma, [s!], isAdmin);
    return reply.status(201).send({ ...out, generated: gen.created, failed: gen.failed });
  });

  fastify.patch<{ Params: { id: string } }>("/recurring-bookings/:id", team, async (request, reply) => {
    const parsed = UpdateRecurringBookingSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return reply.status(400).send({ error: msg, code: "VALIDATION" });
    }
    const current = await load(request.params.id);
    if (!current) return reply.status(404).send({ error: "Serie no encontrada" });
    const isAdmin = request.userRole === "ADMIN";
    const { active, ...patch } = parsed.data;

    const merged = { ...fieldsOf(current), ...patch } as RecurringBookingFields;
    const issues = recurringBookingIssues(merged);
    if (issues.length > 0) return reply.status(400).send({ error: issues[0], code: "VALIDATION" });
    if (patch.petIds) {
      const petError = await validatePets(prisma, current.ownerId, patch.petIds);
      if (petError) return reply.status(400).send({ error: petError, code: "VALIDATION" });
    }
    if (patch.staffId !== undefined) {
      const staffError = await validateStaff(prisma, patch.staffId);
      if (staffError) return reply.status(400).send({ error: staffError, code: "VALIDATION" });
    }
    // Con precio pactado, cambiar los perros o el cobro del domicilio cambia
    // lo que ese precio cubre: es dinero, así que solo ADMIN.
    if (!isAdmin && current.totalAmountOverride != null) {
      const cambiaPerros =
        patch.petIds !== undefined &&
        (patch.petIds.length !== current.petIds.length ||
          patch.petIds.some((p) => !current.petIds.includes(p)));
      const cambiaCobro =
        patch.chargeDelivery !== undefined && patch.chargeDelivery !== current.chargeDelivery;
      if (cambiaPerros || cambiaCobro) {
        return reply.status(403).send({
          error: "Esta cita tiene precio pactado: los perros o el cobro del domicilio solo los cambia un admin.",
          code: "ADMIN_ONLY",
        });
      }
    }

    const data = toColumns(patch, isAdmin);
    if (active !== undefined) {
      data.active = active;
      if (active) data.pausedReason = null;
    }
    // Revisar de nuevo la ventana con la regla nueva: las fechas que ya tienen
    // cita se respetan y las que falten (p. ej. cambió de viernes a jueves, o
    // se reanudó) se crean ya. Ver lib/recurringBookings.ts.
    data.generatedThrough = null;
    await prisma.recurringBooking.update({ where: { id: current.id }, data });

    const gen =
      active === false
        ? { created: [], failed: [] }
        : await generateRecurringOccurrences(prisma, new Date(), { seriesId: current.id });
    const s = await load(current.id);
    const [out] = await present(prisma, [s!], isAdmin);
    return { ...out, generated: gen.created, failed: gen.failed };
  });

  fastify.post<{ Params: { id: string } }>("/recurring-bookings/:id/skip", team, async (request, reply) => {
    const parsed = SkipRecurringDateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Fecha inválida", code: "VALIDATION" });
    const { date, skip = true } = parsed.data;
    const current = await load(request.params.id);
    if (!current) return reply.status(404).send({ error: "Serie no encontrada" });

    if (skip) {
      const existing = await prisma.reservation.findFirst({
        where: { recurringBookingId: current.id, recurrenceDate: date },
        select: { id: true },
      });
      if (existing) {
        return reply.status(409).send({
          error: "Esa cita ya está en la agenda: cancélala o muévela desde la reserva.",
          code: "ALREADY_CREATED",
          reservationId: existing.id,
        });
      }
    }
    const skipDates = skip
      ? [...new Set([...current.skipDates, date])].sort()
      : current.skipDates.filter((d) => d !== date);
    await prisma.recurringBooking.update({
      where: { id: current.id },
      // Des-saltar: la fecha pudo quedar atrás de `generatedThrough`; se revisa
      // la ventana otra vez para que sí se cree.
      data: { skipDates, ...(skip ? {} : { generatedThrough: null }) },
    });
    // Des-saltar una fecha que ya está en la ventana: que se cree ya.
    if (!skip) await generateRecurringOccurrences(prisma, new Date(), { seriesId: current.id });

    const s = await load(current.id);
    const [out] = await present(prisma, [s!], request.userRole === "ADMIN");
    return out;
  });

  fastify.delete<{ Params: { id: string } }>("/recurring-bookings/:id", team, async (request, reply) => {
    const current = await load(request.params.id);
    if (!current) return reply.status(404).send({ error: "Serie no encontrada" });
    await prisma.recurringBooking.update({
      where: { id: current.id },
      data: { active: false, deletedAt: new Date() },
    });
    request.log.info({ seriesId: current.id, by: request.userId }, "[recurrentes] serie terminada");
    return { success: true };
  });

  fastify.post("/internal/recurring-bookings/generate", { preHandler: internalGuard }, async (request) => {
    const res = await generateRecurringOccurrences(prisma);
    logInternal(request, "internal.recurring-generate", {
      created: res.created.length,
      failed: res.failed.length,
    });
    return res;
  });
}
