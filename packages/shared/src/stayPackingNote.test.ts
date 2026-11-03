import { describe, expect, it } from "vitest";
import { joinPetNames, stayPackingNote } from "./stayPackingNote";

describe("stayPackingNote", () => {
  it("una mascota", () => {
    expect(stayPackingNote(["Polo"]).headline).toBe(
      "La reserva de Polo está lista. Recuerda llevar su alimento 🍖"
    );
  });

  it("dos y tres mascotas, sin repetidos ni espacios", () => {
    expect(joinPetNames(["Polo", " Luna "])).toBe("Polo y Luna");
    expect(joinPetNames(["Polo", "Luna", "Toby", "Polo"])).toBe("Polo, Luna y Toby");
  });

  it("sin nombres no truena", () => {
    expect(joinPetNames([])).toBe("tu peludito");
    expect(joinPetNames(["", "  "])).toBe("tu peludito");
  });

  it("la correa va siempre, tal cual", () => {
    expect(stayPackingNote([]).items).toEqual([
      "Platos para comida",
      "Agua",
      "Correa para sus paseos (si tiene permiso para salir)",
    ]);
  });
});
