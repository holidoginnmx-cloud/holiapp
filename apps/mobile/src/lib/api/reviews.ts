import { ENDPOINTS } from "@/constants/api";
import type { Review } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Reviews ───────────────────────────────────────────

export const createReview = (data: {
  rating: number;
  comment: string | null;
  reservationId: string;
}) =>
  apiFetch<Review>(ENDPOINTS.reviews, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getReviewByReservation = (reservationId: string) =>
  apiFetch<Review>(`${ENDPOINTS.reviews}/${reservationId}`);
