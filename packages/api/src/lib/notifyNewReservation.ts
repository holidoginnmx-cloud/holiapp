/**
 * Aviso al EQUIPO (admins + staff) de que entró una reservación nueva.
 *
 * Antes cada camino de creación resolvía su propia audiencia con un `findMany`
 * copiado, y los filtros se desincronizaron: el hospedaje avisaba solo a STAFF,
 * la guardería a STAFF+ADMIN y los baños solo a ADMIN. Como el equipo del hotel
 * son ADMIN, las reservas de hospedaje que entraban por la app o el sitio no le
 * llegaban a nadie — el caso que se detectó con una llegada del mismo día de la
 * que solo nos enteramos porque la clienta llamó.
 *
 * Ahora los cinco caminos pasan por aquí. Para agregar uno nuevo basta llamar a
 * `notifyNewReservation`; la audiencia y el formato viven en un solo lugar.
 */
import type { PrismaClient } from "@holidoginn/db";
import { notifyUsers } from "./notify";
import { TZ_HOTEL, localYMD } from "./bathAvailability";

/** De dónde vino la reserva. Viaja en el `data` del push para diagnóstico. */
export type NewReservationSource = "APP_CLIENTE" | "APP_ADMIN" | "SITIO_WEB";

/**
 * Forma mínima de una reserva recién creada. Es un subconjunto de lo que
 * devuelven los tres `include` distintos que hay en los call sites, para que
 * cualquiera de ellos encaje sin castear.
 */
export type NewReservationRow = {
  id: string;
  reservationType: string;
  checkIn?: Date | null;
  checkOut?: Date | null;
  appointmentAt?: Date | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  totalDays?: number | null;
  pet?: { name: string } | null;
  room?: { name: string } | null;
};

export type NotifyNewReservationParams = {
  /** El GRUPO completo (una fila por mascota) → una sola notificación. */
  reservations: NewReservationRow[];
  owner: { firstName?: string | null; lastName?: string | null };
  source: NewReservationSource;
  /**
   * Quién la creó. Si es del equipo se le excluye: acaba de verla en pantalla,
   * no necesita el push. Los DEMÁS del equipo sí se enteran, que es justo lo
   * útil cuando alguien captura una reserva que entró por teléfono.
   */
  createdByUserId?: string | null;
  /** Solo BATH: "Baño", "Baño + Corte"… para el cuerpo del mensaje. */
  bathLabel?: string | null;
  /** Solo BATH: precio de la cita. */
  price?: number | null;
  /** Inyectable para tests. */
  now?: Date;
};

const MS_PER_DAY = 86_400_000;

