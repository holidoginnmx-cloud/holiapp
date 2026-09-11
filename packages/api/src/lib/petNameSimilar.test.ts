import { describe, expect, it } from "vitest";
import { claveNombre, findSimilarPetByName } from "./petName";

const p = (id: string, name: string) => ({ id, name });

describe("claveNombre", () => {
  it("toma la primera palabra que identifica al perro", () => {
    expect(claveNombre("Sky Velazquez")).toBe("sky");
    expect(claveNombre("  DRAGO castro ")).toBe("drago");
    expect(claveNombre("La Güera")).toBe("guera");
  });
  it("con 2 letras o menos no alcanza", () => {
    expect(claveNombre("Bo")).toBe("");
    expect(claveNombre("")).toBe("");
  });
});

describe("findSimilarPetByName", () => {
  it("el mismo nombre es exacto", () => {
    expect(findSimilarPetByName([p("1", "DUGAN ")], "Dugan")).toEqual({ pet: p("1", "DUGAN "), exacto: true });
  });
  it("SKY y Sky Velazquez: parecido (el caso de Baltasar Soto)", () => {
    expect(findSimilarPetByName([p("1", "SKY")], "Sky Velazquez")).toEqual({ pet: p("1", "SKY"), exacto: false });
  });
  it("prefiere el exacto aunque haya uno parecido antes", () => {
    const r = findSimilarPetByName([p("1", "Toby II"), p("2", "Toby")], "toby");
    expect(r).toEqual({ pet: p("2", "Toby"), exacto: true });
  });
  it("no confunde 'La Chula' con 'La Güera' ni nombres cortos", () => {
    expect(findSimilarPetByName([p("1", "La Güera")], "La Chula")).toBeUndefined();
    expect(findSimilarPetByName([p("1", "Bo Castro")], "Bo")).toBeUndefined();
  });
});
