/**
 * Agenda del EQUIPO (ADMIN + STAFF): quién llega y quién se va.
 *
 * Lo pidió el equipo en noviembre de 2026. Antes usaban el calendario de Gmail
 * con un recordatorio 30 min antes de cada check-in/check-out («Molly check-in
 * 10 AM»); con la app ya no tenían nada parecido y había que acordarse de
 * memoria. Dos avisos:
 *
 *   1. Resumen del día siguiente, a las 6:00 pm del hotel: llegadas, salidas,
 *      baños y guardería de mañana, con las horas y si hay que ir a domicilio.
 *   2. Un aviso ~30 min antes de cada llegada, salida, baño o entrada/salida
 *      de guardería que TENGA hora.
 *
 * Corre en el mismo ciclo de 10 min que los recordatorios del cliente
 * (`runClientReminders`). Idempotente: deduplica contra la Notification ya
 * enviada, así que correrlo de más no repite nada.
 *
 * ⚠️ Dos anclajes de fecha (ver memoria "fechas-estadia-utc-display"):
 *   - STAY: `checkIn`/`checkOut` guardan el DÍA a las 00:00Z y la hora vive
 *     aparte en `checkInTime`/`checkOutTime` ("HH:mm" del hotel).
 *   - DAYCARE: `appointmentAt` anclado a mediodía UTC (solo el día) + horas.
 *   - BATH: `appointmentAt` es un instante real; el baño de un hospedado vive
 *     en `reservation_addons.scheduledAt`, también instante real.
 */
import type { PrismaClient } from "@holidoginn/db";
import { equipoActivoIds, notifyUsers } from "./notify";
import { dayRangeUtc, localMinutesOfDay, ymdAtLocalMinutes } from "./bathAvailability";
import { rangoDeMananaHotel } from "./stayTimes";

// ─────────────────────────────────────────────────────────────────────────────
//  Modelo puro (sin base de datos): eventos y textos
// ─────────────────────────────────────────────────────────────────────────────

export type AgendaTipo = "LLEGA" | "SALE" | "BANO" | "GUARDERIA_ENTRA" | "GUARDERIA_SALE";

/** Qué hay que hacer a domicilio en ESTE evento. */
export type AgendaDomicilio = "RECOGER" | "ENTREGAR" | "RECOGER_Y_ENTREGAR" | null;

export type AgendaEvent = {
  tipo: AgendaTipo;
  petNames: string[];
  /** Instante real. `null` = el cliente no ha dado la hora. */
  at: Date | null;
  domicilio: AgendaDomicilio;
  /** Baño de un perro hospedado (add-on del hospedaje, no cita suelta). */
  hospedado?: boolean;
  /** Para abrir la reserva al tocar el aviso. */
  reservationId: string;
  reservationType: "STAY" | "BATH" | "DAYCARE";
  /** Visita (grupo multi-mascota) a la que pertenece. */
  visitKey: string;
};

export type DeliveryTrip = "PICKUP" | "DROPOFF" | "ROUND_TRIP";

/**
 * El domicilio de una visita se contrata como ida / vuelta / redondo. En la
 * llegada importa la ida (recoger); en la salida, la vuelta (entregar). Un
 * baño suelto con redondo es las dos cosas en el mismo evento.
 */
export function domicilioDe(
  tipo: AgendaTipo,
  trip: DeliveryTrip | null
): AgendaDomicilio {
  if (!trip) return null;
  const recoge = trip === "PICKUP" || trip === "ROUND_TRIP";
  const entrega = trip === "DROPOFF" || trip === "ROUND_TRIP";
  if (tipo === "BANO") {
    if (recoge && entrega) return "RECOGER_Y_ENTREGAR";
    return recoge ? "RECOGER" : "ENTREGAR";
  }
  if (tipo === "LLEGA" || tipo === "GUARDERIA_ENTRA") return recoge ? "RECOGER" : null;
  return entrega ? "ENTREGAR" : null;
}

/** "Polo", "Polo y Luna", "Polo, Luna y Toby". */
export function unirNombres(names: readonly string[]): string {
  const unicos = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const last = unicos[unicos.length - 1];
  if (!last) return "Sin nombre";
  if (unicos.length === 1) return last;
  return `${unicos.slice(0, -1).join(", ")} y ${last}`;
}

