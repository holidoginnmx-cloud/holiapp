import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimCodeSms, sendSms } from "./sms";

const ENV = { ...process.env };

function conCredenciales() {
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "token-falso";
  process.env.TWILIO_SMS_FROM = "+15005550006";
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  delete process.env.SMS_ENABLED;
}

beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_SMS_FROM;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  delete process.env.SMS_ENABLED;
  vi.restoreAllMocks();
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("sendSms: se niega antes de gastar una llamada", () => {
  it("sin credenciales no toca la red", async () => {
    // Importa: así el despliegue del API antes de configurar Twilio se comporta
    // exactamente como hoy, en vez de romperse.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await sendSms({ to: "+526621234567", body: "hola" });
    expect(r).toEqual({ ok: false, reason: "not-configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("SMS_ENABLED=0 es el interruptor de pánico", async () => {
    conCredenciales();
    process.env.SMS_ENABLED = "0";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await sendSms({ to: "+526621234567", body: "hola" });
    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("un destino que no es E.164 no se intenta", async () => {
    conCredenciales();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const malo of ["6621234567", "+0123456", "", "whatsapp:+52662"]) {
      expect(await sendSms({ to: malo, body: "x" })).toEqual({ ok: false, reason: "bad-number" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendSms: llamada a Twilio", () => {
  it("arma bien la petición", async () => {
    conCredenciales();
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ sid: "SM123", status: "queued" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const r = await sendSms({ to: "+526621234567", body: "codigo 123456" });
    expect(r).toEqual({ ok: true, sid: "SM123" });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("ACtest:token-falso").toString("base64")}`,
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get("To")).toBe("+526621234567");
    expect(body.get("From")).toBe("+15005550006");
    expect(body.get("Body")).toBe("codigo 123456");
  });

  it("con Messaging Service manda ese id en vez de From", async () => {
    conCredenciales();
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG123";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendSms({ to: "+526621234567", body: "x" });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("MessagingServiceSid")).toBe("MG123");
    expect(body.get("From")).toBeNull();
  });
});

describe("sendSms: fallos", () => {
  it("4xx = rechazo del destino (STOP, no es móvil…)", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ code: 21610, message: "unsubscribed" }), { status: 400 }),
    );
    expect(await sendSms({ to: "+526621234567", body: "x" })).toEqual({
      ok: false,
      reason: "rejected",
      detail: "21610",
    });
  });

  it("5xx = problema del proveedor", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 503 }));
    const r = await sendSms({ to: "+526621234567", body: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("provider-error");
  });

  it("status failed en un 2xx también cuenta como rechazo", async () => {
    conCredenciales();
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ sid: "SM1", status: "failed" }), { status: 201 }),
    );
    const r = await sendSms({ to: "+526621234567", body: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });

  it("si la red truena NO lanza: devuelve el fallo", async () => {
    // El lookup responde en línea al cliente; una excepción aquí lo tumbaría.
    conCredenciales();
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });
    const r = await sendSms({ to: "+526621234567", body: "x" });
    expect(r).toEqual({ ok: false, reason: "network" });
  });
});

describe("claimCodeSms", () => {
  const txt = claimCodeSms({ code: "483920", minutes: 10 });

  it("cabe en un solo segmento y es ASCII puro", () => {
    // Un solo carácter fuera de GSM-7 (un acento, un emoji) parte el mensaje a
    // 70 caracteres por segmento = pagar doble por lo mismo.
    expect(txt).toMatch(/^[\x20-\x7E]+$/);
    expect(txt.length).toBeLessThanOrEqual(160);
  });

  it("trae el negocio, el código seguido y la vigencia", () => {
    expect(txt).toContain("HolidogInn");
    expect(txt).toContain("483920");
    expect(txt).toContain("10 min");
    // "codigo" + 6 dígitos seguidos = lo que busca el autofill de iOS.
    expect(txt).toMatch(/codigo[^0-9]*483920/);
  });
});
