import { describe, expect, it } from "vitest";

import { pickSmsTarget } from "./claimSms";

const ficha = (phone: string | null) => ({ phone });

describe("pickSmsTarget", () => {
  it("una ficha con teléfono → ése", () => {
    expect(pickSmsTarget([ficha("6621234567")], "6621234567")).toEqual({
      ok: true,
      e164: "+526621234567",
    });
  });

  it("fichas duplicadas con el mismo número en formatos distintos → un solo SMS", () => {
    // El caso normal de un duplicado: la misma persona capturada tres veces.
    // Se paga un mensaje, y el reto cubre las tres fichas.
    const r = pickSmsTarget(
      [ficha("6621234567"), ficha("(662) 123-4567"), ficha("+52 662 123 4567")],
      "6621234567",
    );
    expect(r).toEqual({ ok: true, e164: "+526621234567" });
  });

  it("varios números distintos: gana el que el cliente tecleó", () => {
    const r = pickSmsTarget([ficha("6621234567"), ficha("6629998888")], "6629998888");
    expect(r).toEqual({ ok: true, e164: "+526629998888" });
  });

  it("varios números y ninguno coincide → no se manda nada", () => {
    // Pasa al buscar por correo: pueden ser personas distintas, y mandarle un
    // SMS pagado al teléfono de un tercero es justo lo que hay que evitar.
    const r = pickSmsTarget([ficha("6621234567"), ficha("6629998888")], null);
    expect(r).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("sin teléfono → no-phone", () => {
    expect(pickSmsTarget([ficha(null), ficha(null)], "6621234567")).toEqual({
      ok: false,
      reason: "no-phone",
    });
    expect(pickSmsTarget([], "6621234567")).toEqual({ ok: false, reason: "no-phone" });
  });

  it("teléfono que no se puede interpretar → unusable, no un número inventado", () => {
    expect(pickSmsTarget([ficha("21053")], null)).toEqual({ ok: false, reason: "unusable" });
  });

  it("ignora las fichas sin teléfono si otra sí lo tiene", () => {
    const r = pickSmsTarget([ficha(null), ficha("6621234567")], "6621234567");
    expect(r).toEqual({ ok: true, e164: "+526621234567" });
  });
});
