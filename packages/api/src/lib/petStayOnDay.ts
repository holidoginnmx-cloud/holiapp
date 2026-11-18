import type { PrismaClient } from "@holidoginn/db";

/**
 * ¿El perro está hospedado ese día?
 *
 * Origen (2026-11-18, Jessica): la co-dueña de Koa agendó y PAGÓ un baño suelto
 * mientras Koa estaba hospedado, cuando su estancia ya traía baño. Lo canceló y
 * el hotel se comió la comisión de Stripe. Un perro hospedado se baña DENTRO de
 * su estancia (addon BATH), no con una cita suelta.
 *
 * Se busca SOLO por `petId`, nunca por `ownerId`: la estancia puede estar a
 * nombre del otro co-dueño (regla del pagador).
 *
 * Fechas: `checkIn`/`checkOut` representan DÍAS calendario guardados a las
 * 00:00Z (ver `stayDayAnchor` en shared/pricing). Filas viejas pueden venir
 * corridas unas horas (07:00Z del wizard del equipo), así que el predicado
 * compara contra el día COMPLETO en UTC — [D 00:00Z, D+1 00:00Z) — y funciona
 * con ambas. Cuentan el día de entrada y el de salida: el baño de ese día es
 * el baño de la estancia.
 */

/** Estados en que el perro está (o va a estar) en el hotel. */
export const ACTIVE_STAY_STATUSES = ["CONFIRMED", "CHECKED_IN"] as const;

const DAY_MS = 86_400_000;

/** [00:00Z del día, 00:00Z del día siguiente) para un "YYYY-MM-DD". */
export function stayDayWindow(dateYMD: string): { dayStart: Date; dayEnd: Date } {
  const [y, m, d] = dateYMD.split("-").map(Number);
  const dayStart = new Date(Date.UTC(y, m - 1, d));
  return { dayStart, dayEnd: new Date(dayStart.getTime() + DAY_MS) };
}

/** Predicado puro (lo mismo que el `where` de Prisma), para los tests. */
export function stayCoversDay(
  stay: { checkIn: Date | null; checkOut: Date | null; status: string },
  dateYMD: string,
): boolean {
  if (!stay.checkIn || !stay.checkOut) return false;
  if (!(ACTIVE_STAY_STATUSES as readonly string[]).includes(stay.status)) return false;
  const { dayStart, dayEnd } = stayDayWindow(dateYMD);
  return stay.checkIn.getTime() < dayEnd.getTime() && stay.checkOut.getTime() >= dayStart.getTime();
}

export function bathAddonLabel(variant: { deslanado: boolean; corte: boolean }): string {
  const extras = [variant.corte && "Corte", variant.deslanado && "Deslanado"].filter(Boolean);
  return extras.length ? `Baño · ${extras.join(" · ")}` : "Baño";
}

export type PetStayOnDay = {
  petId: string;
  petName: string;
  reservationId: string;
  status: string;
  /** ISO, 00:00Z del día calendario. */
  checkIn: string;
  checkOut: string;
  roomName: string | null;
  /** El baño que la estancia YA trae, si lo trae. */
  bath: { label: string; scheduledAt: string | null } | null;
};

export async function findPetStayOnDay(
  prisma: PrismaClient,
  petId: string,
  dateYMD: string,
): Promise<PetStayOnDay | null> {
  const { dayStart, dayEnd } = stayDayWindow(dateYMD);
  const stay = await prisma.reservation.findFirst({
    where: {
      petId,
      reservationType: "STAY",
      status: { in: [...ACTIVE_STAY_STATUSES] },
      checkIn: { lt: dayEnd },
      checkOut: { gte: dayStart },
    },
    orderBy: { checkIn: "asc" },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      pet: { select: { name: true } },
      room: { select: { name: true } },
      addons: {
        where: { variant: { serviceType: { code: "BATH" } } },
        select: {
          scheduledAt: true,
          variant: { select: { deslanado: true, corte: true } },
        },
        take: 1,
      },
    },
  });
  if (!stay || !stay.checkIn || !stay.checkOut) return null;
  const bath = stay.addons[0];
  return {
    petId,
    petName: stay.pet?.name ?? "",
    reservationId: stay.id,
    status: stay.status,
    checkIn: stay.checkIn.toISOString(),
    checkOut: stay.checkOut.toISOString(),
    roomName: stay.room?.name ?? null,
    bath: bath
      ? {
          label: bathAddonLabel(bath.variant),
          scheduledAt: bath.scheduledAt ? bath.scheduledAt.toISOString() : null,
        }
      : null,
  };
}

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
};

/**
 * Texto que se entiende SOLO: las apps viejas y el sitio solo pintan `error`.
 */
export function petHasStayMessage(stay: PetStayOnDay): string {
  const who = stay.petName || "Tu perrito";
  const range = `del ${fmtDay(stay.checkIn)} al ${fmtDay(stay.checkOut)}`;
  return stay.bath
    ? `${who} está hospedado ${range} y su estancia ya incluye baño. Si quieres otro, escríbenos y lo agregamos a su estancia.`
    : `${who} está hospedado ${range}. El baño se agrega desde su estancia, no como cita aparte.`;
}
