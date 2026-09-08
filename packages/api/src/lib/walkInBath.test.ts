import { describe, expect, it, vi, beforeEach } from "vitest";

// `createTeamReservation` es el camino de siempre y ya tiene sus propios tests:
// aquí sólo importa QUÉ se le entrega y qué se hace si falla.
vi.mock("./reservationTeamCreate", () => ({
  createTeamReservation: vi.fn(),
}));
vi.mock("./petAccess", () => ({
  sharedPetIds: vi.fn(async () => []),
}));
vi.mock("./bathAvailabilityDb", () => ({
  ensureConfig: vi.fn(async () => ({ isActive: true })),
  loadScheduleCfg: vi.fn(async () => ({ bufferMinutes: 0 })),
  loadBusyIntervals: vi.fn(async () => []),
  resolveBathDuration: vi.fn(async () => ({ durationMinutes: 90, variantId: "v1", resolved: true })),
}));
vi.mock("./bathAvailability", () => ({
  localYMD: vi.fn(() => "2026-09-09"),
  evaluateStart: vi.fn(() => ({ ok: true })),
}));

import { createTeamReservation } from "./reservationTeamCreate";
import { evaluateStart } from "./bathAvailability";
import { createWalkInBath } from "./walkInBath";

const RESERVA_OK = {
  ok: true as const,
  data: {
    reservations: [
      { id: "res_1", totalAmount: 450, pet: { name: "Camila" }, groupId: null },
    ],
    groupId: null,
    agendaWarnings: [],
  },
};

/** Prisma mockeado: sólo lo que toca `createWalkInBath`. */
function makePrisma(over: Record<string, unknown> = {}) {
  const prisma = {
    $queryRaw: vi.fn(async () => []),
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "u_new", phone: "6621112233" })),
      delete: vi.fn(async () => ({})),
    },
    pet: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: "p_new", name: "Camila", size: "L", photoUrl: null,
      })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    serviceType: { findUnique: vi.fn(async () => ({ id: "st_bath" })) },
    serviceVariant: {
      findUnique: vi.fn(async () => ({ id: "v1", isActive: true, price: 450 })),
    },
    ...over,
  };
  return prisma as never;
}

const INPUT = {
  owner: { name: "Ana López", phone: "6621112233" },
  pet: { name: "Camila", size: "L" as const },
  appointmentAt: "2026-09-09T22:00:00.000Z",
  deslanado: false,
  corte: false,
};

beforeEach(() => {
  // Sin esto, `createTeamReservation` acarrea las llamadas del test anterior y
  // los `not.toHaveBeenCalled()` mienten.
  vi.clearAllMocks();
  vi.mocked(createTeamReservation).mockResolvedValue(RESERVA_OK as never);
  vi.mocked(evaluateStart).mockReturnValue({ ok: true } as never);
});

describe("createWalkInBath — alta limpia", () => {
  it("crea la ficha walk-in reclamable y el perro con la talla VERBATIM", async () => {
    const prisma = makePrisma();
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: "admin_1" });

    expect(res.ok).toBe(true);
    const user = (prisma as never as { user: { create: ReturnType<typeof vi.fn> } }).user.create;
    const userData = user.mock.calls[0][0].data;
    // De estos cuatro campos depende que el cliente pueda reclamar su ficha por
    // SMS el día que instale la app (findLegacyCandidates en routes/users.ts).
    expect(userData.email).toMatch(/^walkin\+.+@holidoginn\.local$/);
    expect(userData.role).toBe("OWNER");
    expect(userData.clerkId).toBeUndefined();
    expect(userData.phone).toBe("6621112233");
    expect(userData.expressIntakeAt).toBeInstanceOf(Date);
    expect(userData.firstName).toBe("Ana López");

    const pet = (prisma as never as { pet: { create: ReturnType<typeof vi.fn> } }).pet.create;
    const petData = pet.mock.calls[0][0].data;
    // La trampa cara: si esto pasara por derivePetSize/sizeFromWeight, sin peso
    // devolvería "M"/"S" y la talla elegida a ojo se perdería.
    expect(petData.size).toBe("L");
    expect(petData.sizeDeclared).toBe(true);
    expect(petData.weight).toBeNull();
    expect(petData.expressIntakeAt).toBeInstanceOf(Date);
  });

  it("cobra por la variante de la talla elegida, no por la de perro chico", async () => {
    const prisma = makePrisma();
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const variantCall = (
      prisma as never as { serviceVariant: { findUnique: ReturnType<typeof vi.fn> } }
    ).serviceVariant.findUnique.mock.calls[0][0];
    expect(variantCall.where.serviceTypeId_petSize_deslanado_corte.petSize).toBe("L");
    expect(res.data.pricing.sizeSource).toBe("declared");
    expect(res.data.pet.created).toBe(true);
    expect(res.data.owner.created).toBe(true);
  });
});

