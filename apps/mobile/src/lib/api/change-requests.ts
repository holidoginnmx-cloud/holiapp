import { apiFetch } from "./client";
import type { ReservationDetail } from "./types";

// ─── Change Requests & Credit ─────────────────────────────

export type ChangePreview = {
  newTotalDays: number;
  newTotal: number;
  currentTotal: number;
  delta: number;
  requiresApproval: boolean;
  lastPaymentMethod: "CASH" | "CARD" | "TRANSFER" | "STRIPE" | "CREDIT" | null;
};

export type ChangeRequest = {
  id: string;
  reservationId: string;
  requestedById: string;
  newCheckIn: string;
  newCheckOut: string;
  newTotalDays: number;
  newTotalAmount: string;
  deltaAmount: string;
  refundChoice: "STRIPE_REFUND" | "CREDIT" | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  rejectionReason: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  payOnPickup: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChangeRequestWithReservation = ChangeRequest & {
  reservation: ReservationDetail & {
    owner: { id: string; firstName: string; lastName: string; email: string };
    room: { id: string; name: string } | null;
  };
  requestedBy: { id: string; firstName: string; lastName: string };
  approvedBy: { id: string; firstName: string; lastName: string } | null;
};

export const previewChangeRequest = (
  reservationId: string,
  data: { newCheckIn: string; newCheckOut: string }
) =>
  apiFetch<ChangePreview>(`/reservations/${reservationId}/change-requests/preview`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const createChangeRequest = (
  reservationId: string,
  data: {
    newCheckIn: string;
    newCheckOut: string;
    refundChoice?: "STRIPE_REFUND" | "CREDIT" | null;
  }
) =>
  apiFetch<{
    request: ChangeRequest;
    requiresApproval: boolean;
    applied?: boolean;
  }>(`/reservations/${reservationId}/change-requests`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const listChangeRequests = (reservationId: string) =>
  apiFetch<ChangeRequest[]>(`/reservations/${reservationId}/change-requests`);

export const listAdminChangeRequests = (status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING") =>
  apiFetch<ChangeRequestWithReservation[]>(`/admin/change-requests?status=${status}`);

export const approveChangeRequest = (id: string) =>
  apiFetch<{ success: true }>(`/admin/change-requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });

export const rejectChangeRequest = (id: string, reason: string) =>
  apiFetch<{ success: true }>(`/admin/change-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const changeRequestPayNowIntent = (
  reservationId: string,
  changeRequestId: string,
) =>
  apiFetch<{ clientSecret: string; paymentIntentId: string }>(
    `/reservations/${reservationId}/change-requests/${changeRequestId}/pay-now-intent`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const changeRequestPayNowConfirm = (
  reservationId: string,
  changeRequestId: string,
  stripePaymentIntentId: string,
) =>
  apiFetch<{ success?: boolean; alreadyConfirmed?: boolean }>(
    `/reservations/${reservationId}/change-requests/${changeRequestId}/pay-now-confirm`,
    {
      method: "POST",
      body: JSON.stringify({ stripePaymentIntentId }),
    },
  );

export const changeRequestPayOnPickup = (
  reservationId: string,
  changeRequestId: string,
) =>
  apiFetch<ChangeRequest>(
    `/reservations/${reservationId}/change-requests/${changeRequestId}/pay-on-pickup`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const staffConfirmChangeRequestPickupPaid = (changeRequestId: string) =>
  apiFetch<{ success: true }>(
    `/staff/change-requests/${changeRequestId}/confirm-pickup-paid`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const cancelReservation = (
  reservationId: string,
  refundChoice: "STRIPE_REFUND" | "CREDIT"
) =>
  apiFetch<{ success: true; refundAmount: number; refundChoice: string }>(
    `/reservations/${reservationId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ refundChoice }),
    }
  );

export const issueRefund = (
  reservationId: string,
  refundChoice: "STRIPE_REFUND" | "CREDIT"
) =>
  apiFetch<{ success: true; refundAmount: number; refundChoice: string }>(
    `/reservations/${reservationId}/issue-refund`,
    {
      method: "POST",
      body: JSON.stringify({ refundChoice }),
    }
  );
