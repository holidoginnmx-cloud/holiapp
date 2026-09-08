/**
 * Envío de SMS transaccional (Twilio). Espejo de `lib/email.ts`, con UNA
 * diferencia deliberada: **aquí el resultado sí se devuelve**.
 *
 * `sendEmail` es mudo a propósito — un correo perdido no puede tumbar una
 * reserva. Con el SMS es al revés: si no sale, al cliente NO se le puede decir
 * "te mandamos un código", porque se quedaría mirando una pantalla que le pide
 * un código que nunca va a llegar. El llamador decide; esta función nunca lanza.
 *
 * Twilio por `fetch` y no por SDK: se usa un solo endpoint, y el build
 * (`build.mjs`) empaqueta con esbuild — meter el SDK sería peso y requires
 * dinámicos a cambio de nada. Mismo enfoque que `lib/maps.ts`.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01/Accounts";

/** Formato internacional: "+" y de 8 a 15 dígitos, sin empezar en 0. */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export type SmsFailure =
  | "disabled" // apagado a mano con SMS_ENABLED=0
  | "not-configured" // faltan credenciales
  | "bad-number" // el destino no es E.164
  | "rejected" // Twilio lo rechazó (STOP, no es móvil, número inválido…)
  | "provider-error" // 5xx de Twilio
  | "network"; // no hubo respuesta

export type SmsResult =
  | { ok: true; sid: string }
  | { ok: false; reason: SmsFailure; detail?: string };

export async function sendSms(args: { to: string; body: string }): Promise<SmsResult> {
  // Interruptor de pánico: apaga los envíos sin borrar credenciales ni
  // desplegar. El flujo cae solo al respaldo de WhatsApp.
  if (process.env.SMS_ENABLED === "0") return { ok: false, reason: "disabled" };

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;
  const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || (!from && !messagingService)) {
    console.warn("[sms] Twilio no configurado — no se envía");
    return { ok: false, reason: "not-configured" };
  }
  if (!E164_RE.test(args.to)) return { ok: false, reason: "bad-number" };

  const form = new URLSearchParams({ To: args.to, Body: args.body });
  // El Messaging Service maneja solo los STOP/opt-out; si no hay, número suelto.
  if (messagingService) form.set("MessagingServiceSid", messagingService);
  else form.set("From", from!);

  try {
    const res = await fetch(`${TWILIO_API}/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      // El lookup responde en línea al cliente: no puede quedarse colgado.
      signal: AbortSignal.timeout(8000),
    });

    const json = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };

    if (!res.ok) {
      // Nunca se loguea el número completo. 21610 = mandó STOP, 21614 = no es móvil.
      console.error("[sms] Twilio", res.status, json?.code, json?.message);
      return {
        ok: false,
        reason: res.status >= 500 ? "provider-error" : "rejected",
        detail: String(json?.code ?? res.status),
      };
    }
    if (json?.status === "failed" || json?.status === "undelivered") {
      return { ok: false, reason: "rejected", detail: json.status };
    }
    return { ok: true, sid: String(json?.sid ?? "") };
  } catch (err) {
    console.error("[sms] excepción enviando:", err);
    return { ok: false, reason: "network" };
  }
}

/**
 * Texto del código de vinculación.
 *
 * Sin acentos, sin emoji y sin links a propósito: basta UN carácter fuera de
 * GSM-7 para que Twilio cambie a UCS-2 y el segmento baje de 160 a 70
 * caracteres, o sea pagar doble por el mismo mensaje.
 *
 * Lleva la palabra "codigo" y los 6 dígitos seguidos para que el autofill de
 * iOS lo detecte (el input ya declara `textContentType="oneTimeCode"`), y abre
 * con el nombre del negocio porque el remitente es un número del proveedor que
 * el cliente no reconoce.
 */
export function claimCodeSms(d: { code: string; minutes: number }): string {
  return `HolidogInn: tu codigo para vincular tu cuenta es ${d.code}. Vence en ${d.minutes} min. Si no lo pediste, ignora este mensaje.`;
}
