import { describe, expect, it, vi } from "vitest";
import type { Pet } from "@prisma/client";
import { mergeNotes, mergePetInto, planPetMerge, PetMergeError } from "./petMerge";

function pet(over: Partial<Pet> = {}): Pet {
  return {
    id: "p",
    name: "Firulais",
    breed: null,
    size: "M",
    sizeDeclared: false,
    birthDate: null,
    weight: null,
    photoUrl: null,
    notes: null,
    sex: null,
    behavior: null,
    walkPreference: null,
    healthIssues: null,
    isNeutered: false,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelation: null,
    vetName: null,
    vetPhone: null,
    vetEmergency24h: false,
    feedingSchedule: null,
    feedingAmount: null,
    foodType: null,
    feedingInstructions: null,
    diet: null,
    personality: null,
    groomingMinutes: null,
    cartillaUrl: null,
    cartillaPhotos: [],
    cartillaStatus: null,
    cartillaReviewedAt: null,
    cartillaReviewedById: null,
    cartillaRejectionReason: null,
    cartillaApprovalNote: null,
    isActive: true,
    expressIntakeAt: null,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    ownerId: "u_ficha",
    ...over,
  } as Pet;
}

// El caso real: la ficha del equipo casi vacía y la del cliente completa.
const DRAGO_FICHA = pet({
  id: "drago_ficha",
  name: "Drago Castro",
  breed: "Husky Siberiano",
  size: "XL",
  weight: 30,
  photoUrl: "https://cdn/ficha.jpg",
});
const REVISADA = new Date("2026-09-10T20:09:42Z");
const DRAGO_APP = pet({
  id: "drago_app",
  name: "Drago",
  breed: "Husky Siberiano",
  size: "XL",
  weight: 30,
  photoUrl: "https://cdn/app.jpg",
  birthDate: new Date("2022-12-08"),
  sex: "M",
  notes: "Ha tirado mordida a perros, favor de supervisar.",
  emergencyContactName: "Octavio Castro",
  vetName: "Kc Clínica Veterinaria",
  vetEmergency24h: true,
  cartillaUrl: "https://cdn/c1.jpg",
  cartillaPhotos: ["https://cdn/c1.jpg", "https://cdn/c2.jpg"],
  cartillaStatus: "APPROVED",
  cartillaReviewedAt: REVISADA,
  cartillaReviewedById: "u_javier",
  ownerId: "u_app",
});

