import { describe, expect, it } from "vitest";

import { dewormVariantMismatch } from "./addonRules";

const base = { serviceCode: "DEWORMING", petName: "Mia", isAdmin: false, expectedAvailable: true };

describe("dewormVariantMismatch", () => {
  it("acepta la talla que corresponde al peso", () => {
    expect(dewormVariantMismatch({ ...base, variantPetSize: "L", weightKg: 27.6 })).toBeNull();
  });

  it("rechaza a STAFF con una talla que no es la de su peso", () => {
    const msg = dewormVariantMismatch({ ...base, variantPetSize: "XS", weightKg: 27.6 });
    expect(msg).toContain("15.1–30 kg");
  });

  it("el ADMIN puede elegir otra talla", () => {
    expect(
      dewormVariantMismatch({ ...base, isAdmin: true, variantPetSize: "XS", weightKg: 27.6 })
    ).toBeNull();
  });

  it("sin peso o fuera de los tramos no hay contra qué comparar", () => {
    expect(dewormVariantMismatch({ ...base, variantPetSize: "S", weightKg: null })).toBeNull();
    expect(dewormVariantMismatch({ ...base, variantPetSize: "XL", weightKg: 75 })).toBeNull();
  });

  it("si la talla que le toca está desactivada, acepta otra", () => {
    expect(
      dewormVariantMismatch({ ...base, expectedAvailable: false, variantPetSize: "XL", weightKg: 27.6 })
    ).toBeNull();
  });

  it("no aplica a otros servicios", () => {
    expect(
      dewormVariantMismatch({ ...base, serviceCode: "BATH", variantPetSize: "XS", weightKg: 27.6 })
    ).toBeNull();
  });
});
