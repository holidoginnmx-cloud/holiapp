import { beforeAll, describe, expect, it } from "vitest";
import {
  createChallenge,
  createClaimToken,
  maskEmail,
  maskPhone,
  newCode,
  readClaimToken,
  verifyChallenge,
} from "./claimChallenge";

beforeAll(() => {
  process.env.CLAIM_CODE_SECRET = "secreto-de-prueba";
});

describe("reto de claim (código por correo)", () => {
  it("el código correcto abre el reto y devuelve las fichas que cubría", () => {
    const code = newCode();
    expect(code).toMatch(/^\d{6}$/);
    const token = createChallenge("user_1", ["legacy_a", "legacy_b"], code);
    const r = verifyChallenge(token, "user_1", code);
    expect(r).toEqual({ ok: true, ids: ["legacy_a", "legacy_b"] });
  });

  it("un código equivocado no abre nada", () => {
    const token = createChallenge("user_1", ["legacy_a"], "123456");
    expect(verifyChallenge(token, "user_1", "654321")).toEqual({ ok: false, reason: "wrong-code" });
  });

  it("el reto es de quien lo pidió: otra cuenta no puede usarlo aunque tenga el código", () => {
    const token = createChallenge("user_1", ["legacy_a"], "123456");
    expect(verifyChallenge(token, "user_2", "123456")).toEqual({ ok: false, reason: "invalid" });
  });

  it("un reto manipulado (otras fichas) no pasa la firma", () => {
    const token = createChallenge("user_1", ["legacy_a"], "123456");
    const [payload, sig] = token.split(".");
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    obj.ids = ["victima"];
    const forged = `${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${sig}`;
    expect(verifyChallenge(forged, "user_1", "123456")).toEqual({ ok: false, reason: "invalid" });
  });

  it("el token de claim solo sirve a su dueño", () => {
    const t = createClaimToken("user_1", ["legacy_a"]);
    expect(readClaimToken(t, "user_1")).toEqual(["legacy_a"]);
    expect(readClaimToken(t, "user_2")).toBeNull();
    expect(readClaimToken("basura", "user_1")).toBeNull();
  });

  it("enmascara el correo sin revelarlo", () => {
    expect(maskEmail("juan.perez@gmail.com")).toBe("j***z@gmail.com");
    expect(maskEmail("a@x.mx")).toBe("a***@x.mx");
  });
});

describe("maskPhone", () => {
  it("enseña la lada y los ultimos cuatro", () => {
    expect(maskPhone("+526621234567")).toBe("+52 ••• ••• 4567");
    expect(maskPhone("+16025551234")).toBe("+1 ••• ••• 1234");
  });

  it("la lada visible deja notar si asumimos mal el pais", () => {
    // Un cliente de EE.UU. que vea "+52" sabe que su codigo se fue a otro lado
    // y puede avisar, en vez de esperar un SMS que nunca le va a llegar.
    expect(maskPhone("+526025551234")).toContain("+52");
    expect(maskPhone("+526025551234")).not.toContain("+1 ");
  });

  it("no revienta con basura", () => {
    expect(maskPhone("+123")).toBe("***");
    expect(maskPhone("")).toBe("***");
  });
});
