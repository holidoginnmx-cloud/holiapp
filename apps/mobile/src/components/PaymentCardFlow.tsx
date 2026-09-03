import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePaymentCheckout } from "@/hooks/usePaymentCheckout";
import {
  usePendingConfirmation,
  PendingConfirmationError,
} from "@/hooks/usePendingConfirmation";
import { useAuthStore } from "@/store/authStore";
import type { PaymentFlow } from "@/lib/telemetry";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { COLORS } from "@/constants/colors";
import {
  createExtrasPaymentIntent,
  confirmExtrasPayment,
  chooseExtrasPayOnPickup,
  changeRequestPayNowIntent,
  changeRequestPayNowConfirm,
  changeRequestPayOnPickup,
  type ReservationAddonWithVariant,
  type ChangeRequest,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { styles } from "@/styles/paymentCardStyles";

/**
 * Tarjeta unificada de cobro de saldo pendiente. Fusiona la lógica idéntica de
 * pago (Stripe PaymentSheet + "pagar al recoger") que antes estaba duplicada en
 * BathExtrasPaymentCard y ExtensionPaymentCard (~70% común). La presentación
 * difiere por tipo (`kind`): el baño muestra desglose deslanado/corte, la
 * extensión muestra el monto en el encabezado. Los endpoints y las claves de
 * invalidación se seleccionan por `kind`; la salida visible es idéntica a las
 * tarjetas previas.
 */
type PaymentCardFlowProps =
  | { kind: "bath"; reservationId: string; addon: ReservationAddonWithVariant }
  | {
      kind: "extension";
      reservationId: string;
      changeRequest: ChangeRequest;
    };

type Phase = "hidden" | "pending" | "pickup" | "paid";

type FlowConfig = {
  amount: number;
  phase: Phase;
  /** Flujo para la telemetría y el mensaje de error del cobro. */
  errorTag: string;
  createIntent: () => Promise<{ clientSecret: string; paymentIntentId: string }>;
  confirm: (paymentIntentId: string) => Promise<unknown>;
  /**
   * Versión serializable de `confirm` (ruta + cuerpo). Si viene, la
   * confirmación se persiste y se reintenta también al abrir la app; si no,
   * solo se reintenta en sesión con el mismo PaymentIntent. Solo se declara
   * para endpoints que sabemos idempotentes por PaymentIntent.
   */
  pending?: {
    path: string;
    payload: (paymentIntentId: string) => Record<string, unknown>;
  };
  payOnPickupApi: () => Promise<unknown>;
  invalidateKeys: QueryKey[];
  // Presentación
  pendingIcon: keyof typeof Ionicons.glyphMap;
  pendingTitle: string;
  pendingSubtitle: string;
  pendingHint: string;
  paidTitle: string;
  pickupSubtitlePrefix: string;
  showHeaderPrice: boolean;
  breakdown: { deslanado: number | null; corte: number | null } | null;
};

function buildConfig(props: PaymentCardFlowProps): FlowConfig {
  if (props.kind === "bath") {
    const { reservationId, addon } = props;
    const status = addon.extraPaymentStatus;
    const price = addon.extraPrice ? Number(addon.extraPrice) : 0;
    const deslanado = addon.extraDeslanadoPrice
      ? Number(addon.extraDeslanadoPrice)
      : null;
    const corte = addon.extraCortePrice ? Number(addon.extraCortePrice) : null;
    const hasBreakdown = deslanado !== null || corte !== null;

    const phase: Phase =
      !addon.extraPrice || !status
        ? "hidden"
        : status === "PAID"
          ? "paid"
          : status === "PAY_ON_PICKUP"
            ? "pickup"
            : "pending";

    return {
      amount: price,
      phase,
      errorTag: "bath-extras",
      createIntent: () => createExtrasPaymentIntent(reservationId, addon.id),
      confirm: (paymentIntentId) =>
        confirmExtrasPayment(reservationId, addon.id, paymentIntentId),
      // `extras/confirm` responde `success` si el add-on ya está PAID: es
      // seguro reenviarlo tal cual al abrir la app.
      pending: {
        path: `/reservations/${reservationId}/addons/${addon.id}/extras/confirm`,
        payload: (paymentIntentId) => ({ paymentIntentId }),
      },
      payOnPickupApi: () => chooseExtrasPayOnPickup(reservationId, addon.id),
      invalidateKeys: [["reservation", reservationId]],
      pendingIcon: "water",
      pendingTitle: "Saldo del baño",
      pendingSubtitle: "Definido por staff según estado del pelaje",
      pendingHint: "Elige cómo pagarlo:",
      paidTitle: `${addon.extraDescription ?? "Extras"} pagado`,
      pickupSubtitlePrefix: addon.extraDescription ?? "Extras",
      showHeaderPrice: false,
      breakdown: hasBreakdown ? { deslanado, corte } : null,
    };
  }

  // kind === "extension"
  const { reservationId, changeRequest } = props;
  const amount = Number(changeRequest.deltaAmount);

  const phase: Phase =
    changeRequest.status !== "APPROVED" || amount <= 0
      ? "hidden"
      : changeRequest.paidAt
        ? "paid"
        : changeRequest.payOnPickup
          ? "pickup"
          : "pending";

  return {
    amount,
    phase,
    errorTag: "extension",
    createIntent: () =>
      changeRequestPayNowIntent(reservationId, changeRequest.id),
    confirm: (paymentIntentId) =>
      changeRequestPayNowConfirm(reservationId, changeRequest.id, paymentIntentId),
    // `pay-now-confirm` responde `alreadyConfirmed` al repetirse: es seguro
    // reenviarlo tal cual al abrir la app.
    pending: {
      path: `/reservations/${reservationId}/change-requests/${changeRequest.id}/pay-now-confirm`,
      payload: (stripePaymentIntentId) => ({ stripePaymentIntentId }),
    },
    payOnPickupApi: () =>
      changeRequestPayOnPickup(reservationId, changeRequest.id),
    invalidateKeys: [
      ["reservation", reservationId, "change-requests"],
      ["reservation", reservationId],
    ],
    pendingIcon: "calendar",
    pendingTitle: "Saldo por extensión",
    pendingSubtitle: "Días extra aprobados por el equipo",
    pendingHint:
      "Tu solicitud de extensión fue aprobada. Elige cómo pagar el saldo:",
    paidTitle: "Extensión pagada",
    pickupSubtitlePrefix: "Saldo de extensión",
    showHeaderPrice: true,
    breakdown: null,
  };
}

export function PaymentCardFlow(props: PaymentCardFlowProps) {
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);

  const cfg = buildConfig(props);
  const { amount } = cfg;
  const checkout = usePaymentCheckout(cfg.errorTag as PaymentFlow);
  const userId = useAuthStore((s) => s.userId);

  const invalidate = () => {
    for (const queryKey of cfg.invalidateKeys) {
      queryClient.invalidateQueries({ queryKey });
    }
  };

  // Red de seguridad: si el confirm falla DESPUÉS de que Stripe cobró, se
  // reintenta con el MISMO PaymentIntent (nunca se crea otro). Con `pending`
  // en la config además se persiste; sin él, solo en sesión.
  const pendingConfirm = usePendingConfirmation<unknown>({
    flow: "card",
    telemetryFlow: cfg.errorTag as PaymentFlow,
    userId,
    matches: (record) => !!cfg.pending && record.path === cfg.pending.path,
    onConfirmed: () => invalidate(),
    subject: "tu pago",
  });

  const pickupMutation = useMutation({
    mutationFn: () => cfg.payOnPickupApi(),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  async function handlePayNow() {
    if (pendingConfirm.hasPending) return;
    setPaying(true);
    try {
      const intent = await cfg.createIntent();
      const outcome = await checkout.run({
        clientSecret: intent.clientSecret,
        paymentIntentId: intent.paymentIntentId,
      });
      if (outcome !== "paid") return;
      const { paymentIntentId } = intent;
      await pendingConfirm.confirm(
        cfg.pending
          ? {
              paymentIntentId,
              request: {
                path: cfg.pending.path,
                payload: cfg.pending.payload(paymentIntentId),
              },
            }
          : { paymentIntentId, run: () => cfg.confirm(paymentIntentId) },
      );
      invalidate();
    } catch (err) {
      // Ya se cobró y el aviso con "Reintentar" está en pantalla.
      if (err instanceof PendingConfirmationError) return;
      const msg =
        err instanceof Error ? err.message : "No se pudo procesar el pago";
      Alert.alert("Error", msg);
    } finally {
      setPaying(false);
    }
  }

  function handlePayOnPickup() {
    Alert.alert(
      "Pagar al recoger",
      `Pagarás ${formatCurrency(amount)} cuando recojas a tu mascota. ¿Confirmas?`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Confirmar", onPress: () => pickupMutation.mutate() },
      ],
    );
  }

  if (cfg.phase === "hidden") return null;

  if (cfg.phase === "paid") {
    return (
      <View style={[styles.card, styles.cardPaid]}>
        <View style={styles.row}>
          <Ionicons
            name="checkmark-circle"
            size={22}
            color={COLORS.successText}
          />
          <Text style={styles.titlePaid}>{cfg.paidTitle}</Text>
        </View>
        <Text style={styles.subtle}>{formatCurrency(amount)} · recibido</Text>
      </View>
    );
  }

  if (cfg.phase === "pickup") {
    return (
      <View style={[styles.card, styles.cardPickup]}>
        <View style={styles.row}>
          <Ionicons name="cash-outline" size={22} color={COLORS.warningText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.titlePickup}>Pagarás al recoger</Text>
            <Text style={styles.subtle}>
              {cfg.pickupSubtitlePrefix} · {formatCurrency(amount)}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // pending
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name={cfg.pendingIcon} size={22} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{cfg.pendingTitle}</Text>
          <Text style={styles.subtitle}>{cfg.pendingSubtitle}</Text>
        </View>
        {cfg.showHeaderPrice && (
          <Text style={styles.price}>{formatCurrency(amount)}</Text>
        )}
      </View>
      {cfg.breakdown && (
        <View style={styles.breakdown}>
          {cfg.breakdown.deslanado !== null && (
            <View style={styles.breakdownRow}>
              <Ionicons
                name="cut-outline"
                size={14}
                color={COLORS.textSecondary}
              />
              <Text style={styles.breakdownLabel}>Deslanado</Text>
              <Text style={styles.breakdownAmount}>
                {formatCurrency(cfg.breakdown.deslanado)}
              </Text>
            </View>
          )}
          {cfg.breakdown.corte !== null && (
            <View style={styles.breakdownRow}>
              <Ionicons name="cut" size={14} color={COLORS.textSecondary} />
              <Text style={styles.breakdownLabel}>Corte</Text>
              <Text style={styles.breakdownAmount}>
                {formatCurrency(cfg.breakdown.corte)}
              </Text>
            </View>
          )}
          <View style={styles.breakdownDivider} />
          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, styles.totalLabel]}>Total</Text>
            <Text style={[styles.breakdownAmount, styles.totalAmount]}>
              {formatCurrency(amount)}
            </Text>
          </View>
        </View>
      )}
      <Text style={styles.hint}>{cfg.pendingHint}</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.btn,
            styles.btnPrimary,
            (paying || pendingConfirm.hasPending) && { opacity: 0.7 },
          ]}
          onPress={handlePayNow}
          disabled={paying || pickupMutation.isPending || pendingConfirm.hasPending}
        >
          {paying ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <>
              <Ionicons name="card" size={16} color={COLORS.white} />
              <Text style={styles.btnPrimaryText}>Pagar ahora</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={handlePayOnPickup}
          // Con un cobro ya hecho y sin confirmar, "pagar al recoger" tampoco
          // tiene sentido: se cobraría dos veces.
          disabled={paying || pickupMutation.isPending || pendingConfirm.hasPending}
        >
          <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
          <Text style={styles.btnSecondaryText}>Pagar al recoger</Text>
        </TouchableOpacity>
      </View>

      {checkout.stuckNotice}
      {pendingConfirm.notice}
    </View>
  );
}
