import { describe, it, expect } from "vitest";
import { normalizePetName, findPetByName } from "./petName";

describe("normalizePetName", () => {
  it("quita los espacios de las orillas", () => {
    // El caso real: la dueña capturó "DUGAN" y luego "DUGAN ", y el candado
    // anti-duplicado los vio como dos perros distintos.
    expect(normalizePetName("DUGAN ")).toBe(normalizePetName("DUGAN"));
  });

  it("ignora mayúsculas", () => {
    expect(normalizePetName("Dugan")).toBe(normalizePetName("DUGAN"));
  });

  it("colapsa los espacios internos", () => {
    expect(normalizePetName("Lady  Di")).toBe("lady di");
  });

  it("ignora acentos y la eñe", () => {
    expect(normalizePetName("Muñeca")).toBe(normalizePetName("muneca"));
    expect(normalizePetName("Bebé")).toBe(normalizePetName("bebe"));
  });

  it("no confunde nombres que sí son distintos", () => {
    expect(normalizePetName("Toby")).not.toBe(normalizePetName("Toby II"));
    expect(normalizePetName("Luna")).not.toBe(normalizePetName("Lunna"));
  });

  it("tolera null, undefined y vacío", () => {
    expect(normalizePetName(null)).toBe("");
    expect(normalizePetName(undefined)).toBe("");
    expect(normalizePetName("   ")).toBe("");
  });
});

describe("findPetByName", () => {
  const pets = [
    { id: "p1", name: "DUGAN" },
    { id: "p2", name: "Muñeca" },
  ];

  it("encuentra el duplicado aunque el nombre traiga basura", () => {
    expect(findPetByName(pets, "  dugan ")?.id).toBe("p1");
    expect(findPetByName(pets, "MUNECA")?.id).toBe("p2");
  });

  it("devuelve undefined cuando de verdad es otro perro", () => {
    expect(findPetByName(pets, "Rocco")).toBeUndefined();
  });

  it("un nombre vacío no hace match con nadie", () => {
    // Si no, un nombre en blanco chocaría con cualquier ficha mal capturada.
    expect(findPetByName([{ id: "p3", name: " " }], "  ")).toBeUndefined();
  });
});