/** "10:00 am" en hora del hotel. */
function hora(at: Date): string {
  const min = localMinutesOfDay(at);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const DOMICILIO_CORTO: Record<Exclude<AgendaDomicilio, null>, string> = {
  RECOGER: "🚐 recoger en casa",
  ENTREGAR: "🚐 entregar en casa",
  RECOGER_Y_ENTREGAR: "🚐 recoger y entregar en casa",
};

const DOMICILIO_LARGO: Record<Exclude<AgendaDomicilio, null>, string> = {
  RECOGER: "🚐 Es recogida a domicilio: hay que ir por él a su casa.",
  ENTREGAR: "🚐 Es entrega a domicilio: hay que llevarlo a su casa.",
  RECOGER_Y_ENTREGAR: "🚐 Es a domicilio: hay que ir por él y luego llevarlo a su casa.",
};

const ORDEN_SECCION: AgendaTipo[] = ["LLEGA", "SALE", "BANO", "GUARDERIA_ENTRA"];

/** Por hora; los que no tienen hora, al final. */
function porHora(a: AgendaEvent, b: AgendaEvent): number {
  if (a.at && b.at) return a.at.getTime() - b.at.getTime();
  if (a.at) return -1;
  if (b.at) return 1;
  return 0;
}

function renglon(e: AgendaEvent, horaTexto: string | null): string {
  const partes = [unirNombres(e.petNames), horaTexto ?? "sin hora"];
  if (e.hospedado) partes.push("hospedado");
  let txt = partes.join(" · ");
  if (e.domicilio) txt += ` (${DOMICILIO_CORTO[e.domicilio]})`;
  return txt;
}

/**
 * Resumen del día siguiente. `null` si mañana no hay nada: un aviso de «no hay
 * nada» todos los días se vuelve ruido y se deja de leer.
 */
export function buildTomorrowSummary(
  events: AgendaEvent[]
): { title: string; body: string } | null {
  if (events.length === 0) return null;

  // La guardería se pinta en un solo renglón con su rango de horas.
  const salidasGuarderia = new Map<string, AgendaEvent>();
  for (const e of events) {
    if (e.tipo === "GUARDERIA_SALE") salidasGuarderia.set(e.visitKey, e);
  }

  const pets = (tipo: AgendaTipo) =>
    events.filter((e) => e.tipo === tipo).reduce((n, e) => n + e.petNames.length, 0);
  const conteo: [AgendaTipo, (n: number) => string][] = [
    ["LLEGA", (n) => (n === 1 ? "1 llega" : `${n} llegan`)],
    ["SALE", (n) => (n === 1 ? "1 se va" : `${n} se van`)],
    ["BANO", (n) => (n === 1 ? "1 baño" : `${n} baños`)],
    ["GUARDERIA_ENTRA", (n) => `${n} en guardería`],
  ];
  const resumen = conteo
    .map(([tipo, txt]) => [pets(tipo), txt] as const)
    .filter(([n]) => n > 0)
    .map(([n, txt]) => txt(n));
  // Solo salidas de guardería (la entrada no se encontró): igual cuenta.
  if (resumen.length === 0) resumen.push(`${pets("GUARDERIA_SALE")} en guardería`);

  const ETIQUETA: Record<string, string> = {
    LLEGA: "🏨 Llegan",
    SALE: "👋 Se van",
    BANO: "🛁 Baños",
    GUARDERIA_ENTRA: "🐾 Guardería",
  };

  const lineas: string[] = [];
  for (const tipo of ORDEN_SECCION) {
    const delTipo = events.filter((e) => e.tipo === tipo).sort(porHora);
    if (delTipo.length === 0) continue;
    const items = delTipo.map((e) => {
      if (tipo !== "GUARDERIA_ENTRA") return renglon(e, e.at ? hora(e.at) : null);
      const sale = salidasGuarderia.get(e.visitKey);
      const rango =
        e.at && sale?.at ? `${hora(e.at)}–${hora(sale.at)}` : e.at ? `desde ${hora(e.at)}` : null;
      // La guardería puede tener entrega en la salida: se junta en el renglón.
      const dom =
        e.domicilio && sale?.domicilio
          ? "RECOGER_Y_ENTREGAR"
          : (e.domicilio ?? sale?.domicilio ?? null);
      return renglon({ ...e, domicilio: dom }, rango);
    });
    lineas.push(`${ETIQUETA[tipo]}: ${items.join(", ")}`);
  }
  // Salidas de guardería sin su entrada (raro: datos a medias).
  const huerfanas = [...salidasGuarderia.values()].filter(
    (s) => !events.some((e) => e.tipo === "GUARDERIA_ENTRA" && e.visitKey === s.visitKey)
  );
  if (huerfanas.length > 0) {
    lineas.push(
      `🐾 Guardería: ${huerfanas
        .sort(porHora)
        .map((e) => renglon(e, e.at ? `sale ${hora(e.at)}` : null))
        .join(", ")}`
    );
  }

  return { title: `📋 Mañana: ${resumen.join(" · ")}`, body: lineas.join("\n") };
}

/** Aviso de ~30 min antes de UN evento con hora. */
export function buildSoonMessage(
  e: AgendaEvent & { at: Date },
  now: Date
): { title: string; body: string } {
  const quien = unirNombres(e.petNames);
  const h = hora(e.at);
  const titulos: Record<AgendaTipo, string> = {
    LLEGA: `⏰ Check-in de ${quien} · ${h}`,
    SALE: `⏰ Check-out de ${quien} · ${h}`,
    BANO: `⏰ Baño de ${quien} · ${h}`,
    GUARDERIA_ENTRA: `⏰ Guardería: llega ${quien} · ${h}`,
    GUARDERIA_SALE: `⏰ Guardería: se va ${quien} · ${h}`,
  };
  const min = Math.max(1, Math.round((e.at.getTime() - now.getTime()) / 60_000));
  const verbo: Record<AgendaTipo, string> = {
    LLEGA: "Llega",
    SALE: "Se va",
    BANO: "Su baño empieza",
    GUARDERIA_ENTRA: "Llega",
    GUARDERIA_SALE: "Se va",
  };
  const partes = [`${verbo[e.tipo]} en ${min} min.`];
  if (e.tipo === "SALE" || e.tipo === "GUARDERIA_SALE") partes.push("Que esté listo con sus cosas.");
  if (e.hospedado) partes.push("Está hospedado.");
  if (e.domicilio) partes.push(DOMICILIO_LARGO[e.domicilio]);
  return { title: titulos[e.tipo], body: partes.join(" ") };
}

/** Clave de deduplicación del aviso de 30 min. Lleva la hora: si se mueve, se vuelve a avisar. */
export function soonKey(e: AgendaEvent & { at: Date }): string {
  return `${e.visitKey}:${e.tipo}:${e.at.toISOString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Lectura de la base
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:mm" del hotel sobre el día (YYYY-MM-DD). `null` sin hora o mal formada. */
function enHoraDelHotel(dayYMD: string, hhmm: string | null): Date | null {
  if (!hhmm) return null;
  const [hh, mm] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return ymdAtLocalMinutes(dayYMD, hh * 60 + mm);
}

/** El día guardado (00:00Z o mediodía UTC) se lee con componentes UTC. */
const diaUtc = (d: Date) => d.toISOString().slice(0, 10);

type StayRow = {
  id: string;
  groupId: string | null;
  reservationType: string;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  appointmentAt: Date | null;
  homeDelivery: boolean;
  homeDeliveryTrip: DeliveryTrip;
  pet: { name: string } | null;
};

/** Agrupa por visita y devuelve un evento por grupo. */
function eventosPorVisita(
  rows: StayRow[],
  tipo: AgendaTipo,
  instante: (r: StayRow) => Date | null
): AgendaEvent[] {
  const grupos = new Map<string, StayRow[]>();
  for (const r of rows) {
    // Un baño suelto multi-perro puede tener horas distintas: la hora entra en
    // la llave para que cada cita salga por separado.
    const at = instante(r);
    const key = `${r.groupId ?? r.id}${tipo === "BANO" ? `@${at?.toISOString() ?? "-"}` : ""}`;
    const arr = grupos.get(key) ?? [];
    arr.push(r);
    grupos.set(key, arr);
  }
  return [...grupos.entries()].map(([visitKey, g]) => {
    const first = g[0];
    // En multireserva el domicilio se guarda en UNA fila del grupo.
    const conDomicilio = g.find((r) => r.homeDelivery);
    return {
      tipo,
      petNames: g.map((r) => r.pet?.name ?? "Sin nombre"),
      at: instante(first),
      domicilio: domicilioDe(tipo, conDomicilio ? conDomicilio.homeDeliveryTrip : null),
      reservationId: first.id,
      reservationType: first.reservationType as AgendaEvent["reservationType"],
      visitKey,
    };
  });
}

const SELECT = {
  id: true,
  groupId: true,
  reservationType: true,
  checkIn: true,
  checkOut: true,
  checkInTime: true,
  checkOutTime: true,
  appointmentAt: true,
  homeDelivery: true,
  homeDeliveryTrip: true,
  pet: { select: { name: true } },
} as const;

const NO_CERRADA = { notIn: ["CANCELLED", "CHECKED_OUT"] as ("CANCELLED" | "CHECKED_OUT")[] };

/**
 * Todos los eventos de un rango.
 *
 * `dayRange` es el rango de DÍAS guardados ([00:00Z, 00:00Z)) para hospedaje y
 * guardería; `instantRange` el de instantes reales para baños. Para «mañana»
 * son el mismo día calendario del hotel expresado de las dos formas.
 */
export async function loadAgendaEvents(
  prisma: PrismaClient,
  dayRange: { start: Date; end: Date },
  instantRange: { start: Date; end: Date }
): Promise<AgendaEvent[]> {
  const [llegadas, salidas, guarderias, banos, banosHospedados] = await Promise.all([
    prisma.reservation.findMany({
      where: { reservationType: "STAY", status: "CONFIRMED", checkIn: { gte: dayRange.start, lt: dayRange.end } },
      select: SELECT,
    }),
    prisma.reservation.findMany({
      where: { reservationType: "STAY", status: NO_CERRADA, checkOut: { gte: dayRange.start, lt: dayRange.end } },
      select: SELECT,
    }),
    prisma.reservation.findMany({
      where: { reservationType: "DAYCARE", status: NO_CERRADA, appointmentAt: { gte: dayRange.start, lt: dayRange.end } },
      select: SELECT,
    }),
    prisma.reservation.findMany({
      where: { reservationType: "BATH", status: NO_CERRADA, appointmentAt: { gte: instantRange.start, lt: instantRange.end } },
      select: SELECT,
    }),
    prisma.reservationAddon.findMany({
      where: {
        completedAt: null,
        scheduledAt: { gte: instantRange.start, lt: instantRange.end },
        variant: { serviceType: { code: "BATH" } },
        reservation: { status: NO_CERRADA },
      },
      select: {
        scheduledAt: true,
        reservation: { select: { id: true, groupId: true, pet: { select: { name: true } } } },
      },
    }),
  ]);

  const llegadaAt = (r: StayRow) => (r.checkIn ? enHoraDelHotel(diaUtc(r.checkIn), r.checkInTime) : null);
  const salidaAt = (r: StayRow) => (r.checkOut ? enHoraDelHotel(diaUtc(r.checkOut), r.checkOutTime) : null);
  const guardEntra = (r: StayRow) =>
    r.appointmentAt ? enHoraDelHotel(diaUtc(r.appointmentAt), r.checkInTime) : null;
  const guardSale = (r: StayRow) =>
    r.appointmentAt ? enHoraDelHotel(diaUtc(r.appointmentAt), r.checkOutTime) : null;

  return [
    ...eventosPorVisita(llegadas, "LLEGA", llegadaAt),
    ...eventosPorVisita(salidas, "SALE", salidaAt),
    ...eventosPorVisita(guarderias, "GUARDERIA_ENTRA", guardEntra),
    ...eventosPorVisita(guarderias, "GUARDERIA_SALE", guardSale),
    ...eventosPorVisita(banos, "BANO", (r) => r.appointmentAt),
    ...banosHospedados
      .filter((a) => a.scheduledAt)
      .map(
        (a): AgendaEvent => ({
          tipo: "BANO",
          petNames: [a.reservation.pet?.name ?? "Sin nombre"],
          at: a.scheduledAt,
          domicilio: null,
          hospedado: true,
          reservationId: a.reservation.id,
          reservationType: "STAY",
          visitKey: `addon:${a.reservation.id}@${a.scheduledAt!.toISOString()}`,
        })
      ),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Envíos
// ─────────────────────────────────────────────────────────────────────────────

/** Ventana del resumen en hora del hotel (6 pm, con respaldo hasta las 9 pm). */
const SUMMARY_FROM_HOUR = 18;
const SUMMARY_UNTIL_HOUR = 21;
const SUMMARY_KIND = "TEAM_AGENDA_TOMORROW";
const SOON_KIND = "TEAM_AGENDA_SOON";
/** Con el ciclo cada 10 min, el aviso sale entre ~35 y ~25 min antes. */
const SOON_WINDOW_MIN = 35;

/** Mañana en las dos escalas: días guardados e instantes reales. */
export function rangosDeManana(now: Date): {
  dayRange: { start: Date; end: Date };
  instantRange: { start: Date; end: Date };
  day: string;
} {
  const dayRange = rangoDeMananaHotel(now);
  const day = diaUtc(dayRange.start);
  return {
    dayRange,
    instantRange: dayRangeUtc(day),
    day,
  };
}

/** Resumen de mañana al equipo, una vez al día desde las 6 pm. */
export async function sendTeamTomorrowSummary(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<{ sent: number }> {
  const h = Math.floor(localMinutesOfDay(now) / 60);
  if (h < SUMMARY_FROM_HOUR || h >= SUMMARY_UNTIL_HOUR) return { sent: 0 };

  const { dayRange, instantRange, day } = rangosDeManana(now);
  const ya = await prisma.notification.findFirst({
    where: {
      type: "RESERVATION_REMINDER",
      AND: [
        { data: { path: ["kind"], equals: SUMMARY_KIND } },
        { data: { path: ["day"], equals: day } },
      ],
    },
    select: { id: true },
  });
  if (ya) return { sent: 0 };

  const msg = buildTomorrowSummary(await loadAgendaEvents(prisma, dayRange, instantRange));
  if (!msg) return { sent: 0 };
  const equipo = await equipoActivoIds(prisma);
  if (equipo.length === 0) return { sent: 0 };

  await notifyUsers(prisma, equipo, {
    type: "RESERVATION_REMINDER",
    ...msg,
    data: { kind: SUMMARY_KIND, day },
  });
  return { sent: equipo.length };
}

/** Aviso ~30 min antes de cada evento con hora. */
export async function sendTeamSoonReminders(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<{ sent: number }> {
  const hasta = new Date(now.getTime() + SOON_WINDOW_MIN * 60_000);
  // Días guardados que pueden caer en la ventana: hoy y mañana (en UTC).
  const hoy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayRange = { start: new Date(hoy.getTime() - 86_400_000), end: new Date(hoy.getTime() + 2 * 86_400_000) };
  const events = (await loadAgendaEvents(prisma, dayRange, { start: now, end: hasta })).filter(
    (e): e is AgendaEvent & { at: Date } => e.at !== null && e.at > now && e.at <= hasta
  );
  if (events.length === 0) return { sent: 0 };

  let equipo: string[] | null = null;
  let sent = 0;
  for (const e of events) {
    const key = soonKey(e);
    const ya = await prisma.notification.findFirst({
      where: {
        type: "RESERVATION_REMINDER",
        AND: [
          { data: { path: ["kind"], equals: SOON_KIND } },
          { data: { path: ["key"], equals: key } },
        ],
      },
      select: { id: true },
    });
    if (ya) continue;
    equipo ??= await equipoActivoIds(prisma);
    if (equipo.length === 0) return { sent };
    await notifyUsers(prisma, equipo, {
      type: "RESERVATION_REMINDER",
      ...buildSoonMessage(e, now),
      data: {
        kind: SOON_KIND,
        key,
        reservationId: e.reservationId,
        reservationType: e.reservationType,
      },
      priority: "high",
    });
    sent += equipo.length;
  }
  return { sent };
}
