/**
 * Recordatorios al CLIENTE antes de su cita: el día anterior (baño, guardería,
 * hospedaje) y 1.5 h antes (baño, llegada al hotel).
 *
 * ¿Por qué viven aquí y no en las rutas `/internal/*` de baths.ts?
 *
 * Hasta octubre de 2026 solo se disparaban desde el cron de GitHub Actions
 * (.github/workflows/cron.yml). GitHub NO respeta el horario de los crons
 * programados: en la práctica corría ~10 veces al día en lugar de las ~100
 * pedidas, con huecos de hasta 6 horas. El recordatorio de baño buscaba citas a
 * 23–25 h de distancia, así que casi nunca coincidía: un cliente reservó baño
 * para el viernes, no llegó y dijo — con razón — que no le llegó recordatorio.
 *
 * Ahora la API los corre sola cada 10 minutos (`startClientRemindersLoop`, se
 * arranca en index.ts). Las rutas internas siguen existiendo como respaldo y
 * para dispararlos a mano; todas las funciones son idempotentes (deduplican
 * contra la Notification ya enviada), así que correrlas de más no repite nada.
 *
 * Y el recordatorio del día anterior va también por CORREO: el push solo llega
 * si el cliente tiene la app con las notificaciones prendidas.
 */
import type { PrismaClient } from "@holidoginn/db";
import { emailPetAudience, notifyPetAudience } from "./notify";
import {
  TZ_HOTEL,
  dayRangeUtc,
  localMinutesOfDay,
  localYMD,
} from "./bathAvailability";
import { instanteDeLlegada, rangoDeMananaHotel } from "./stayTimes";
import { getLodgingPricing } from "./pricing";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Horario en el que se manda el aviso del DÍA ANTERIOR (hora del hotel).
 * Con el ciclo cada 10 min sale en cuanto abre la ventana: nadie recibe un
 * "mañana tienes baño" a las 5 a.m. ni a medianoche.
 */
const DAY_BEFORE_FROM_HOUR = 9;
const DAY_BEFORE_UNTIL_HOUR = 21;

/**
 * La petición de hora de llegada/recogida de hospedaje salía a las 11:00 con el
 * cron diario; se respeta esa hora como inicio.
 */
const STAY_TIME_FROM_HOUR = 11;

type Row = {
  id: string;
  groupId: string | null;
  ownerId: string;
  petId: string;
  pet: { name: string };
};

/** Una visita = un grupo multi-mascota: un solo aviso, no uno por perro. */
function groupByVisit<T extends Row>(rows: T[]): T[][] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.groupId ?? r.id;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.values()];
}

