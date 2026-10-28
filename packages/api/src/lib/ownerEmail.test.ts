import { describe, expect, it } from "vitest";
import { decidirCorreoFicha, parseCorreoFicha } from "./ownerEmail";

const ficha = (extra: Partial<Parameters<typeof decidirCorreoFicha>[0] & object> = {}) => ({
  id: "f1",
  role: "OWNER",
  clerkId: null,
  email: "walkin+abc@holidoginn.local",
  ...extra,
});

const ocupante = (extra = {}) => ({
  id: "o1",
  firstName: "Luz",
  lastName: "Armenta Ruiz",
  clerkId: null as string | null,
  isActive: true,
  ...extra,
});

describe("parseCorreoFicha", () => {
  it("limpia espacios y mayúsculas (Clerk los manda en minúsculas)", () => {
    expect(parseCorreoFicha("  Luz.Armenta@Gmail.COM ")).toBe("luz.armenta@gmail.com");
  });
  it("rechaza lo que no es correo y el placeholder de walk-in", () => {
    expect(parseCorreoFicha("luz armenta")).toBeNull();
    expect(parseCorreoFicha("")).toBeNull();
    expect(parseCorreoFicha(undefined)).toBeNull();
    expect(parseCorreoFicha("walkin+1@holidoginn.local")).toBeNull();
  });
});

describe("decidirCorreoFicha", () => {
  it("ficha sin app y correo libre: se guarda", () => {
    expect(decidirCorreoFicha(ficha(), "luz@gmail.com", null)).toEqual({
      ok: true,
      email: "luz@gmail.com",
      sinCambio: false,
    });
  });

  it("el mismo correo que ya tiene no es conflicto", () => {
    const f = ficha({ email: "Luz@gmail.com" });
    expect(decidirCorreoFicha(f, "luz@gmail.com", ocupante({ id: "f1" }))).toMatchObject({
      ok: true,
      sinCambio: true,
    });
  });

  it("no toca el correo de quien ya entra a la app", () => {
    expect(decidirCorreoFicha(ficha({ clerkId: "user_1" }), "luz@gmail.com", null)).toMatchObject({
      ok: false,
      status: 409,
      code: "TIENE_APP",
    });
  });

  it("correo de una cuenta de la app: manda a Juntar fichas", () => {
    const r = decidirCorreoFicha(ficha(), "luz@gmail.com", ocupante({ clerkId: "user_2" }));
    expect(r).toMatchObject({ ok: false, status: 409, code: "CORREO_OCUPADO" });
    if (!r.ok) {
      expect(r.error).toContain("Juntar con otra ficha");
      expect(r.ocupante).toEqual({ id: "o1", nombre: "Luz Armenta Ruiz", tieneApp: true, activo: true });
    }
  });

  it("correo de otra ficha sin app: dice de quién, sin el apellido de relleno", () => {
    const r = decidirCorreoFicha(ficha(), "luz@gmail.com", ocupante({ lastName: "—", isActive: false }));
    expect(r).toMatchObject({ ok: false, code: "CORREO_OCUPADO" });
    if (!r.ok) expect(r.error).toBe("Ese correo ya está en la ficha de Luz (dada de baja).");
  });

  it("solo fichas de clientes, y 404 si no existe", () => {
    expect(decidirCorreoFicha(ficha({ role: "STAFF" }), "a@b.com", null)).toMatchObject({ status: 400 });
    expect(decidirCorreoFicha(null, "a@b.com", null)).toMatchObject({ status: 404 });
    expect(decidirCorreoFicha(ficha(), null, null)).toMatchObject({ status: 400 });
  });
});
