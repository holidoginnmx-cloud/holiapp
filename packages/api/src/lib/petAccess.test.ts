import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canAccessPet,
  canAccessReservation,
  petAudienceIds,
  invalidatePetAccessCache,
  sharedPetIds,
} from "./petAccess";

// Lo que se protege aquí: que compartir un perro AMPLÍE el acceso sin abrirlo
// de más, y que el dueño de siempre no pague un query extra por la feature.

type Row = { petId: string; userId: string };

function fakePrisma(rows: Row[], pets: Record<string, string> = {}) {
  const count = vi.fn(async ({ where }: any) =>
    rows.filter((r) => r.petId === where.petId && r.userId === where.userId).length
  );
  const findMany = vi.fn(async ({ where }: any) =>
    rows.filter((r) =>
      where.userId ? r.userId === where.userId : r.petId === where.petId
    )
  );
  return {
    petCoOwner: { count, findMany },
    pet: {
      findUnique: vi.fn(async ({ where }: any) =>
        pets[where.id] ? { ownerId: pets[where.id] } : null
      ),
      count: vi.fn(async ({ where }: any) =>
        pets[where.id] === where.ownerId ? 1 : 0
      ),
    },
  } as any;
}

const jesus = { userId: "u_jesus", userRole: "OWNER" };
const andrea = { userId: "u_andrea", userRole: "OWNER" };
const nala = { id: "p_nala", ownerId: "u_jesus" };

beforeEach(() => invalidatePetAccessCache());

describe("canAccessPet", () => {
  it("deja pasar al dueño sin consultar la tabla de co-dueños", async () => {
    const prisma = fakePrisma([]);
    expect(await canAccessPet(prisma, nala, jesus)).toBe(true);
    expect(prisma.petCoOwner.count).not.toHaveBeenCalled();
  });

  it("deja pasar al equipo sin consultar nada", async () => {
    const prisma = fakePrisma([]);
    expect(
      await canAccessPet(prisma, nala, { userId: "u_staff", userRole: "STAFF" })
    ).toBe(true);
    expect(prisma.petCoOwner.count).not.toHaveBeenCalled();
  });

  it("deja pasar al co-dueño", async () => {
    const prisma = fakePrisma([{ petId: "p_nala", userId: "u_andrea" }]);
    expect(await canAccessPet(prisma, nala, andrea)).toBe(true);
  });

  it("bloquea a un tercero", async () => {
    const prisma = fakePrisma([{ petId: "p_nala", userId: "u_andrea" }]);
    expect(
      await canAccessPet(prisma, nala, { userId: "u_otro", userRole: "OWNER" })
    ).toBe(false);
  });

  it("bloquea a quien no trae sesión", async () => {
    const prisma = fakePrisma([]);
    expect(await canAccessPet(prisma, nala, { userRole: "OWNER" })).toBe(false);
  });

  it("no confunde la co-propiedad de OTRA mascota", async () => {
    const prisma = fakePrisma([{ petId: "p_otro", userId: "u_andrea" }]);
    expect(await canAccessPet(prisma, nala, andrea)).toBe(false);
  });
});

describe("canAccessReservation", () => {
  const reserva = { ownerId: "u_jesus", petId: "p_nala" };

  it("deja ver al co-dueño la reserva que hizo el otro", async () => {
    const prisma = fakePrisma([{ petId: "p_nala", userId: "u_andrea" }], {
      p_nala: "u_jesus",
    });
    expect(await canAccessReservation(prisma, reserva, andrea)).toBe(true);
  });

  it("deja ver al DUEÑO la reserva que hizo el co-dueño", async () => {
    // La reserva de Andrea está a nombre de Andrea; Jesús solo entra por ser
    // el dueño de Nala. Este es el caso que se escapaba.
    const deAndrea = { ownerId: "u_andrea", petId: "p_nala" };
    const prisma = fakePrisma([{ petId: "p_nala", userId: "u_andrea" }], {
      p_nala: "u_jesus",
    });
    expect(await canAccessReservation(prisma, deAndrea, jesus)).toBe(true);
  });

  it("bloquea a un tercero", async () => {
    const prisma = fakePrisma([], { p_nala: "u_jesus" });
    expect(
      await canAccessReservation(prisma, reserva, {
        userId: "u_otro",
        userRole: "OWNER",
      })
    ).toBe(false);
  });
});

describe("petAudienceIds", () => {
  it("incluye al dueño y a los co-dueños, sin repetir", async () => {
    const prisma = fakePrisma(
      [
        { petId: "p_nala", userId: "u_andrea" },
        { petId: "p_nala", userId: "u_jesus" }, // fila espuria: no debe duplicar
      ],
      { p_nala: "u_jesus" }
    );
    const ids = await petAudienceIds(prisma, "p_nala", "u_jesus");
    expect(ids).toEqual(["u_jesus", "u_andrea"]);
  });

  it("con un perro sin compartir, avisa solo al dueño (como siempre)", async () => {
    const prisma = fakePrisma([], { p_nala: "u_jesus" });
    expect(await petAudienceIds(prisma, "p_nala", "u_jesus")).toEqual(["u_jesus"]);
  });

  it("resuelve al dueño solo cuando no se lo pasan", async () => {
    const prisma = fakePrisma([], { p_nala: "u_jesus" });
    expect(await petAudienceIds(prisma, "p_nala")).toEqual(["u_jesus"]);
    expect(prisma.pet.findUnique).toHaveBeenCalled();
  });
});

describe("sharedPetIds", () => {
  it("cachea el resultado y lo suelta al invalidar", async () => {
    const prisma = fakePrisma([{ petId: "p_nala", userId: "u_andrea" }]);
    expect(await sharedPetIds(prisma, "u_andrea")).toEqual(["p_nala"]);
    await sharedPetIds(prisma, "u_andrea");
    expect(prisma.petCoOwner.findMany).toHaveBeenCalledTimes(1);

    invalidatePetAccessCache("u_andrea");
    await sharedPetIds(prisma, "u_andrea");
    expect(prisma.petCoOwner.findMany).toHaveBeenCalledTimes(2);
  });
});
