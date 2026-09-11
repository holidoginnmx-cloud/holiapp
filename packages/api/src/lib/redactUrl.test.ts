import { describe, expect, it } from "vitest";
import { redactSecretPath } from "./redactUrl";

// Lo que se protege: que los tokens de las ligas públicas no lleguen a los logs.

describe("redactSecretPath", () => {
  it("borra la llave de una invitación, también al aceptarla", () => {
    expect(redactSecretPath("/invites/0123456789abcdef0123456789abcdef")).toBe(
      "/invites/[redactado]"
    );
    expect(redactSecretPath("/invites/ABCD2345/accept")).toBe("/invites/[redactado]/accept");
  });

  it("borra el token de una cotización pública", () => {
    expect(redactSecretPath("/public/quotes/abc123?x=1")).toBe("/public/quotes/[redactado]?x=1");
  });

  it("no toca las demás rutas (tampoco las de invitaciones de una mascota)", () => {
    expect(redactSecretPath("/pets/p1/invites")).toBe("/pets/p1/invites");
    expect(redactSecretPath("/reservations/r1")).toBe("/reservations/r1");
  });
});