describe("createWalkInBath — dedupe del dueño por teléfono", () => {
  const dup = { id: "u_ana", firstName: "Ana", lastName: "López", phone: "662 111 2233" };

  it("pregunta antes de duplicar, y NO escribe nada mientras pregunta", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn(async () => [dup]),
      pet: {
        ...(makePrisma() as never as { pet: object }).pet,
        findMany: vi.fn(async () => [
          { id: "p_1", name: "Rocky", size: "M", weight: 12, ownerId: "u_ana" },
        ]),
      },
    });
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: null });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.code).toBe("WALKIN_PHONE_EXISTS");
    const candidates = (res.extra as { candidates: { name: string; pets: unknown[] }[] }).candidates;
    expect(candidates[0].name).toBe("Ana López");
    expect(candidates[0].pets).toHaveLength(1);
    // Lo importante: preguntar no deja basura a medias.
    const p = prisma as never as {
      user: { create: ReturnType<typeof vi.fn> };
      pet: { create: ReturnType<typeof vi.fn> };
    };
    expect(p.user.create).not.toHaveBeenCalled();
    expect(p.pet.create).not.toHaveBeenCalled();
    expect(createTeamReservation).not.toHaveBeenCalled();
  });

  it("detecta el mismo número escrito de cualquier forma", async () => {
    // El teléfono se guarda en formato libre: la comparación es por los últimos
    // 10 dígitos, así que la lada y los separadores dan igual.
    for (const phone of ["+52 662 111 2233", "6621112233", "044 662 111-2233", "(662) 111 2233"]) {
      const prisma = makePrisma({ $queryRaw: vi.fn(async () => [dup]) });
      const res = await createWalkInBath(prisma, {
        input: { ...INPUT, owner: { ...INPUT.owner, phone } } as never,
        actorUserId: null,
      });
      expect(res.ok, phone).toBe(false);
      if (!res.ok) expect(res.code, phone).toBe("WALKIN_PHONE_EXISTS");
    }
  });

  it("teléfono de menos de 10 dígitos no pasa", async () => {
    const res = await createWalkInBath(makePrisma(), {
      input: { ...INPUT, owner: { ...INPUT.owner, phone: "6621112" } } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PHONE_INVALID");
  });

  it("al confirmar reusa la ficha SIN pisar sus datos", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: vi.fn(async () => ({
          id: "u_ana", firstName: "Ana", lastName: "López",
          phone: "662 111 2233", isActive: true,
        })),
        create: vi.fn(),
        delete: vi.fn(),
      },
    });
    const res = await createWalkInBath(prisma, {
      input: { ...INPUT, confirmReuseOwnerId: "u_ana" } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.owner.created).toBe(false);
    expect(res.data.owner.name).toBe("Ana López");
    // La ficha existente fue curada por alguien: el walk-in no la degrada.
    expect((prisma as never as { user: { create: ReturnType<typeof vi.fn> } }).user.create)
      .not.toHaveBeenCalled();
  });

  it("confirmar una ficha con OTRO teléfono se rechaza", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: vi.fn(async () => ({
          id: "u_otro", firstName: "Luis", lastName: "P",
          phone: "6629998877", isActive: true,
        })),
        create: vi.fn(), delete: vi.fn(),
      },
    });
    const res = await createWalkInBath(prisma, {
      input: { ...INPUT, confirmReuseOwnerId: "u_otro" } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("OWNER_MISMATCH");
  });
});

