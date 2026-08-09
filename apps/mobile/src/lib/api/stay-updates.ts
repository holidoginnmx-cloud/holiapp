import { ENDPOINTS } from "@/constants/api";
import type { StayUpdate } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Stay Updates ────────────────────────────────────────

export const getStayUpdates = (reservationId: string) =>
  apiFetch<StayUpdate[]>(`${ENDPOINTS.stayUpdates}/${reservationId}`);

export const deleteStayUpdate = (id: string) =>
  apiFetch<void>(`${ENDPOINTS.stayUpdates}/${id}`, { method: "DELETE" });
