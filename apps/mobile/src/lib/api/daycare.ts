import { ENDPOINTS } from "@/constants/api";
import type { Reservation } from "@holidoginn/shared";
import { apiFetch } from "./client";
import type { HomeDeliveryInput } from "./types";

// ─── Guardería (DAYCARE, día completo cobrado por hora) ──

export type DaycareAvailability = {
  date: string;
  maxCapacity: number;
  occupied: number;
  remaining: number;
  openHour: number;
  closeHour: number;
  lateToleranceMin: number;
  minHours: number;
  hourPrice: number;
};

export const getDaycareAvailability = (date: string) =>
  apiFetch<DaycareAvailability>(
    `${ENDPOINTS.daycare}/availability?date=${encodeURIComponent(date)}`,
  );

export const createDaycareIntent = (data: {
  petIds: string[];
  date: string; // "YYYY-MM-DD" (día local del hotel)
  checkInTime: string; // "HH:mm"
  checkOutTime: string; // "HH:mm"
  notes?: string;
  homeDelivery?: HomeDeliveryInput;
  discountCode?: string;
}) =>
  apiFetch<{
    // Ambos null cuando el saldo a favor cubre el total (sin cargo Stripe).
    clientSecret: string | null;
    paymentIntentId: string | null;
    coveredByCredit: boolean;
    creditApplied: number;
    hours: number;
    hourPrice: number;
    subtotal: number;
    discountTotal: number;
    discountCode: string | null;
    deliveryFee: number;
    deliveryDistanceKm: number;
    deliveryActive: boolean;
    total: number;
  }>(`${ENDPOINTS.daycare}/create-intent`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const confirmDaycare = (data: {
  // Null en el flujo 100% crédito: se mandan los campos eco y el servidor
  // re-valida todo (mismo contrato que confirmBath).
  paymentIntentId: string | null;
  petIds?: string[];
  date?: string;
  checkInTime?: string;
  checkOutTime?: string;
  notes?: string;
  homeDelivery?: HomeDeliveryInput;
  discountCode?: string;
}) =>
  apiFetch<{
    success: boolean;
    reservations: Reservation[];
    groupId: string | null;
    grandTotal?: number;
    hours?: number;
  }>(`${ENDPOINTS.daycare}/confirm`, {
    method: "POST",
    body: JSON.stringify(data),
  });
