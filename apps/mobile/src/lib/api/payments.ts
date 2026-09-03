import { ENDPOINTS } from "@/constants/api";
import type { Payment } from "@holidoginn/shared";
import { apiFetch } from "./client";
import type {
  BathSelectionsByPet,
  MedicationByPet,
  HomeDeliveryInput,
} from "./types";

export const createPaymentIntent = (data: {
  petIds: string[];
  checkIn: string;
  checkOut: string;
  ownerId: string;
  roomPreference: "shared" | "separate";
  paymentType?: "FULL" | "DEPOSIT";
  bathSelectionsByPet?: BathSelectionsByPet;
  medicationByPet?: MedicationByPet;
  homeDelivery?: HomeDeliveryInput;
  discountCode?: string;
}) =>
  apiFetch<{
    // Both null when saldo a favor covered the entire deposit/total — no
    // Stripe charge created.
    clientSecret: string | null;
    paymentIntentId: string | null;
    coveredByCredit: boolean;
    creditApplied: number;
    grandTotal: number;
    depositAmount: number;
    remainingAmount: number;
    depositDeadline: string | null;
    paymentType: string;
    breakdown: { petId: string; petName: string; weight: number; pricePerDay: number; subtotal: number }[];
    bathBreakdown: { petId: string; variantId: string; price: number }[];
    bathTotal: number;
    totalDays: number;
    medicationBreakdown: { petId: string; surcharge: number }[];
    medicationTotal: number;
    deliveryFee: number;
    deliveryDistanceKm: number;
    deliveryActive: boolean;
    discountTotal: number;
    discountCode?: string | null;
  }>(`${ENDPOINTS.payments}/create-intent`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createBalancePayment = (reservationId: string) =>
  apiFetch<{ clientSecret: string; paymentIntentId: string; remaining: number }>(
    `${ENDPOINTS.payments}/pay-balance`,
    { method: "POST", body: JSON.stringify({ reservationId }) }
  );

export const confirmBalancePayment = (reservationId: string, stripePaymentIntentId: string) =>
  apiFetch<{ success: boolean }>(
    `${ENDPOINTS.payments}/confirm-balance`,
    { method: "POST", body: JSON.stringify({ reservationId, stripePaymentIntentId }) }
  );

export const registerManualPayment = (data: {
  reservationId: string;
  amount: number;
  method: "CASH" | "TRANSFER";
  notes?: string;
}) =>
  apiFetch<Payment>("/admin/payments/manual", {
    method: "POST",
    body: JSON.stringify(data),
  });

// ─── Payments ────────────────────────────────────────────
