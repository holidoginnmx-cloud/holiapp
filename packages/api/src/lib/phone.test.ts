import { describe, expect, it } from "vitest";

import { normalizePhone, toE164 } from "./phone";

describe("normalizePhone (comparar fichas)", () => {
  it("se queda con los últimos 10 dígitos, venga como venga", () => {
    expect(normalizePhone("6621234567")).toBe("6621234567");
    expect(normalizePhone("(662) 123-4567")).toBe("6621234567");
    expect(normalizePhone("+52 662 123 4567")).toBe("6621234567");
    expect(normalizePhone("044 662 123 4567")).toBe("6621234567");
  });

  it("null cuando no alcanzan 10 dígitos", () => {
    expect(normalizePhone("12345678")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("toE164 (marcar, no comparar)", () => {
  it("10 dígitos pelones = nacional MX, que es como captura el equipo", () => {
    expect(toE164("6621234567")).toBe("+526621234567");
    expect(toE164("(662) 123-4567")).toBe("+526621234567");
    expect(toE164(" 662 123 4567 ")).toBe("+526621234567");
  });

  it("respeta la lada de un número extranjero en vez de volverlo mexicano", () => {
    // ÉSTE es el caso que evita el daño: con normalizePhone, "+16025551234"
    // quedaría como "+526025551234" — un móvil mexicano de un desconocido, y
    // ahí le llegaría el código de la ficha de otro. En la base de producción
    // hay al menos una ficha con prefijo internacional.
    expect(toE164("+1 602 555 1234")).toBe("+16025551234");
    expect(toE164("0016025551234")).toBe("+16025551234");
    expect(toE164("0034911223344")).toBe("+34911223344");
  });

  it("«1» + 10 dígitos SIN lada explícita no se manda: es ambiguo", () => {
    // "16621234567" es a la vez el formato NANP y el mexicano viejo (el mismo
    // "1" que usa WhatsApp). Adivinar mal manda el código de una ficha a un
    // desconocido en otro país, así que no se adivina: quien sea de fuera se
    // captura con su lada y entra por la otra rama.
    expect(toE164("16621234567")).toBeNull();
    expect(toE164("16025551234")).toBeNull();
    expect(toE164("+1 662 123 4567")).toBe("+16621234567"); // con "+" sí
  });

  it("«+52 1 662…» es México con el 1 viejo, no un número de 13 dígitos", () => {
    // Si no se colapsa, la misma persona capturada en dos formatos produce dos
    // E.164 distintos, se ven como personas distintas y no se manda nada.
    expect(toE164("+52 1 662 123 4567")).toBe("+526621234567");
    expect(toE164("+5216621234567")).toBe("+526621234567");
    expect(toE164("005216621234567")).toBe("+526621234567");
    expect(toE164("+5216621234567")).toBe(toE164("6621234567"));
  });

  it("entiende las formas mexicanas con lada", () => {
    expect(toE164("526621234567")).toBe("+526621234567");
    expect(toE164("5216621234567")).toBe("+526621234567"); // el "1" de WhatsApp
    expect(toE164("+52 662 123 4567")).toBe("+526621234567");
    expect(toE164("044 662 123 4567")).toBe("+526621234567");
    expect(toE164("01 662 123 4567")).toBe("+526621234567");
  });

  it("devuelve null antes que adivinar", () => {
    expect(toE164("66212345678")).toBeNull(); // 11 dígitos, ambiguo
    expect(toE164("21053")).toBeNull();
    expect(toE164("123")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164("no es un teléfono")).toBeNull();
  });

  it("lo que devuelve siempre es E.164 válido", () => {
    const casos = ["6621234567", "+1 602 555 1234", "5216621234567", "0034911223344", "+5216621234567"];
    for (const c of casos) expect(toE164(c)).toMatch(/^\+[1-9]\d{7,14}$/);
  });
});