/**
 * "YYYY-MM-DD" leyendo los componentes UTC tal cual.
 *
 * `checkIn`/`checkOut` NO son instantes: guardan el DÍA a las 00:00 UTC (ver el
 * comentario del modelo en schema.prisma). Pasarlos por `localYMD` les restaría
 * 7 h y los correría al día anterior — el "¡Llegada HOY!" saldría un día tarde.
 * El `appointmentAt` de DAYCARE está anclado a mediodía UTC y también cae aquí.
 */
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "21 Ago" del día guardado en UTC (hospedaje y guardería). */
function utcDayLabel(d: Date): string {
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "21 Ago 11:30" en hora del hotel (citas de baño, que sí son instantes). */
function hotelDateTimeLabel(d: Date): string {
  return d.toLocaleString("es-MX", {
    timeZone: TZ_HOTEL,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "11:30" en hora del hotel. */
function hotelTimeLabel(d: Date): string {
  return d.toLocaleTimeString("es-MX", {
    timeZone: TZ_HOTEL,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ownerFullName(owner: {
  firstName?: string | null;
  lastName?: string | null;
}): string {
  return [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
}

export type NewReservationMessage = {
  title: string;
  body: string;
  /** El check-in cae hoy o mañana: el equipo tiene que reaccionar YA. */
  urgent: boolean;
  /** "HOY" | "MAÑANA" | null — para el cuerpo del mensaje. */
  relDay: "HOY" | "MAÑANA" | null;
};

/**
 * Arma título y cuerpo. Pura y exportada aparte: es la única parte con lógica
 * real (fechas y urgencia) y es lo que cubren los tests.
 */
export function buildNewReservationMessage(params: {
  reservations: NewReservationRow[];
  owner: { firstName?: string | null; lastName?: string | null };
  bathLabel?: string | null;
  price?: number | null;
  now?: Date;
}): NewReservationMessage {
  const { reservations, owner, bathLabel, price } = params;
  const now = params.now ?? new Date();
  const first = reservations[0];
  const type = first?.reservationType ?? "STAY";

  const petNames =
    reservations
      .map((r) => r.pet?.name)
      .filter((n): n is string => Boolean(n))
      .join(", ") || "Una mascota";

  // Cuarto: solo si todo el grupo comparte el mismo (con `roomIds` por mascota
  // un grupo puede quedar repartido, y ahí el dato no aporta).
  const roomNames = [
    ...new Set(reservations.map((r) => r.room?.name).filter(Boolean)),
  ];
  const roomName = roomNames.length === 1 ? (roomNames[0] as string) : null;

  const clientName = ownerFullName(owner);

  // ── Urgencia: por DÍA de calendario, no por milisegundos ──────────────────
  // En hospedaje `checkInTime` es opcional, así que una ventana de 48 h en ms
  // sobre una fecha a medianoche daría falsos positivos y negativos. El día
  // calendario es lo que el equipo realmente opera.
  //
  // Cada tipo se compara contra el "hoy" que le corresponde: hospedaje y
  // guardería viven en días UTC; las citas de baño, en días del hotel.
  const isBath = type === "BATH";
  const todayKey = isBath ? localYMD(now) : utcDayKey(now);
  const tomorrowKey = isBath
    ? localYMD(new Date(now.getTime() + MS_PER_DAY))
    : utcDayKey(new Date(now.getTime() + MS_PER_DAY));

  const eventDate =
    type === "STAY" ? (first?.checkIn ?? null) : (first?.appointmentAt ?? null);
  const eventKey = eventDate
    ? isBath
      ? localYMD(eventDate)
      : utcDayKey(eventDate)
    : null;

  const relDay: "HOY" | "MAÑANA" | null =
    eventKey === todayKey ? "HOY" : eventKey === tomorrowKey ? "MAÑANA" : null;
  const urgent = relDay !== null;

  // Sufijo con el nombre del cliente: solo en la variante urgente, donde el
  // equipo necesita poder ubicar y llamar a la persona sin abrir la app.
  const clientSuffix = urgent && clientName ? ` — ${clientName}` : "";

  if (type === "BATH") {
    const when = eventDate
      ? urgent
        ? `${relDay} ${hotelTimeLabel(eventDate)}`
        : hotelDateTimeLabel(eventDate)
      : "sin fecha";
    const servicio = bathLabel ? `${bathLabel} · ` : "";
    const costo = price != null ? ` · $${price.toLocaleString("es-MX")}` : "";
    return {
      title: urgent ? `🚨 ¡Baño ${relDay}! Nueva cita` : "🐾 Nueva cita de baño",
      body: `${petNames} — ${servicio}${when}${urgent ? "" : costo}${clientSuffix}`,
      urgent,
      relDay,
    };
  }

  if (type === "DAYCARE") {
    const inTime = first?.checkInTime ?? null;
    const outTime = first?.checkOutTime ?? null;
    const horario = inTime && outTime ? `${inTime}–${outTime}` : "horario por confirmar";
    const when = eventDate
      ? urgent
        ? `${relDay} ${horario}`
        : `${utcDayLabel(eventDate)} · ${horario}`
      : horario;
    return {
      title: urgent
        ? `🚨 ¡Guardería ${relDay}! Nueva reserva`
        : "🐾 Nueva guardería",
      body: `${petNames} — ${when}${clientSuffix}`,
      urgent,
      relDay,
    };
  }

  // ── STAY ──────────────────────────────────────────────────────────────────
  const noches = first?.totalDays ?? null;
  const nochesLabel =
    noches != null ? ` (${noches} ${noches === 1 ? "noche" : "noches"})` : "";
  const fecha = eventDate ? utcDayLabel(eventDate) : "sin fecha";
  const entrada = urgent ? `Entra ${relDay} ${fecha}` : `Entra ${fecha}${nochesLabel}`;
  const cuarto = urgent && roomName ? ` · ${roomName}` : "";
  return {
    title: urgent
      ? `🚨 ¡Llegada ${relDay}! Nueva reservación`
      : "🐾 Nueva reservación",
    body: `${petNames} — ${entrada}${cuarto}${clientSuffix}`,
    urgent,
    relDay,
  };
}

/**
 * Avisa a todo el equipo activo. Nunca lanza: el push es best-effort y jamás
 * debe tumbar la creación de una reserva que ya se cobró.
 */
export async function notifyNewReservation(
  prisma: PrismaClient,
  params: NotifyNewReservationParams
): Promise<void> {
  try {
    const { reservations, source, createdByUserId } = params;
    const first = reservations[0];
    if (!first) return;

    const team = await prisma.user.findMany({
      where: { role: { in: ["STAFF", "ADMIN"] }, isActive: true },
      select: { id: true },
    });
    const targets = team
      .map((u) => u.id)
      .filter((id) => id !== createdByUserId);
    if (targets.length === 0) return;

    const msg = buildNewReservationMessage(params);

    const pushed = await notifyUsers(prisma, targets, {
      type: "NEW_RESERVATION",
      title: msg.title,
      body: msg.body,
      data: {
        reservationId: first.id,
        reservationType: first.reservationType,
        kind: "NEW_RESERVATION",
        urgent: msg.urgent,
        source,
      },
      priority: msg.urgent ? "high" : "default",
    });

    // Railway solo guarda logs: sin esta línea no hay forma de saber si un
    // aviso salió y a cuántos llegó de verdad.
    console.info("[notifyNewReservation]", {
      reservationId: first.id,
      type: first.reservationType,
      urgent: msg.urgent,
      source,
      targets: targets.length,
      pushed,
    });
  } catch (err) {
    console.error("[notifyNewReservation] falló:", err);
  }
}