describe("planPetMerge", () => {
  it("completa lo vacío sin pisar lo que el destino ya tiene", () => {
    const data = planPetMerge(DRAGO_APP, DRAGO_FICHA);
    expect(data).toMatchObject({
      birthDate: DRAGO_APP.birthDate,
      sex: "M",
      emergencyContactName: "Octavio Castro",
      vetName: "Kc Clínica Veterinaria",
      vetEmergency24h: true,
      notes: "Ha tirado mordida a perros, favor de supervisar.",
    });
    // La foto de la ficha es la que ya conoce el equipo: se queda.
    expect(data).not.toHaveProperty("photoUrl");
    expect(data).not.toHaveProperty("breed");
    expect(data).not.toHaveProperty("weight");
  });

  it("trae la cartilla completa cuando la del destino no existe", () => {
    const data = planPetMerge(DRAGO_APP, DRAGO_FICHA);
    expect(data).toMatchObject({
      cartillaStatus: "APPROVED",
      cartillaPhotos: ["https://cdn/c1.jpg", "https://cdn/c2.jpg"],
      cartillaUrl: "https://cdn/c1.jpg",
      cartillaReviewedAt: REVISADA,
      cartillaReviewedById: "u_javier",
    });
  });

  it("no cambia una cartilla aprobada por una pendiente más vieja que la revisión", () => {
    const into = pet({ cartillaStatus: "APPROVED", cartillaPhotos: ["a"], cartillaReviewedAt: new Date("2026-09-05") });
    const from = pet({ cartillaStatus: "PENDING", cartillaPhotos: ["b"], updatedAt: new Date("2026-09-01") });
    expect(planPetMerge(from, into)).not.toHaveProperty("cartillaStatus");
  });

  it("una pendiente más nueva que la revisión del destino gana (el cliente subió la de este año)", () => {
    const into = pet({ cartillaStatus: "APPROVED", cartillaPhotos: ["2025"], cartillaReviewedAt: new Date("2025-09-01") });
    const from = pet({ cartillaStatus: "PENDING", cartillaPhotos: ["2026"], updatedAt: new Date("2026-09-10") });
    expect(planPetMerge(from, into)).toMatchObject({
      cartillaStatus: "PENDING",
      cartillaPhotos: ["2026"],
      cartillaReviewedAt: null,
    });
  });

  it("cambia una cartilla rechazada por una pendiente, en bloque", () => {
    const into = pet({ cartillaStatus: "REJECTED", cartillaRejectionReason: "borrosa", cartillaPhotos: ["a"] });
    const from = pet({ cartillaStatus: "PENDING", cartillaPhotos: ["b"], updatedAt: new Date("2026-09-10") });
    const data = planPetMerge(from, into);
    expect(data).toMatchObject({ cartillaStatus: "PENDING", cartillaPhotos: ["b"], cartillaRejectionReason: null });
  });

  it("una vencida no se cambia por una rechazada", () => {
    const into = pet({ cartillaStatus: "EXPIRED", cartillaPhotos: ["a"] });
    const from = pet({ cartillaStatus: "REJECTED", cartillaPhotos: ["b"] });
    expect(planPetMerge(from, into)).not.toHaveProperty("cartillaStatus");
  });

  it("el nombre solo cambia si se pide", () => {
    expect(planPetMerge(DRAGO_APP, DRAGO_FICHA)).not.toHaveProperty("name");
    expect(planPetMerge(DRAGO_APP, DRAGO_FICHA, { useSourceName: true })).toMatchObject({ name: "Drago" });
  });

  it("peso y talla viajan juntos, y solo si el destino no tiene peso", () => {
    const from = pet({ weight: 22, size: "L", sizeDeclared: false });
    expect(planPetMerge(from, pet())).toMatchObject({ weight: 22, size: "L", sizeDeclared: false });
    expect(planPetMerge(from, pet({ weight: 8, size: "M" }))).not.toHaveProperty("size");
  });

  it("con una reserva activa en el destino no toca peso ni talla", () => {
    const from = pet({ weight: 22, size: "L" });
    const data = planPetMerge(from, pet(), { conservarTalla: true });
    expect(data).not.toHaveProperty("weight");
    expect(data).not.toHaveProperty("size");
  });

  it("un 'sí' en cualquiera de las dos gana en los booleanos", () => {
    expect(planPetMerge(pet({ isNeutered: true }), pet())).toMatchObject({ isNeutered: true });
    expect(planPetMerge(pet(), pet({ isNeutered: true }))).not.toHaveProperty("isNeutered");
  });

  it("no toca nada si el origen no aporta", () => {
    expect(planPetMerge(pet(), DRAGO_FICHA)).toEqual({});
  });
});

describe("mergeNotes", () => {
  it("suma las dos notas", () => {
    expect(mergeNotes("Come poco.", "Muerde.")).toBe("Come poco.\n\nMuerde.");
  });
  it("no repite lo que el equipo ya pegó a mano (sin importar mayúsculas ni espacios)", () => {
    expect(mergeNotes("OJO: ha tirado  mordida a perros.", "ha tirado mordida a PERROS.")).toBe(
      "OJO: ha tirado  mordida a perros.",
    );
  });
  it("con una sola nota se queda esa", () => {
    expect(mergeNotes(null, " Muerde. ")).toBe("Muerde.");
    expect(mergeNotes("Come poco.", "  ")).toBe("Come poco.");
  });
});

type Activa = { petId: string; checkIn: Date | null; checkOut: Date | null };

function makeTx(
  pets: Record<string, Pet>,
  {
    coOwnersDestino = [] as string[],
    activas = [] as Activa[],
    vivasOrigen = [] as string[],
    coDuenosDestino = 0,
    vivasDestino = 0,
  } = {},
) {
  const updateMany = () => vi.fn(async () => ({ count: 1 }));
  return {
    pet: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => pets[where.id] ?? null),
      update: vi.fn(async () => ({})),
    },
    reservation: { updateMany: updateMany(), findMany: vi.fn(async () => activas) },
    vaccine: { updateMany: updateMany() },
    deworming: { updateMany: updateMany() },
    stayUpdate: { updateMany: updateMany() },
    behaviorTag: { updateMany: updateMany() },
    staffAlert: { updateMany: updateMany() },
    quotePet: { updateMany: updateMany() },
    petCoOwner: {
      findMany: vi.fn(async () => coOwnersDestino.map((userId) => ({ userId }))),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: updateMany(),
      count: vi.fn(async () => coDuenosDestino),
    },
    petInvite: {
      findMany: vi.fn(async () => vivasOrigen.map((id) => ({ id }))),
      count: vi.fn(async () => vivasDestino),
      updateMany: updateMany(),
    },
  };
}

