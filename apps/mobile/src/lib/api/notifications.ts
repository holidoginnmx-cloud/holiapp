import { ENDPOINTS } from "@/constants/api";
import type { Notification } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Notifications ───────────────────────────────────────

export const getNotifications = (userId: string) =>
  apiFetch<Notification[]>(`${ENDPOINTS.notifications}/${userId}`);

export const markNotificationAsRead = (id: string) =>
  apiFetch<Notification>(`${ENDPOINTS.notifications}/${id}/read`, {
    method: "PATCH",
  });

export const markAllNotificationsAsRead = (userId: string) =>
  apiFetch<{ updated: number }>(
    `${ENDPOINTS.notifications}/read-all/${userId}`,
    { method: "PATCH" }
  );

export const sendAdminNotification = (data: {
  userIds?: string[] | "all";
  roles?: ("OWNER" | "STAFF" | "ADMIN")[];
  title: string;
  body: string;
  type?: string;
}) =>
  apiFetch<{ sent: number; pushed: number }>("/admin/notifications/send", {
    method: "POST",
    body: JSON.stringify(data),
  });