function petNames(group: Row[]): string {
  const names = [...new Set(group.map((r) => r.pet.name))];
  if (names.length <= 1) return names[0] ?? "tu peludito";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * ¿Ya se le mandó a este dueño un recordatorio de este `kind` para alguna
 * reserva de la visita? Filtra por `kind` a propósito: bajo el mismo tipo
 * RESERVATION_REMINDER conviven el aviso del día anterior, el de 1.5 h y la
 * petición de hora, y cada uno se deduplica por separado.
 */
async function alreadyReminded(
  prisma: PrismaClient,
  ownerId: string,
  reservationIds: string[],
  kind: string
): Promise<boolean> {
  const found = await prisma.notification.findFirst({
    where: {
      userId: ownerId,
      type: "RESERVATION_REMINDER",
      AND: [
        { data: { path: ["kind"], equals: kind } },
        {
          OR: reservationIds.map((id) => ({
            data: { path: ["reservationId"], equals: id },
          })),
        },
      ],
    },
    select: { id: true },
  });
  return found !== null;
}

function hourInHotel(now: Date): number {
  return Math.floor(localMinutesOfDay(now) / 60);
}

/** "9:00 am" en hora del hotel (mismo formato que `hhmmLegible`). */
function hotelTime(d: Date): string {
  const min = localMinutesOfDay(d);
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return hhmmLegible(`${hh}:${mm}`);
}

/** "viernes 16 de octubre". `utc` para fechas guardadas como día a 00:00Z / 12:00Z. */
function dayLabel(d: Date, utc: boolean): string {
  // es-MX lo arma como "viernes, 16 de octubre": sin la coma se lee mejor
  // dentro de una frase ("mañana, viernes 16 de octubre, a las…").
  return d
    .toLocaleDateString("es-MX", {
      timeZone: utc ? "UTC" : TZ_HOTEL,
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(",", "");
}

/** "09:00" → "9:00 am". */
function hhmmLegible(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Lo mismo que avisa el push, también por correo. Best-effort: nunca lanza.
 */
async function pushAndEmail(
  prisma: PrismaClient,
  first: Row,
  push: { title: string; body: string; data: Record<string, string> },
  email: { subject: string; paragraphs: string[] }
): Promise<void> {
  await notifyPetAudience(
    prisma,
    { petId: first.petId, ownerId: first.ownerId },
    { type: "RESERVATION_REMINDER", ...push }
  );
  await emailPetAudience(prisma, { petId: first.petId, ownerId: first.ownerId }, email);
}

const NO_SHOW_LINE =
  "Si cambian tus planes, avísanos por WhatsApp para liberar el espacio para otro peludito.";

// ─────────────────────────────────────────────────────────────────────────────
//  Día anterior: baño, guardería y llegada al hotel
// ─────────────────────────────────────────────────────────────────────────────

export async function sendDayBeforeReminders(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<{ sent: number; checked: number }> {
  const hour = hourInHotel(now);
  if (hour < DAY_BEFORE_FROM_HOUR || hour >= DAY_BEFORE_UNTIL_HOUR) {
    return { sent: 0, checked: 0 };
  }

  // Baño: `appointmentAt` es un instante real → mañana en hora del hotel.
  const bathRange = dayRangeUtc(localYMD(new Date(now.getTime() + MS_PER_DAY)));
  // Guardería (anclada a mediodía UTC) y hospedaje (día a 00:00Z): el día
  // calendario de mañana como rango UTC.
  const anchoredRange = rangoDeMananaHotel(now);

  const select = {
    id: true,
    groupId: true,
    ownerId: true,
    petId: true,
    appointmentAt: true,
    checkIn: true,
    checkInTime: true,
    checkOutTime: true,
    pet: { select: { name: true } },
  } as const;

  const [baths, daycares, stays] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        reservationType: "BATH",
        status: "CONFIRMED",
        appointmentAt: { gte: bathRange.start, lt: bathRange.end },
      },
      select,
      orderBy: { appointmentAt: "asc" },
    }),
    prisma.reservation.findMany({
      where: {
        reservationType: "DAYCARE",
        status: "CONFIRMED",
        appointmentAt: { gte: anchoredRange.start, lt: anchoredRange.end },
      },
      select,
    }),
    // Solo las que YA tienen hora de llegada: a las que no la tienen,
    // `sendStayTimeReminders` les pide la hora y ese aviso ya dice "mañana
    // es su check-in". Mandar los dos sería doble push para lo mismo.
    prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        status: "CONFIRMED",
        checkInTime: { not: null },
        checkIn: { gte: anchoredRange.start, lt: anchoredRange.end },
      },
      select,
    }),
  ]);

  let sent = 0;

  for (const group of groupByVisit(baths)) {
    const first = group[0];
    if (!first.appointmentAt) continue;
    const ids = group.map((r) => r.id);
    if (await alreadyReminded(prisma, first.ownerId, ids, "BATH_REMINDER")) continue;
    const who = petNames(group);
    const hora = hotelTime(first.appointmentAt);
    const dia = dayLabel(first.appointmentAt, false);
    await pushAndEmail(
      prisma,
      first,
      {
        title: "Recordatorio: cita de baño mañana 🛁",
        body: `${who} tiene baño mañana a las ${hora}. ¡Te esperamos! Si no puedes venir, avísanos.`,
        data: { reservationId: first.id, kind: "BATH_REMINDER" },
      },
      {
        subject: `Recordatorio: baño de ${who} mañana a las ${hora} 🛁`,
        paragraphs: [
          `Te recordamos que ${who} tiene cita de baño mañana, ${dia}, a las ${hora}.`,
          NO_SHOW_LINE,
        ],
      }
    );
    sent++;
  }

  for (const group of groupByVisit(daycares)) {
    const first = group[0];
    if (!first.appointmentAt) continue;
    const ids = group.map((r) => r.id);
    if (await alreadyReminded(prisma, first.ownerId, ids, "DAYCARE_REMINDER")) continue;
    const who = petNames(group);
    const dia = dayLabel(first.appointmentAt, true);
    const horario =
      first.checkInTime && first.checkOutTime
        ? ` de ${hhmmLegible(first.checkInTime)} a ${hhmmLegible(first.checkOutTime)}`
        : first.checkInTime
          ? ` a las ${hhmmLegible(first.checkInTime)}`
          : "";
    await pushAndEmail(
      prisma,
      first,
      {
        title: "Recordatorio: guardería mañana 🐾",
        body: `${who} tiene guardería mañana${horario}. ¡Te esperamos!`,
        data: { reservationId: first.id, kind: "DAYCARE_REMINDER" },
      },
      {
        subject: `Recordatorio: guardería de ${who} mañana 🐾`,
        paragraphs: [
          `Te recordamos que ${who} tiene guardería mañana, ${dia}${horario}.`,
          NO_SHOW_LINE,
        ],
      }
    );
    sent++;
  }

  for (const group of groupByVisit(stays)) {
    const first = group[0];
    if (!first.checkIn || !first.checkInTime) continue;
    const ids = group.map((r) => r.id);
    if (await alreadyReminded(prisma, first.ownerId, ids, "STAY_CHECKIN_REMINDER")) continue;
    const who = petNames(group);
    const hora = hhmmLegible(first.checkInTime);
    const dia = dayLabel(first.checkIn, true);
    await pushAndEmail(
      prisma,
      first,
      {
        title: `Mañana llega ${who} al hotel 🏨`,
        body: `Te esperamos mañana a las ${hora}. Si cambian tus planes, avísanos.`,
        data: { reservationId: first.id, kind: "STAY_CHECKIN_REMINDER" },
      },
      {
        subject: `Recordatorio: mañana es el check-in de ${who} 🏨`,
        paragraphs: [
          `Te recordamos que mañana, ${dia}, es el check-in de ${who} en Holidog Inn. Te esperamos a las ${hora}.`,
          "Trae su comida y, si toma algún medicamento, las indicaciones por escrito.",
          NO_SHOW_LINE,
        ],
      }
    );
    sent++;
  }

  return { sent, checked: baths.length + daycares.length + stays.length };
}

