import { describe, expect, it, vi } from "vitest";
import {
  stayOverlapWhere,
  countRoomOccupancy,
  roomsWithOccupancy,
} from "./roomOccupancy";

const d = (iso: string) => new Date(iso);

/** Reservaciones fake: el mock filtra con el mismo criterio que Prisma. */
type Fila = {
  id: string;
  roomId: string | null;
  reservationType: string;
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
};

/**
 * Prisma falso que APLICA el where de stayOverlapWhere sobre `filas`. No prueba
 * a Prisma: prueba que el predicado que arma el helper selecciona exactamente
 * las estancias que el 409 del servidor considera ocupadas.
 */
const fakePrisma = (filas: Fila[], cuartos: Array<Record<string, unknown>> = []) =>
  ({
    reservation: {
      groupBy: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        const [ci, co] = where.AND as [
          { checkIn: { lt: Date } },
          { checkOut: { gt: Date } },
        ];
        const excluidos: string[] = where.id?.notIn ?? [];
        const vivas = filas.filter(
          (f) =>
            f.reservationType === where.reservationType &&
            !(where.status.notIn as string[]).includes(f.status) &&
            !excluidos.includes(f.id) &&
            f.roomId !== null &&
            f.checkIn !== null &&
            f.checkOut !== null &&
            f.checkIn < ci.checkIn.lt &&
            f.checkOut > co.checkOut.gt
        );
        const porCuarto = new Map<string, number>();
        for (const f of vivas) {
          porCuarto.set(f.roomId!, (porCuarto.get(f.roomId!) ?? 0) + 1);
        }
        return [...porCuarto].map(([roomId, n]) => ({
          roomId,
          _count: { _all: n },
        }));
      }),
    },
    room: { findMany: vi.fn(async () => cuartos) },
  }) as any;

const estancia = (over: Partial<Fila> = {}): Fila => ({
  id: "res_1",
  roomId: "room_1",
  reservationType: "STAY",
  status: "CONFIRMED",
  checkIn: d("2026-09-10T07:00:00.000Z"),
  checkOut: d("2026-09-14T07:00:00.000Z"),
  ...over,
});

const RANGO = {
  checkIn: d("2026-09-12T07:00:00.000Z"),
  checkOut: d("2026-09-15T07:00:00.000Z"),
};

describe("stayOverlapWhere", () => {
  it("solo mira estancias vivas", () => {
    const where = stayOverlapWhere(RANGO);
    expect(where.reservationType).toBe("STAY");
    expect(where.status).toEqual({ notIn: ["CANCELLED", "CHECKED_OUT"] });
    expect(where.id).toBeUndefined();
  });

  it("excluye las reservaciones indicadas (reasignar no se cuenta a sí misma)", () => {
    const where = stayOverlapWhere({ ...RANGO, excludeReservationIds: ["res_9"] });
    expect(where.id).toEqual({ notIn: ["res_9"] });
  });

  it("una lista de exclusión vacía no agrega el filtro", () => {
    expect(stayOverlapWhere({ ...RANGO, excludeReservationIds: [] }).id).toBeUndefined();
  });
});

