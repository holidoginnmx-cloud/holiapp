import { Alert } from "react-native";

/**
 * Handle a Stripe PaymentSheet error consistently across all payment screens.
 *
 * Cancelaciones del usuario se ignoran. Para cualquier otro error se registra
 * el detalle completo (code/declineCode/stripeErrorCode/type) en consola — clave
 * para diagnosticar fallos de Apple Pay en producción, donde el `message`
 * genérico no dice nada — y se muestra al usuario el mensaje con su código.
 *
 * Devuelve `true` si fue un error real (el caller debe abortar el flujo),
 * `false` si fue una cancelación.
 */
export function handlePaymentSheetError(payError: any, context: string): boolean {
  if (!payError) return false;
  if (payError.code === "Canceled") return false;

  if (__DEV__) {
    console.error(`[pago:${context}] PaymentSheet error`, {
      code: payError.code,
      declineCode: payError.declineCode,
      stripeErrorCode: payError.stripeErrorCode,
      type: payError.type,
      message: payError.message,
      localizedMessage: payError.localizedMessage,
    });
  }

  const { title, body } = friendlyMessage(payError);
  Alert.alert(title, body);
  return true;
}

/**
 * Traduce el error crudo de Stripe a un mensaje claro en español. Los rechazos
 * del emisor (declineCode / card_declined) son los más comunes en producción y
 * merecen un texto accionable; el resto cae en un genérico con el código.
 */
function friendlyMessage(payError: any): { title: string; body: string } {
  const decline: string | undefined = payError.declineCode;
  const code: string | undefined = payError.stripeErrorCode || payError.code;

  // Rechazos del banco emisor.
  if (decline === "insufficient_funds") {
    return {
      title: "Pago rechazado",
      body: "Tu tarjeta no tiene fondos suficientes. Intenta con otra tarjeta.",
    };
  }
  if (decline === "expired_card") {
    return {
      title: "Pago rechazado",
      body: "Tu tarjeta está vencida. Intenta con otra tarjeta.",
    };
  }
  if (decline || code === "card_declined") {
    return {
      title: "Tu banco rechazó el pago",
      body:
        "El banco que emitió tu tarjeta rechazó el cobro. Comunícate con tu banco para autorizar la compra (o habilitar compras por internet) o intenta con otra tarjeta.",
    };
  }

  // Genérico, conservando el código para diagnóstico.
  const detail = decline || code;
  return {
    title: "Error de pago",
    body: detail ? `${payError.message}\n\n(código: ${detail})` : payError.message,
  };
}