// ─────────────────────────────────────────────────────────────────────────────
//  1.5 h antes: baño y llegada al hotel (solo push)
// ─────────────────────────────────────────────────────────────────────────────

export async function sendNinetyMinuteReminders(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<{ sent: number; checked: number }> {
  // Ventana de 1 h centrada en t-1.5h.
  const windowStart = new Date(now.getTime() + 60 * 60 * 1000); // +60 min
  const windowEnd = new Date(now.getTime() + 120 * 60 * 1000); // +120 min

  // La llegada real de una estancia NO se puede filtrar en SQL: `checkIn`
  // guarda el DÍA a las 00:00 UTC y la hora vive aparte, en `checkInTime`
  // ("HH:mm" local). Se traen las estancias cuyo día ronda la ventana y el
  // instante se resuelve abajo, en memoria.
  //
  // Antes se comparaba `checkIn` —o sea, las 00:00 UTC— directamente contra
  // la ventana: el recordatorio salía a las 5 p.m. del día ANTERIOR y le
  // anunciaba al cliente esa misma hora inventada.
  const upcoming = await prisma.reservation.findMany({
    where: {
      status: { notIn: ["CANCELLED", "CHECKED_OUT"] },
      OR: [
        {
          reservationType: "BATH",
          appointmentAt: { gte: windowStart, lt: windowEnd },
        },
        {
          reservationType: "STAY",
          checkInTime: { not: null },
          checkIn: {
            gte: new Date(now.getTime() - MS_PER_DAY),
            lt: new Date(now.getTime() + 2 * MS_PER_DAY),
          },
        },
      ],
    },
    include: {
      pet: { select: { name: true } },
    },
  });

  let sent = 0;
  for (const res of upcoming) {
    const target = instanteDeLlegada(res);
    if (!target) continue;
    // Para las estancias el filtro de la ventana se hace aquí (ver arriba).
    if (target < windowStart || target >= windowEnd) continue;

    if (await alreadyReminded(prisma, res.ownerId, [res.id], "REMINDER_90MIN")) continue;

    const when = hotelTime(target);
    const isBath = res.reservationType === "BATH";
    const title = isBath
      ? `Baño de ${res.pet.name} en 1.5 horas 🛁`
      : `Check-in de ${res.pet.name} en 1.5 horas 🏨`;
    const body = isBath
      ? `${res.pet.name} tiene cita a las ${when}. ¡Te esperamos!`
      : `${res.pet.name} entra al hotel a las ${when}. Prepara su cartilla y maletita.`;

    await notifyPetAudience(prisma, { petId: res.petId, ownerId: res.ownerId }, {
      type: "RESERVATION_REMINDER",
      title,
      body,
      data: { reservationId: res.id, kind: "REMINDER_90MIN" },
    });
    sent++;
  }

  return { sent, checked: upcoming.length };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hospedaje sin hora de llegada/recogida: se le pide el día anterior
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un día antes del check-in (o check-out) de un hospedaje, si el cliente NO ha
 * indicado la hora estimada de llegada (o recogida), se le pide. "Mañana" es
 * el día calendario siguiente en Hermosillo (rangoDeMananaHotel), no una
 * ventana de horas. Dedup por `groupKey` + `kind`: un solo aviso por visita.
 */
export async function sendStayTimeReminders(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<{ sent: number; checked: number }> {
  const hour = hourInHotel(now);
  if (hour < STAY_TIME_FROM_HOUR || hour >= DAY_BEFORE_UNTIL_HOUR) {
    return { sent: 0, checked: 0 };
  }

  const { start: windowStart, end: windowEnd } = rangoDeMananaHotel(now);

  const [checkins, checkouts] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        status: "CONFIRMED",
        checkInTime: null,
        checkIn: { gte: windowStart, lt: windowEnd },
      },
      include: { pet: { select: { name: true } } },
    }),
    prisma.reservation.findMany({
      where: {
        reservationType: "STAY",
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        checkOutTime: null,
        checkOut: { gte: windowStart, lt: windowEnd },
      },
      include: { pet: { select: { name: true } } },
    }),
  ]);

  // Tarifa de guardería vigente (Config → Tarifas) para el aviso de
  // recogida: antes decía "$25/h" quemado y la tarifa real ya era otra.
  const { daycareHourPrice } =
    checkouts.length > 0 ? await getLodgingPricing(prisma) : { daycareHourPrice: 0 };
  const tarifaGuarderia =
    daycareHourPrice > 0 ? `, $${daycareHourPrice.toLocaleString("es-MX")}/h` : "";

  let sent = 0;
  const remind = async (
    group: (typeof checkins)[number][],
    kind: "CHECKIN_TIME" | "CHECKOUT_TIME"
  ) => {
    const first = group[0];
    const groupKey = first.groupId ?? first.id;

    const already = await prisma.notification.findFirst({
      where: {
        userId: first.ownerId,
        type: "RESERVATION_REMINDER",
        data: { path: ["kind"], equals: kind },
        AND: [{ data: { path: ["groupKey"], equals: groupKey } }],
      },
      select: { id: true },
    });
    if (already) return;

    const names = group.map((r) => r.pet.name);
    const who = names.length === 1 ? names[0] : "tus peluditos";
    const title =
      kind === "CHECKIN_TIME"
        ? `¿A qué hora llega ${who} mañana? 🐾`
        : `¿A qué hora recoges a ${who} mañana?`;
    const body =
      kind === "CHECKIN_TIME"
        ? "Mañana es su check-in. Indícanos la hora de entrada en la app para tenerlo todo listo."
        : `Mañana es su check-out. Indícanos la hora de recogida en la app (después de la 1:00 pm aplica guardería${tarifaGuarderia}).`;

    await notifyPetAudience(prisma, { petId: first.petId, ownerId: first.ownerId }, {
      type: "RESERVATION_REMINDER",
      title,
      body,
      data: { reservationId: first.id, kind, groupKey },
    });
    // La llegada es el recordatorio de la cita en sí: también por correo.
    if (kind === "CHECKIN_TIME" && first.checkIn) {
      const nombres = petNames(group);
      await emailPetAudience(
        prisma,
        { petId: first.petId, ownerId: first.ownerId },
        {
          subject: `Recordatorio: mañana es el check-in de ${nombres} 🏨`,
          paragraphs: [
            `Te recordamos que mañana, ${dayLabel(first.checkIn, true)}, es el check-in de ${nombres} en Holidog Inn.`,
            "Indícanos en la app (o por WhatsApp) a qué hora llegas para tener todo listo.",
            NO_SHOW_LINE,
          ],
        }
      );
    }
    sent++;
  };

  for (const group of groupByVisit(checkins)) await remind(group, "CHECKIN_TIME");
  for (const group of groupByVisit(checkouts)) await remind(group, "CHECKOUT_TIME");

  return { sent, checked: checkins.length + checkouts.length };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ciclo dentro de la API
