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

  // eslint-disable-next-line no-console
  console.error(`[pago:${context}] PaymentSheet error`, {
    code: payError.code,
    declineCode: payError.declineCode,
    stripeErrorCode: payError.stripeErrorCode,
    type: payError.type,
    message: payError.message,
    localizedMessage: payError.localizedMessage,
  });

  const detail = payError.declineCode || payError.code;
  Alert.alert(
    "Error de pago",
    detail ? `${payError.message}\n\n(código: ${detail})` : payError.message
  );
  return true;
}
