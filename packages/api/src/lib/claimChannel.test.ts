import { describe, expect, it } from "vitest";

import { alternateChannel, planChannel } from "./claimChannel";

describe("planChannel (la cascada)", () => {
  it("con ambos canales gana el SMS, y el correo queda de red", () => {
    // El orden refleja los datos del negocio: 85% de las fichas tiene teléfono
    // capturado y solo 16% un correo real.
    expect(planChannel(true, true)).toEqual({ first: "sms", fallbackEmail: true });
  });

  it("solo teléfono → SMS sin red", () => {
    expect(planChannel(true, false)).toEqual({ first: "sms", fallbackEmail: false });
  });

  it("solo correo → correo (por eso no se elimina ese canal)", () => {
    expect(planChannel(false, true)).toEqual({ first: "email", fallbackEmail: false });
  });

  it("sin ningún canal → respaldo de WhatsApp", () => {
    expect(planChannel(false, false)).toEqual({ first: "none", fallbackEmail: false });
  });

  it("prefer:'email' fuerza el correo aunque haya teléfono", () => {
    // El cliente que cambió de número: el SMS se entregó a una línea que ya no
    // es suya, así que el envío "salió bien" y la cascada no lo rescataría.
    expect(planChannel(true, true, "email")).toEqual({ first: "email", fallbackEmail: false });
  });

  it("prefer:'email' se ignora si no hay correo, en vez de dejarlo sin nada", () => {
    expect(planChannel(true, false, "email")).toEqual({ first: "sms", fallbackEmail: false });
  });
});

describe("alternateChannel (qué ofrecer en pantalla)", () => {
  it("tras un SMS ofrece el correo si lo hay", () => {
    expect(alternateChannel("sms", true, true)).toBe("email");
    expect(alternateChannel("sms", true, false)).toBeUndefined();
  });

  it("tras un correo ofrece el SMS si hay teléfono", () => {
    expect(alternateChannel("email", true, true)).toBe("sms");
    expect(alternateChannel("email", false, true)).toBeUndefined();
  });

  it("sin canal usado no ofrece nada", () => {
    expect(alternateChannel("none", true, true)).toBeUndefined();
  });
});

describe("alternateChannel: no ofrecer un canal roto", () => {
  it("si se usó el correo PORQUE el SMS falló, no se ofrece SMS", () => {
    // El llamador pasa `hasSmsTarget: false` cuando el intento de SMS falló:
    // ofrecerlo mandaría al cliente a repetir el canal roto y a quemar otro
    // crédito del número.
    expect(alternateChannel("email", false, true)).toBeUndefined();
  });

  it("pero sí se ofrece si el SMS nunca se intentó", () => {
    expect(alternateChannel("email", true, true)).toBe("sms");
  });
});
