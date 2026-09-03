import { ENDPOINTS } from "@/constants/api";
import type { PendingReview, Review } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Reviews ───────────────────────────────────────────

export const createReview = (data: {
  rating: number;
  comment: string | null;
  reservationId: string;
}) =>
  apiFetch<Review & { appliedTo?: number }>(ENDPOINTS.reviews, {
    method: "POST",
    body: JSON.stringify(data),
  });

/**
 * La visita finalizada que aún espera calificación (o `null`). Devuelve una
 * sola: encadenar modales para quien lleva varias sin reseñar es la mejor forma
 * de que desinstale la app.
 */
export const getPendingReview = () =>
  apiFetch<{ pending: PendingReview | null }>(`${ENDPOINTS.reviews}/pending`);

/** "Más tarde": 48 h, luego una semana, luego nunca más. */
export const snoozeReview = (reservationId: string) =>
  apiFetch<{ snoozedUntil: string; promptCount: number }>(
    `${ENDPOINTS.reviews}/snooze`,
    { method: "POST", body: JSON.stringify({ reservationId }) },
  );
