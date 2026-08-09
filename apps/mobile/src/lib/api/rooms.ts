import { ENDPOINTS } from "@/constants/api";
import type { Room } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Rooms ───────────────────────────────────────────────

export const getRooms = (size?: string) =>
  apiFetch<Room[]>(`${ENDPOINTS.rooms}${size ? `?size=${size}` : ""}`);

export const getAvailableRooms = (params: {
  checkIn: string;
  checkOut: string;
  petSize: string;
}) => {
  const query = new URLSearchParams(params);
  return apiFetch<Room[]>(`${ENDPOINTS.rooms}/available?${query.toString()}`);
};

export const updateRoom = (id: string, data: Partial<Room>) =>
  apiFetch<Room>(`${ENDPOINTS.rooms}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const createRoom = (data: Omit<Room, "id" | "createdAt" | "updatedAt">) =>
  apiFetch<Room>(ENDPOINTS.rooms, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteRoom = (id: string) =>
  apiFetch<void>(`${ENDPOINTS.rooms}/${id}`, {
    method: "DELETE",
  });
