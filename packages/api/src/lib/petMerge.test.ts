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

  it("no cambia una cartilla aprobada por una pendiente", () => {
    const into = pet({ cartillaStatus: "APPROVED", cartillaPhotos: ["a"] });
    const from = pet({ cartillaStatus: "PENDING", cartillaPhotos: ["b"] });
    expect(planPetMerge(from, into)).not.toHaveProperty("cartillaStatus");
  });

  it("cambia una cartilla rechazada por una pendiente, en bloque", () => {
    const into = pet({ cartillaStatus: "REJECTED", cartillaRejectionReason: "borrosa", cartillaPhotos: ["a"] });
    const from = pet({ cartillaStatus: "PENDING", cartillaPhotos: ["b"] });
    const data = planPetMerge(from, into);
    expect(data).toMatchObject({ cartillaStatus: "PENDING", cartillaPhotos: ["b"], cartillaRejectionReason: null });
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

function makeTx(pets: Record<string, Pet>, coOwnersDestino: string[] = []) {
  const updateMany = () => vi.fn(async () => ({ count: 1 }));
  return {
    pet: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => pets[where.id] ?? null),
      update: vi.fn(async () => ({})),
    },
    reservation: { updateMany: updateMany() },
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
    },
  };
}

describe("mergePetInto", () => {
  const PETS = { drago_app: DRAGO_APP, drago_ficha: DRAGO_FICHA };

  it("re-apunta todo lo que cuelga de la mascota, reservas incluidas", async () => {
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
    const tx = makeTx(PETS, ["u_pareja"]);
    await mergePetInto(tx as never, "drago_app", "drago_ficha");
    expect(tx.petCoOwner.deleteMany).toHaveBeenCalledWith({
      where: { petId: "drago_app", userId: { in: ["u_ficha", "u_pareja"] } },
    });
    const orden = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
    expect(orden(tx.petCoOwner.deleteMany)).toBeLessThan(orden(tx.petCoOwner.updateMany));
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
