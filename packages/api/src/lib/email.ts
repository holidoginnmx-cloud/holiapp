import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM || "HolidogInn <hola@holidoginn.com>";

// Lazy singleton: solo instanciar si hay API key
let resend: Resend | null = null;
function getResend(): Resend | null {
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

// Wrapper tolerante a fallas: si Resend no está configurado o falla, se loguea y
// se sigue adelante. La comunicación por correo es importante pero nunca debe
// romper el flujo transaccional (crear reserva, cobrar, reembolsar).
export async function sendEmail(args: SendArgs): Promise<void> {
  const client = getResend();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY no configurada — se omite envío a ${args.to}`);
    return;
  }
  try {
    const { error } = await client.emails.send({
      from: fromAddress,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (error) {
      console.error(`[email] Resend error a ${args.to}:`, error);
    }
  } catch (err) {
    console.error(`[email] Excepción enviando a ${args.to}:`, err);
  }
}

const mx = (n: number) =>
  `$${n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const esDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const layout = (title: string, bodyHtml: string): string => `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f6f6;color:#222;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="font-size:22px;font-weight:700;color:#3a7cab;margin-bottom:24px;">🐾 HolidogInn</div>
      ${bodyHtml}
    </div>
    <div style="font-size:12px;color:#888;text-align:center;margin-top:24px;line-height:1.5;">
      HolidogInn · Hermosillo, Sonora<br>
      Este correo se envió porque tienes una cuenta activa en la app.<br>
      Si tienes dudas sobre el uso de tus datos, consulta nuestro aviso de privacidad.
    </div>
  </div>
</body>
</html>`;

// ─── Templates ─────────────────────────────────────────────────

export type ReservationConfirmedData = {
  ownerFirstName: string;
  petNames: string[];
  checkIn: Date | string;
  checkOut: Date | string;
  roomName: string | null;
  totalAmount: number;
  paymentType: "FULL" | "DEPOSIT";
  remainingAmount: number;
};

export function reservationConfirmedTemplate(d: ReservationConfirmedData) {
  const pets = d.petNames.length === 1 ? d.petNames[0] : d.petNames.join(", ");
  const subject =
    d.petNames.length === 1
      ? `Reservación confirmada para ${pets} 🐕`
      : `Reservación confirmada para ${d.petNames.length} mascotas 🐕`;
  const deposit =
    d.paymentType === "DEPOSIT"
      ? `<p style="margin:16px 0;padding:12px;background:#fff6e5;border-radius:8px;font-size:14px;">
          Pagaste el anticipo del 20%. Te recordaremos liquidar el saldo restante de
          <b>${mx(d.remainingAmount)}</b> antes del check-in.
        </p>`
      : "";
  const html = layout(
    subject,
    `
    <h1 style="font-size:20px;margin:0 0 12px;">¡Listo, ${d.ownerFirstName}!</h1>
    <p style="font-size:15px;line-height:1.5;">
      La estancia de <b>${pets}</b> está confirmada. Nuestro equipo se prepara para recibir a tu familia peluda.
    </p>
    <table role="presentation" style="width:100%;margin:16px 0;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#666;">Check-in</td><td style="padding:8px 0;text-align:right;"><b>${esDate(d.checkIn)}</b></td></tr>
      <tr><td style="padding:8px 0;color:#666;">Check-out</td><td style="padding:8px 0;text-align:right;"><b>${esDate(d.checkOut)}</b></td></tr>
      ${d.roomName ? `<tr><td style="padding:8px 0;color:#666;">Cuarto</td><td style="padding:8px 0;text-align:right;"><b>${d.roomName}</b></td></tr>` : ""}
      <tr><td style="padding:8px 0;color:#666;">Total</td><td style="padding:8px 0;text-align:right;"><b>${mx(d.totalAmount)}</b></td></tr>
    </table>
    ${deposit}
    <p style="font-size:14px;color:#666;line-height:1.5;">
      Durante la estancia vas a recibir fotos, videos y un reporte diario del equipo HDI.
      Entra a la app para ver todo en vivo.
    </p>
  `
  );
  const text = `¡Listo, ${d.ownerFirstName}! La reservación para ${pets} está confirmada.\n\nCheck-in: ${esDate(d.checkIn)}\nCheck-out: ${esDate(d.checkOut)}\nTotal: ${mx(d.totalAmount)}${d.paymentType === "DEPOSIT" ? `\nSaldo pendiente: ${mx(d.remainingAmount)}` : ""}\n\n— HolidogInn`;
  return { subject, html, text };
}

export type PaymentReceivedData = {
  ownerFirstName: string;
  amount: number;
  petName: string;
  method: "CARD" | "CASH" | "TRANSFER" | "STRIPE";
  reservationStatus: string;
};

export function paymentReceivedTemplate(d: PaymentReceivedData) {
  const methodLabel: Record<PaymentReceivedData["method"], string> = {
    CARD: "tarjeta",
    STRIPE: "tarjeta",
    CASH: "efectivo",
    TRANSFER: "transferencia",
  };
  const subject = `Pago recibido — ${mx(d.amount)}`;
  const html = layout(
    subject,
    `
    <h1 style="font-size:20px;margin:0 0 12px;">Pago registrado ✅</h1>
    <p style="font-size:15px;line-height:1.5;">
      Hola ${d.ownerFirstName}, recibimos tu pago de <b>${mx(d.amount)}</b> por ${methodLabel[d.method]} para la estancia de <b>${d.petName}</b>.
    </p>
    <p style="font-size:14px;color:#666;line-height:1.5;">
      Puedes ver el detalle y el historial completo en la app.
    </p>
  `
  );
  const text = `Hola ${d.ownerFirstName}, recibimos tu pago de ${mx(d.amount)} por ${methodLabel[d.method]} para la estancia de ${d.petName}.\n\n— HolidogInn`;
  return { subject, html, text };
}

export type RefundIssuedData = {
  ownerFirstName: string;
  amount: number;
  petName: string;
  channel: "STRIPE" | "CREDIT";
};

export function refundIssuedTemplate(d: RefundIssuedData) {
  const subject =
    d.channel === "STRIPE"
      ? `Reembolso procesado — ${mx(d.amount)}`
      : `Saldo a favor acreditado — ${mx(d.amount)}`;
  const channelLine =
    d.channel === "STRIPE"
      ? `Se procesó un reembolso de <b>${mx(d.amount)}</b> a tu tarjeta. Puede tardar entre 3 y 10 días hábiles en reflejarse.`
      : `Se acreditaron <b>${mx(d.amount)}</b> a tu saldo a favor HDI. Lo puedes usar en tu próxima reservación.`;
  const html = layout(
    subject,
    `
    <h1 style="font-size:20px;margin:0 0 12px;">${d.channel === "STRIPE" ? "Reembolso 💳" : "Saldo a favor 💰"}</h1>
    <p style="font-size:15px;line-height:1.5;">
      Hola ${d.ownerFirstName}, por la cancelación de la estancia de <b>${d.petName}</b>:
    </p>
    <p style="font-size:15px;line-height:1.5;padding:12px;background:#f0f7ff;border-radius:8px;">
      ${channelLine}
    </p>
  `
  );
  const text = `Hola ${d.ownerFirstName}, por la cancelación de la estancia de ${d.petName}, ${
    d.channel === "STRIPE"
      ? `se procesó un reembolso de ${mx(d.amount)} a tu tarjeta (3-10 días hábiles en reflejarse).`
      : `se acreditaron ${mx(d.amount)} a tu saldo a favor HDI.`
  }\n\n— HolidogInn`;
  return { subject, html, text };
}

export type PaymentFailedData = {
  ownerFirstName: string;
  petName: string | null;
};

export function paymentFailedTemplate(d: PaymentFailedData) {
  const subject = "Hubo un problema con tu pago";
  const html = layout(
    subject,
    `
    <h1 style="font-size:20px;margin:0 0 12px;">Pago no completado ⚠️</h1>
    <p style="font-size:15px;line-height:1.5;">
      Hola ${d.ownerFirstName}, no pudimos procesar tu último pago${d.petName ? ` para la estancia de <b>${d.petName}</b>` : ""}.
    </p>
    <p style="font-size:14px;color:#666;line-height:1.5;">
      Abre la app y vuelve a intentarlo. Si necesitas ayuda, contáctanos por WhatsApp.
    </p>
  `
  );
  const text = `Hola ${d.ownerFirstName}, no pudimos procesar tu pago${d.petName ? ` para ${d.petName}` : ""}. Abre la app e intenta de nuevo.\n\n— HolidogInn`;
  return { subject, html, text };
}