describe("mergePetInto", () => {
  const PETS = { drago_app: DRAGO_APP, drago_ficha: DRAGO_FICHA };

  it("re-apunta todo lo que cuelga de la mascota, reservas e invitaciones incluidas", async () => {
    const tx = makeTx(PETS);
    await mergePetInto(tx as never, "drago_app", "drago_ficha");
    const esperado = { where: { petId: "drago_app" }, data: { petId: "drago_ficha" } };
    for (const modelo of [
      tx.reservation,
      tx.vaccine,
      tx.deworming,
      tx.stayUpdate,
      tx.behaviorTag,
      tx.staffAlert,
      tx.quotePet,
      tx.petCoOwner,
      tx.petInvite,
    ]) {
      expect(modelo.updateMany).toHaveBeenCalledWith(esperado);
    }
  });

  it("copia el expediente al destino y desactiva el origen (no lo borra)", async () => {
    const tx = makeTx(PETS);
    const { copiedFields } = await mergePetInto(tx as never, "drago_app", "drago_ficha", {
      useSourceName: true,
    });
    expect(copiedFields).toEqual(expect.arrayContaining(["notes", "cartillaStatus", "name"]));
    expect(tx.pet.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "drago_ficha" } }),
    );
    expect(tx.pet.update).toHaveBeenLastCalledWith({
      where: { id: "drago_app" },
      data: { isActive: false },
    });
  });

  it("antes de mover co-dueños quita los que chocarían con el único (petId, userId)", async () => {
    const tx = makeTx(PETS, { coOwnersDestino: ["u_pareja"] });
    await mergePetInto(tx as never, "drago_app", "drago_ficha");
    expect(tx.petCoOwner.deleteMany).toHaveBeenCalledWith({
      where: { petId: "drago_app", userId: { in: ["u_ficha", "u_pareja"] } },
    });
    const orden = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
    expect(orden(tx.petCoOwner.deleteMany)).toBeLessThan(orden(tx.petCoOwner.updateMany));
  });

  it("las invitaciones vivas pasan hasta el tope de co-dueños; las que no caben se cancelan", async () => {
    // Destino con 2 co-dueños: queda lugar para 1 de las 2 invitaciones vivas.
    const tx = makeTx(PETS, { vivasOrigen: ["inv_1", "inv_2"], coDuenosDestino: 2 });
    await mergePetInto(tx as never, "drago_app", "drago_ficha");
    expect(tx.petInvite.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv_2"] } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("no junta dos estancias activas encimadas", async () => {
    const tx = makeTx(PETS, {
      activas: [
        { petId: "drago_ficha", checkIn: new Date("2026-09-10"), checkOut: new Date("2026-09-15") },
        { petId: "drago_app", checkIn: new Date("2026-09-14"), checkOut: new Date("2026-09-16") },
      ],
    });
    await expect(mergePetInto(tx as never, "drago_app", "drago_ficha")).rejects.toBeInstanceOf(PetMergeError);
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
  });

  it("estancias en fechas distintas sí se juntan, y con la del destino activa no toca la talla", async () => {
    const conPeso = { ...PETS, drago_ficha: { ...DRAGO_FICHA, weight: null } };
    const tx = makeTx(conPeso, {
      activas: [
        { petId: "drago_ficha", checkIn: new Date("2026-09-10"), checkOut: new Date("2026-09-15") },
        { petId: "drago_app", checkIn: new Date("2026-10-01"), checkOut: new Date("2026-10-03") },
      ],
    });
    await mergePetInto(tx as never, "drago_app", "drago_ficha");
    const datos = (tx.pet.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(datos).not.toHaveProperty("weight");
    expect(tx.reservation.updateMany).toHaveBeenCalled();
  });

  it("rechaza fusionar una mascota consigo misma, una que no existe o un destino dado de baja", async () => {
    await expect(mergePetInto(makeTx(PETS) as never, "drago_app", "drago_app")).rejects.toBeInstanceOf(
      PetMergeError,
    );
    await expect(mergePetInto(makeTx(PETS) as never, "drago_app", "nada")).rejects.toBeInstanceOf(
      PetMergeError,
    );
    const baja = { ...PETS, drago_ficha: { ...DRAGO_FICHA, isActive: false } };
    await expect(mergePetInto(makeTx(baja) as never, "drago_app", "drago_ficha")).rejects.toBeInstanceOf(
      PetMergeError,
    );
  });
});