// ─────────────────────────────────────────────────────────────────────────────

const LOOP_INTERVAL_MS = 10 * 60 * 1000;

/** Corre todos los recordatorios. Cada uno aísla su error. */
export async function runClientReminders(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<void> {
  const jobs: [string, () => Promise<{ sent: number }>][] = [
    ["día anterior", () => sendDayBeforeReminders(prisma, now)],
    ["1.5 h", () => sendNinetyMinuteReminders(prisma, now)],
    ["hora de hospedaje", () => sendStayTimeReminders(prisma, now)],
  ];
  for (const [name, job] of jobs) {
    try {
      const { sent } = await job();
      if (sent > 0) console.info(`[recordatorios] ${name}: ${sent} enviado(s)`);
    } catch (err) {
      console.error(`[recordatorios] ${name} falló:`, err);
    }
  }
}

/**
 * Arranca el ciclo cada 10 min. No depende de que alguien use la app (como
 * `triggerMaintenance`) ni del cron de GitHub (ver la nota de arriba).
 *
 * Supone UNA instancia del API (Railway). Con varias réplicas el dedup contra
 * Notification sigue evitando la mayoría de duplicados, pero dos corridas
 * simultáneas podrían cruzarse: en ese caso, apagar con
 * CLIENT_REMINDERS_LOOP=0 en todas menos una.
 */
export function startClientRemindersLoop(prisma: PrismaClient): () => void {
  if (process.env.CLIENT_REMINDERS_LOOP === "0") return () => {};
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runClientReminders(prisma).finally(() => {
      running = false;
    });
  };
  // Primera corrida al minuto de arrancar: no compite con el arranque/migración.
  const first = setTimeout(tick, 60 * 1000);
  const interval = setInterval(tick, LOOP_INTERVAL_MS);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
