import { useCallback, useEffect, useRef, useState } from "react";
import { PendingConfirmationNotice } from "@/components/PendingConfirmationNotice";
import {
  clearPendingConfirmation,
  describeConfirmError,
  newPendingId,
  postConfirmation,
  readPendingConfirmation,
  runConfirmation,
  savePendingConfirmation,
  subscribePendingConfirmation,
  type PendingConfirmation,
  type PendingFlow,
} from "@/lib/pendingConfirmation";
import type { PaymentFlow } from "@/lib/telemetry";

/**
 * Confirmación con red de seguridad para los seis flujos de pago.
 *
 * Uso, justo después de que `checkout.run()` devolvió "paid":
 *
 *   const result = await pending.confirm({
 *     paymentIntentId,
 *     request: { path: "/reservations/multi", payload: body },
 *   });
 *
 * Si el POST falla, `confirm` lanza `PendingConfirmationError` y el hook deja
 * en pantalla `pending.notice` ("Tu pago se recibió…" + Reintentar). El caller
 * solo tiene que salir sin mostrar "Error". Mientras `pending.hasPending` sea
 * true, el botón de pagar de esa pantalla debe ir deshabilitado: pagar otra vez
 * sería cobrar dos veces.
 *
 * Si al montar ya hay un registro guardado para este flujo (la app se cerró a
 * medio confirmar y la recuperación al arrancar no lo logró), el aviso aparece
 * solo, y `onConfirmed` corre cuando el reintento por fin sale.
 */

export class PendingConfirmationError extends Error {
  record: PendingConfirmation;
  cause: unknown;
  constructor(record: PendingConfirmation, cause: unknown) {
    super("La confirmación quedó pendiente");
    this.name = "PendingConfirmationError";
    this.record = record;
    this.cause = cause;
  }
}

type ConfirmInput<T> = {
  paymentIntentId: string;
  /** Cuerpo serializable del POST: se persiste y se reenvía tal cual. */
  request?: { path: string; payload: Record<string, unknown> };
  /** Alternativa cuando el cuerpo no es serializable: se reintenta solo en sesión. */
  run?: () => Promise<T>;
};

type Job<T> = {
  record: PendingConfirmation;
  execute: () => Promise<T>;
  persisted: boolean;
};

type Options<T> = {
  flow: PendingFlow;
  telemetryFlow: PaymentFlow;
  /** Sin userId no se lee nada guardado: el registro es POR USUARIO. */
  userId: string | null | undefined;
  /** Acota el registro guardado (p. ej. a una reservación concreta). */
  matches?: (record: PendingConfirmation) => boolean;
  /** Qué hacer cuando un reintento desde el aviso confirma. */
  onConfirmed: (result: T, record: PendingConfirmation) => void | Promise<void>;
  /** "tu reservación" (default) | "tu pago". */
  subject?: string;
};

export function usePendingConfirmation<T>(options: Options<T>) {
  const [job, setJob] = useState<Job<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const jobRef = useRef<Job<T> | null>(null);
  const busyRef = useRef(false);
  const inFlightRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setJobState = useCallback((next: Job<T> | null) => {
    jobRef.current = next;
    setJob(next);
  }, []);

  // Registro guardado de este flujo/usuario: se carga al montar y se sigue
  // mientras la pantalla viva (la recuperación al arrancar puede resolverlo
  // por su cuenta y entonces el aviso se quita solo).
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const { userId, flow, matches } = optionsRef.current;
      if (!userId) return;
      const record = await readPendingConfirmation();
      if (!alive || inFlightRef.current || busyRef.current) return;
      const mine =
        !!record &&
        record.userId === userId &&
        record.flow === flow &&
        (!matches || matches(record));
      if (mine) {
        if (jobRef.current?.record.id === record.id) return;
        setJobState({
          record,
          execute: () => postConfirmation<T>(record),
          persisted: true,
        });
        setLastError(null);
      } else if (jobRef.current?.persisted) {
        setJobState(null);
        setLastError(null);
      }
    };
    void sync();
    const unsubscribe = subscribePendingConfirmation(() => void sync());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [options.userId, options.flow, setJobState]);

  const confirm = useCallback(
    async (input: ConfirmInput<T>): Promise<T> => {
      const { flow, telemetryFlow, userId } = optionsRef.current;
      const record: PendingConfirmation = {
        id: newPendingId(),
        flow,
        telemetryFlow,
        paymentIntentId: input.paymentIntentId,
        path: input.request?.path ?? null,
        payload: input.request?.payload ?? {},
        userId: userId ?? "",
        createdAt: Date.now(),
      };
      const execute = input.run
        ? () => runConfirmation<T>(record, input.run!)
        : () => postConfirmation<T>(record);

      inFlightRef.current = true;
      // ANTES del POST: si la app muere a media petición, el registro ya está.
      const persisted = userId ? await savePendingConfirmation(record) : false;
      try {
        const result = await execute();
        setJobState(null);
        setLastError(null);
        return result;
      } catch (err) {
        const info = describeConfirmError(err);
        setJobState({ record, execute, persisted });
        setLastError(info.permanent ? info.detail : null);
        throw new PendingConfirmationError(record, err);
      } finally {
        inFlightRef.current = false;
      }
    },
    [setJobState],
  );

  const retry = useCallback(async () => {
    const current = jobRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await current.execute();
      setJobState(null);
      setLastError(null);
      await optionsRef.current.onConfirmed(result, current.record);
    } catch (err) {
      const info = describeConfirmError(err);
      setLastError(info.permanent ? info.detail : null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [setJobState]);

  // Cuando el servidor rechazó el cuerpo de forma permanente (400/409: se
  // acabó el cuarto o el horario entre el cobro y la confirmación), reintentar
  // igual no va a servir. "Entendido" suelta el registro y libera el botón de
  // pagar de este flujo; el cobro ya quedó en la telemetría y en Stripe para
  // que el equipo lo resuelva.
  const dismiss = useCallback(async () => {
    const current = jobRef.current;
    if (!current || busyRef.current) return;
    await clearPendingConfirmation(current.record.id);
    setJobState(null);
    setLastError(null);
  }, [setJobState]);

  const notice = job ? (
    <PendingConfirmationNotice
      busy={busy}
      persisted={job.persisted}
      subject={options.subject}
      lastError={lastError}
      onRetry={retry}
      onDismiss={lastError ? dismiss : undefined}
    />
  ) : null;

  return {
    confirm,
    retry,
    notice,
    hasPending: job !== null,
    pending: job?.record ?? null,
  };
}
