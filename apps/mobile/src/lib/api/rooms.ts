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

/** Cuarto + cuántos perros lo ocupan en el rango consultado. */
export type RoomOccupancy = Room & {
  occupied: number;
  /** Lugares libres. Negativo si alguien sobrevendió a mano. */
  remaining: number;
};

/**
 * TODOS los cuartos con su ocupación en esas fechas — a diferencia de
 * getAvailableRooms, que esconde los llenos. El equipo elige el cuarto a mano y
 * necesita VER cuáles no tienen lugar. Solo staff/admin.
 *
 * ⚠️ Manda exactamente los mismos ISO que el submit de la reservación: si el
 * anclaje difiere, la pantalla y el 409 del servidor se contradicen.
 */
export const getRoomsOccupancy = (params: {
  checkIn: string;
  checkOut: string;
  /** Al reasignar: la propia estancia no debe contarse a sí misma. */
  excludeReservationId?: string;
}) => {
  const query = new URLSearchParams(params);
  return apiFetch<RoomOccupancy[]>(
    `${ENDPOINTS.rooms}/occupancy?${query.toString()}`,
  );
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