describe("createWalkInBath — dedupe del perro", () => {
  const conDueño = (pets: unknown[]) =>
    makePrisma({
      user: {
        findUnique: vi.fn(async () => ({
          id: "u_ana", firstName: "Ana", lastName: "López",
          phone: "6621112233", isActive: true,
        })),
        create: vi.fn(), delete: vi.fn(),
      },
      pet: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => pets),
        create: vi.fn(async () => ({ id: "p_new", name: "Camila", size: "L", photoUrl: null })),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({})),
      },
    });

  // Regresión del incidente del 26-ago-2026: "DUGAN " con un espacio final
  // burló los tres candados y partió el expediente de un beagle en dos.
  it.each([
    ["DUGAN ", "dugan"],
    ["  Camila", "camila  "],
    ["Muñeca", "muneca"],
    ["Camila  Rosa", "Camila Rosa"],
  ])("reconoce %j y %j como el mismo perro", async (guardado, tecleado) => {
    const prisma = conDueño([
      { id: "p_1", name: guardado, size: "M", sizeDeclared: false, weight: null, photoUrl: null },
    ]);
    const res = await createWalkInBath(prisma, {
      input: { ...INPUT, pet: { ...INPUT.pet, name: tecleado }, confirmReuseOwnerId: "u_ana" } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("WALKIN_PET_EXISTS");
  });

  it("con forceNewPet sí crea el segundo perro que se llama igual", async () => {
    const prisma = conDueño([
      { id: "p_1", name: "Camila", size: "M", sizeDeclared: false, weight: null, photoUrl: null },
    ]);
    const res = await createWalkInBath(prisma, {
      input: { ...INPUT, confirmReuseOwnerId: "u_ana", forceNewPet: true } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(true);
    expect((prisma as never as { pet: { create: ReturnType<typeof vi.fn> } }).pet.create)
      .toHaveBeenCalled();
  });

  it("si el perro reusado YA tiene peso, el peso manda y se avisa", async () => {
    const prisma = conDueño([]);
    (prisma as never as { pet: { findUnique: ReturnType<typeof vi.fn> } }).pet.findUnique =
      vi.fn(async () => ({
        id: "p_1", name: "Camila", size: "XL", sizeDeclared: false,
        weight: 30, photoUrl: null, ownerId: "u_ana", isActive: true,
      }));
    const res = await createWalkInBath(prisma, {
      input: {
        ...INPUT, confirmReuseOwnerId: "u_ana", confirmReusePetId: "p_1",
        pet: { name: "Camila", size: "M" },
      } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.pricing.sizeSource).toBe("weight");
    expect(res.data.warnings[0]).toContain("30 kg");
    // Se cobra por lo que dice la báscula (XL), no por el vistazo (M).
    const variantCall = (
      prisma as never as { serviceVariant: { findUnique: ReturnType<typeof vi.fn> } }
    ).serviceVariant.findUnique.mock.calls[0][0];
    expect(variantCall.where.serviceTypeId_petSize_deslanado_corte.petSize).toBe("XL");
  });

  it("perro reusado SIN peso pero con talla declarada: manda su ficha", async () => {
    // Regresión: el pre-flight validaba la variante de la talla tecleada hoy
    // mientras createTeamReservation cobraba la de la ficha. Si difieren, o se
    // cobra otro precio, o revienta con VARIANT_UNAVAILABLE después de pasar.
    const prisma = conDueño([]);
    (prisma as never as { pet: { findUnique: ReturnType<typeof vi.fn> } }).pet.findUnique =
      vi.fn(async () => ({
        id: "p_1", name: "Camila", size: "XL", sizeDeclared: true,
        weight: null, photoUrl: null, ownerId: "u_ana", isActive: true,
      }));
    const res = await createWalkInBath(prisma, {
      input: {
        ...INPUT, confirmReuseOwnerId: "u_ana", confirmReusePetId: "p_1",
        pet: { name: "Camila", size: "S" },
      } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const variantCall = (
      prisma as never as { serviceVariant: { findUnique: ReturnType<typeof vi.fn> } }
    ).serviceVariant.findUnique.mock.calls[0][0];
    expect(variantCall.where.serviceTypeId_petSize_deslanado_corte.petSize).toBe("XL");
    expect(res.data.pricing.sizeSource).toBe("declared");
    expect(res.data.warnings[0]).toContain("XL");
  });

  it("la foto es aditiva: no pisa la que ya tenía", async () => {
    const prisma = conDueño([]);
    (prisma as never as { pet: { findUnique: ReturnType<typeof vi.fn> } }).pet.findUnique =
      vi.fn(async () => ({
        id: "p_1", name: "Camila", size: "L", sizeDeclared: true,
        weight: null, photoUrl: "https://cdn/vieja.jpg", ownerId: "u_ana", isActive: true,
      }));
    await createWalkInBath(prisma, {
      input: {
        ...INPUT, confirmReuseOwnerId: "u_ana", confirmReusePetId: "p_1",
        pet: { name: "Camila", size: "L", photoUrl: "https://cdn/nueva.jpg" },
      } as never,
      actorUserId: null,
    });
    const update = (prisma as never as { pet: { update: ReturnType<typeof vi.fn> } }).pet.update;
    const patch = update.mock.calls[0]?.[0]?.data ?? {};
    expect(patch.photoUrl).toBeUndefined();
    // Ya tenía talla declarada: tampoco se le pisa.
    expect(patch.size).toBeUndefined();
  });
});

describe("createWalkInBath — pre-flight: fallar ANTES de escribir", () => {
  it("sin variante para la talla no se crea ninguna ficha", async () => {
    const prisma = makePrisma({
      serviceVariant: { findUnique: vi.fn(async () => ({ id: "v1", isActive: false })) },
    });
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VARIANT_UNAVAILABLE");
    const p = prisma as never as {
      user: { create: ReturnType<typeof vi.fn> };
      pet: { create: ReturnType<typeof vi.fn> };
    };
    expect(p.user.create).not.toHaveBeenCalled();
    expect(p.pet.create).not.toHaveBeenCalled();
  });

  it("con la agenda encimada no se crea nada, salvo que se fuerce", async () => {
    vi.mocked(evaluateStart).mockReturnValue({ ok: false, message: "se encima" } as never);
    const prisma = makePrisma();
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("AGENDA_CONFLICT");
    expect((prisma as never as { user: { create: ReturnType<typeof vi.fn> } }).user.create)
      .not.toHaveBeenCalled();

    const prisma2 = makePrisma();
    const forzado = await createWalkInBath(prisma2, {
      input: { ...INPUT, scheduleOverride: true } as never,
      actorUserId: null,
    });
    expect(forzado.ok).toBe(true);
  });

  it("con la agenda de baños apagada no se captura", async () => {
    const { ensureConfig } = await import("./bathAvailabilityDb");
    vi.mocked(ensureConfig).mockResolvedValueOnce({ isActive: false } as never);
    const res = await createWalkInBath(makePrisma(), { input: INPUT as never, actorUserId: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("BATH_DISABLED");
  });
});

describe("createWalkInBath — rollback compensatorio", () => {
  it("si la reserva falla, borra SÓLO lo que nació en esta petición", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue({
      ok: false, status: 409, error: "alguien tomó el slot", code: "AGENDA_CONFLICT",
    } as never);
    const prisma = makePrisma();
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: null });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("AGENDA_CONFLICT");
    const p = prisma as never as {
      user: { delete: ReturnType<typeof vi.fn> };
      pet: { delete: ReturnType<typeof vi.fn> };
    };
    expect(p.pet.delete).toHaveBeenCalledWith({ where: { id: "p_new" } });
    expect(p.user.delete).toHaveBeenCalledWith({ where: { id: "u_new" } });
  });

  it("con dueño y perro REUSADOS no borra nada de nadie", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue({
      ok: false, status: 500, error: "boom",
    } as never);
    const prisma = makePrisma({
      user: {
        findUnique: vi.fn(async () => ({
          id: "u_ana", firstName: "Ana", lastName: "López",
          phone: "6621112233", isActive: true,
        })),
        create: vi.fn(), delete: vi.fn(),
      },
      pet: {
        findUnique: vi.fn(async () => ({
          id: "p_1", name: "Camila", size: "L", sizeDeclared: true,
          weight: null, photoUrl: null, ownerId: "u_ana", isActive: true,
        })),
        findMany: vi.fn(async () => []),
        create: vi.fn(), update: vi.fn(async () => ({})), delete: vi.fn(),
      },
    });
    const res = await createWalkInBath(prisma, {
      input: { ...INPUT, confirmReuseOwnerId: "u_ana", confirmReusePetId: "p_1" } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(false);
    const p = prisma as never as {
      user: { delete: ReturnType<typeof vi.fn> };
      pet: { delete: ReturnType<typeof vi.fn> };
    };
    expect(p.pet.delete).not.toHaveBeenCalled();
    expect(p.user.delete).not.toHaveBeenCalled();
  });

  it("si el borrado también truena, gana el error original", async () => {
    vi.mocked(createTeamReservation).mockResolvedValue({
      ok: false, status: 500, error: "boom original",
    } as never);
    const prisma = makePrisma({
      pet: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "p_new", name: "Camila", size: "L", photoUrl: null })),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => { throw new Error("FK"); }),
      },
    });
    const res = await createWalkInBath(prisma, { input: INPUT as never, actorUserId: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("boom original");
  });
});

describe("createWalkInBath — rastro de auditoría", () => {
  it("forzar un teléfono duplicado queda anotado en la nota interna", async () => {
    const res = await createWalkInBath(makePrisma({ $queryRaw: vi.fn(async () => [
      { id: "u_ana", firstName: "Ana", lastName: "López", phone: "6621112233" },
    ]) }), {
      input: { ...INPUT, forceNewOwner: true, internalNotes: "pagó en efectivo" } as never,
      actorUserId: null,
    });
    expect(res.ok).toBe(true);
    const enviado = vi.mocked(createTeamReservation).mock.calls.at(-1)![1].input;
    expect(enviado.internalNotes).toContain("pagó en efectivo");
    expect(enviado.internalNotes).toContain("[WALK-IN]");
    expect(enviado.internalNotes).toContain("6621112233");
  });

  it("la reserva viaja como BATH con el gate legal ya aceptado por el equipo", async () => {
    await createWalkInBath(makePrisma(), { input: INPUT as never, actorUserId: "admin_1" });
    const call = vi.mocked(createTeamReservation).mock.calls.at(-1)!;
    expect(call[1].input.reservationType).toBe("BATH");
    expect(call[1].input.legalAccepted).toBe(true);
    expect(call[1].input.ownerId).toBe("u_new");
    expect(call[1].input.petId).toBe("p_new");
    expect(call[1].actorUserId).toBe("admin_1");
  });
});
