import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { useStripe, PaymentIntent } from "@stripe/stripe-react-native";
import { COLORS } from "@/constants/colors";
import { PaymentStuckNotice } from "@/components/PaymentStuckNotice";
import { handlePaymentSheetError } from "@/lib/paymentError";
import { waitForNoPresentedModal } from "@/lib/modalPresentation";
import { beginCriticalFlow, endCriticalFlow } from "@/lib/appUpdates";
import { withTimeout } from "@/lib/promiseTimeout";
import {
  startPaymentSession,
  flushPaymentTelemetry,
  type PaymentFlow,
  type PaymentSession,
} from "@/lib/telemetry";

import { mensajeDeError } from "@/lib/errorMessages";
import { alertaDeError } from "@/lib/errorAlert";

/**
 * Cobro con Stripe, con red de seguridad. Único punto por el que pasan los seis
 * flujos de pago de la app.
 *
 * Resuelve dos fallas que dejaban el botón girando para siempre:
 *  1. Presentar la hoja mientras un modal se descarta → la promesa de
 *     `presentPaymentSheet` no resuelve NUNCA. Se evita esperando a que no quede
 *     ningún modal presentado (`waitForNoPresentedModal`).
 *  2. Que aun así se cuelgue. A los 12 s se ofrece una salida en pantalla, que
 *     antes de hacer nada le pregunta a Stripe en qué estado quedó el cobro.
 *
 * Lo que NO hace, a propósito: ponerle un timeout a `presentPaymentSheet`.
 * Abortar mientras el cargo está en vuelo es exactamente cómo se cobra sin crear
 * la reserva. La promesa colgada se abandona; nunca se cancela el PaymentIntent.
 */

const INIT_TIMEOUT_MS = 30_000;

/**
 * Cuánto esperamos a que la hoja dé señales antes de ofrecer salida.
 *
 * El cuelgue es una patología de iOS (view controllers), así que ahí se avisa
 * pronto. En Android la hoja es un bottom sheet que deja ver lo que hay detrás:
 * si avisáramos a los 12 s, quien esté tecleando su tarjeta con calma leería
 * "no te hemos cobrado nada" por detrás del formulario.
 */
const STUCK_AFTER_MS = Platform.OS === "ios" ? 12_000 : 25_000;

/** Sondeo mientras el banco resuelve un cargo en vuelo. */
const PROCESSING_POLL_MS = 3_000;
const PROCESSING_MAX_WAIT_MS = 180_000;

const INIT_TIMEOUT_MESSAGE =
  "No se pudo abrir la ventana de pago. Revisa tu conexión e intenta de nuevo.";

export type CheckoutResult = "paid" | "canceled" | "failed";

type RunOptions = {
  clientSecret: string;
  paymentIntentId?: string | null;
  /** Solo hospedaje personaliza la apariencia; el resto usa la de Stripe. */
  appearance?: Record<string, unknown>;
};