describe("countRoomOccupancy", () => {
  it("cuenta una fila por perro, aunque compartan cuarto", async () => {
    const prisma = fakePrisma([
      estancia({ id: "a", roomId: "room_1" }),
      estancia({ id: "b", roomId: "room_1" }),
      estancia({ id: "c", roomId: "room_2" }),
    ]);
    const mapa = await countRoomOccupancy(prisma, RANGO);
    expect(mapa.get("room_1")).toBe(2);
    expect(mapa.get("room_2")).toBe(1);
  });

  it("ignora canceladas y con check-out hecho", async () => {
    const prisma = fakePrisma([
      estancia({ id: "a", status: "CANCELLED" }),
      estancia({ id: "b", status: "CHECKED_OUT" }),
      estancia({ id: "c", status: "CHECKED_IN" }),
    ]);
    const mapa = await countRoomOccupancy(prisma, RANGO);
    expect(mapa.get("room_1")).toBe(1);
  });

  it("ignora baños y guarderías", async () => {
    const prisma = fakePrisma([
      estancia({ id: "a", reservationType: "BATH" }),
      estancia({ id: "b", reservationType: "DAYCARE" }),
    ]);
    expect((await countRoomOccupancy(prisma, RANGO)).size).toBe(0);
  });

  it("ignora reservaciones sin cuarto (la FK es ON DELETE SET NULL)", async () => {
    const prisma = fakePrisma([estancia({ id: "a", roomId: null })]);
    expect((await countRoomOccupancy(prisma, RANGO)).size).toBe(0);
  });

  it("no cuenta la estancia excluida", async () => {
    const prisma = fakePrisma([
      estancia({ id: "res_esta" }),
      estancia({ id: "otra" }),
    ]);
    const mapa = await countRoomOccupancy(prisma, {
      ...RANGO,
      excludeReservationIds: ["res_esta"],
    });
    expect(mapa.get("room_1")).toBe(1);
  });

  // El caso que fija el contrato: el día de salida libera el cuarto. Si esto
  // cambia, cambia también lo que el servidor acepta al crear — es un cambio
  // deliberado, no un ajuste de UI.
  it("borde a borde NO ocupa: la que sale el día que la nueva entra", async () => {
    const prisma = fakePrisma([
      estancia({
        checkIn: d("2026-09-08T07:00:00.000Z"),
        checkOut: d("2026-09-12T07:00:00.000Z"), // exactamente el checkIn del rango
      }),
    ]);
    expect((await countRoomOccupancy(prisma, RANGO)).size).toBe(0);
  });

  it("y la que entra el día que la nueva sale tampoco", async () => {
    const prisma = fakePrisma([
      estancia({
        checkIn: d("2026-09-15T07:00:00.000Z"), // exactamente el checkOut del rango
        checkOut: d("2026-09-18T07:00:00.000Z"),
      }),
    ]);
    expect((await countRoomOccupancy(prisma, RANGO)).size).toBe(0);
  });

  it("un solo día de traslape sí ocupa", async () => {
    const prisma = fakePrisma([
      estancia({
        checkIn: d("2026-09-08T07:00:00.000Z"),
        checkOut: d("2026-09-13T07:00:00.000Z"),
      }),
    ]);
    expect((await countRoomOccupancy(prisma, RANGO)).get("room_1")).toBe(1);
  });
});

describe("roomsWithOccupancy", () => {
  const cuartos = [
    { id: "room_1", name: "Cuarto 01", capacity: 4, isActive: true },
    { id: "room_2", name: "Cuarto 09", capacity: 2, isActive: true },
    { id: "room_3", name: "Cuarto 12", capacity: 1, isActive: true },
  ];

  it("devuelve TODOS los cuartos, llenos incluidos, con occupied y remaining", async () => {
    const prisma = fakePrisma(
      [
        estancia({ id: "a", roomId: "room_1" }),
        estancia({ id: "b", roomId: "room_1" }),
        estancia({ id: "c", roomId: "room_3" }),
      ],
      cuartos
    );
    const res = await roomsWithOccupancy(prisma, RANGO);
    expect(res.map((r) => r.id)).toEqual(["room_1", "room_2", "room_3"]);
    expect(res[0]).toMatchObject({ occupied: 2, remaining: 2 });
    expect(res[1]).toMatchObject({ occupied: 0, remaining: 2 });
    expect(res[2]).toMatchObject({ occupied: 1, remaining: 0 }); // lleno, pero ahí está
  });

  it("remaining negativo si alguien sobrevendió: se informa, no se revienta", async () => {
    const prisma = fakePrisma(
      [
        estancia({ id: "a", roomId: "room_3" }),
        estancia({ id: "b", roomId: "room_3" }),
      ],
      cuartos
    );
    const res = await roomsWithOccupancy(prisma, RANGO);
    expect(res.find((r) => r.id === "room_3")).toMatchObject({
      occupied: 2,
      remaining: -1,
    });
  });
});