export function usePaymentCheckout(flow: PaymentFlow) {
  const { initPaymentSheet, presentPaymentSheet, retrievePaymentIntent } = useStripe();

  const [stuck, setStuck] = useState<"offer" | "processing" | null>(null);
  const [checking, setChecking] = useState(false);

  const settledRef = useRef(true);
  const resolveRef = useRef<((result: CheckoutResult) => void) | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxRef = useRef<(RunOptions & { session: PaymentSession }) | null>(null);
  const pollingRef = useRef(false);
  /**
   * Generación del cobro. Si el cliente vuelve a intentar (pantalla que se
   * reusa, error y reintento), el sondeo o la hoja del intento ANTERIOR pueden
   * seguir vivos: sin esto resolverían el intento nuevo con el resultado del
   * viejo, que es un cobro atribuido a quien no toca.
   */
  const runIdRef = useRef(0);
  /** Candado contra recargas por OTA mientras hay un cobro en curso. */
  const lockedRef = useRef(false);

  const disarmWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      disarmWatchdog();
      if (lockedRef.current) {
        lockedRef.current = false;
        endCriticalFlow();
      }
    },
    [disarmWatchdog],
  );

  /** Resuelve el cobro una sola vez y limpia todo lo que quedó armado. */
  const settle = useCallback(
    (result: CheckoutResult) => {
      if (settledRef.current) return;
      settledRef.current = true;
      disarmWatchdog();
      setStuck(null);
      setChecking(false);
      const resolve = resolveRef.current;
      resolveRef.current = null;
      // Suelta el candado: ya se puede aplicar una actualización pendiente.
      if (lockedRef.current) {
        lockedRef.current = false;
        endCriticalFlow();
      }
      resolve?.(result);
      // El rastro se manda al final, para no competir por el token de Clerk con
      // las peticiones del propio cobro.
      void flushPaymentTelemetry();
    },
    [disarmWatchdog],
  );

  /** Le pregunta a Stripe en qué quedó el cobro antes de tocar nada. */
  const readStatus = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    try {
      const { paymentIntent, error } = await retrievePaymentIntent(ctx.clientSecret);
      if (error || !paymentIntent) return null;
      return paymentIntent.status;
    } catch {
      return null;
    }
  }, [retrievePaymentIntent]);

  /**
   * Cargo en vuelo: no se toca nada, se espera a que el banco resuelva.
   *
   * Esto NO puede limitarse a pintar el aviso: si la promesa del cobro se queda
   * pendiente, el `finally` del caller nunca apaga el spinner y volvemos al bug
   * que estamos arreglando. Por eso se sondea hasta tener un desenlace.
   */
  const enterProcessing = useCallback(() => {
    setStuck("processing");
    if (pollingRef.current) return;
    pollingRef.current = true;

    void (async () => {
      const session = ctxRef.current?.session;
      const runId = runIdRef.current;
      const stale = () => settledRef.current || runIdRef.current !== runId;
      const deadline = Date.now() + PROCESSING_MAX_WAIT_MS;
      let lastStatus: string | null = null;
      try {
        while (!stale() && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, PROCESSING_POLL_MS));
          if (stale()) return;

          const status = await readStatus();
          // Solo se deja rastro de los cambios: sondear cada 3 s llenaría el
          // buffer de eventos idénticos.
          if (status !== lastStatus) {
            lastStatus = status ?? null;
            session?.track("escape_pi_status", { code: status ?? "unknown" });
          }

          if (
            status === PaymentIntent.Status.Succeeded ||
            status === PaymentIntent.Status.RequiresCapture
          ) {
            return settle("paid");
          }
          if (status === PaymentIntent.Status.Canceled) {
            Alert.alert(
              "Pago cancelado",
              "El cobro no se completó. Vuelve a intentar la reserva.",
            );
            return settle("failed");
          }
          if (
            status === PaymentIntent.Status.RequiresPaymentMethod ||
            status === PaymentIntent.Status.RequiresConfirmation
          ) {
            // El cargo no prosperó y nadie pagó: se puede reintentar sin riesgo.
            return setStuck("offer");
          }
        }

        if (stale()) return;
        Alert.alert(
          "Tu pago sigue en proceso",
          "Tu banco no ha terminado de confirmarlo. No lo intentes de nuevo: escríbenos por WhatsApp y lo revisamos contigo.",
        );
        settle("failed");
      } finally {
        pollingRef.current = false;
      }
    })();
  }, [readStatus, settle]);

  /** Abre la hoja de pago. Se reusa tal cual en el reintento de la salida. */
  const attempt = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { session, clientSecret, paymentIntentId, appearance } = ctx;
    const runId = runIdRef.current;
    const stale = () => settledRef.current || runIdRef.current !== runId;

    const clean = await waitForNoPresentedModal();
    if (stale()) return;
    session.track(clean ? "modal_gate_wait" : "modal_gate_timeout");

    session.track("init_start");
    const { error: initError } = await withTimeout(
      initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "Holidog Inn",
        applePay: { merchantCountryCode: "MX" },
        ...(appearance ? { appearance } : {}),
      } as Parameters<typeof initPaymentSheet>[0]),
      INIT_TIMEOUT_MS,
      INIT_TIMEOUT_MESSAGE,
    );

    if (stale()) return;

    if (initError) {
      session.track("init_error", {
        code: initError.code,
        detail: initError.message,
      });
      alertaDeError(initError);
      return settle("failed");
    }
    session.track("init_ok");

    // A partir de aquí la hoja debería estar en pantalla. Si a los 12 s no
    // resolvió nada, ofrecemos salida — invisible si la hoja sí se abrió.
    disarmWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (stale()) return;
      session.track("stuck_watchdog", {
        paymentIntentId: paymentIntentId ?? undefined,
      });
      setStuck("offer");
    }, STUCK_AFTER_MS);

    session.track("present_called", {
      paymentIntentId: paymentIntentId ?? undefined,
    });
    const { error: payError } = await presentPaymentSheet();

    // Si mientras tanto el cliente usó la salida de emergencia (o arrancó otro
    // cobro), esta respuesta llega tarde y ya no manda.
    if (stale()) return;
    disarmWatchdog();
    setStuck(null);

    if (handlePaymentSheetError(payError, flow)) {
      session.track("present_error", {
        code: payError?.code,
        detail: payError?.message,
      });
      return settle("failed");
    }
    if (payError) {
      session.track("present_canceled");
      return settle("canceled");
    }

    session.track("present_resolved");
    settle("paid");
  }, [
    disarmWatchdog,
    flow,
    initPaymentSheet,
    presentPaymentSheet,
    settle,
  ]);

  /**
   * Cobra. Devuelve "paid" solo si el dinero está; el caller sigue con la
   * creación de la reserva únicamente en ese caso.
   */
  const run = useCallback(
    (options: RunOptions): Promise<CheckoutResult> => {
      const session = startPaymentSession(flow);
      runIdRef.current += 1;
      if (!lockedRef.current) {
        lockedRef.current = true;
        beginCriticalFlow();
      }
      ctxRef.current = { ...options, session };
      settledRef.current = false;
      setStuck(null);
      setChecking(false);

      return new Promise<CheckoutResult>((resolve) => {
        resolveRef.current = resolve;
        attempt().catch((err: any) => {
          const message =
            mensajeDeError(err, "No se pudo abrir la ventana de pago");
          session.track("init_error", { detail: message });
          Alert.alert("Error", message);
          settle("failed");
        });
      });
    },
    [attempt, flow, settle],
  );

  const onRetry = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx || settledRef.current) return;
    setChecking(true);
    ctx.session.track("escape_retry");
    const status = await readStatus();
    ctx.session.track("escape_pi_status", { code: status ?? "unknown" });
    setChecking(false);
    if (settledRef.current) return;

    switch (status) {
      case PaymentIntent.Status.Succeeded:
      case PaymentIntent.Status.RequiresCapture:
        // Ya se cobró: seguir adelante y crear la reserva. Reintentar aquí sería
        // cobrar dos veces.
        return settle("paid");

      case PaymentIntent.Status.Processing:
      case PaymentIntent.Status.RequiresAction:
        return enterProcessing();

      case PaymentIntent.Status.Canceled:
        Alert.alert(
          "Pago cancelado",
          "Este cobro ya no es válido. Vuelve a intentar la reserva.",
        );
        return settle("failed");

      case PaymentIntent.Status.RequiresPaymentMethod:
      case PaymentIntent.Status.RequiresConfirmation:
        // Nadie cobró: es seguro volver a abrir la hoja.
        setStuck(null);
        return attempt().catch((err: any) => {
          const message =
            mensajeDeError(err, "No se pudo abrir la ventana de pago");
          Alert.alert("Error", message);
          settle("failed");
        });

      default:
        // Sin respuesta de Stripe (red). Se deja la oferta en pantalla.
        Alert.alert(
          "Sin conexión",
          "No pudimos confirmar el estado de tu pago. Revisa tu internet e intenta de nuevo.",
        );
        return;
    }
  }, [attempt, enterProcessing, readStatus, settle]);

  const onCancel = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!ctx || settledRef.current) return;
    setChecking(true);
    ctx.session.track("escape_cancel");
    const status = await readStatus();
    ctx.session.track("escape_pi_status", { code: status ?? "unknown" });
    setChecking(false);
    if (settledRef.current) return;

    // Aunque el cliente quiera salir, si el dinero ya salió NO se abandona: se
    // sigue a crear la reserva.
    if (
      status === PaymentIntent.Status.Succeeded ||
      status === PaymentIntent.Status.RequiresCapture
    ) {
      return settle("paid");
    }
    if (
      status === PaymentIntent.Status.Processing ||
      status === PaymentIntent.Status.RequiresAction
    ) {
      return enterProcessing();
    }
    settle("canceled");
  }, [enterProcessing, readStatus, settle]);

  const stuckNotice = stuck ? (
    <PaymentStuckNotice
      kind={stuck}
      busy={checking}
      onRetry={onRetry}
      onCancel={onCancel}
    />
  ) : null;

  return { run, stuckNotice };
}

/** Apariencia de marca de la hoja de pago (la usa el flujo de hospedaje). */
export const HOLIDOG_SHEET_APPEARANCE = {
  colors: {
    primary: COLORS.primary,
    background: COLORS.white,
    componentBackground: COLORS.bgPage,
    primaryText: COLORS.textPrimary,
    secondaryText: COLORS.textSecondary,
  },
  shapes: {
    borderRadius: 12,
    borderWidth: 1,
  },
  primaryButton: {
    colors: {
      background: COLORS.primary,
      text: COLORS.white,
    },
    shapes: {
      borderRadius: 12,
    },
  },
};
