import { ENDPOINTS } from "@/constants/api";
import { apiFetch } from "./client";

// ─── Push tokens ──────────────────────────────────────────

export const registerPushToken = (token: string, platform: "ios" | "android") =>
  apiFetch<{ id: string }>(ENDPOINTS.pushTokens, {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });

export const unregisterPushToken = (token: string) =>
  apiFetch<{ deleted: number }>(
    `${ENDPOINTS.pushTokens}?token=${encodeURIComponent(token)}`,
    { method: "DELETE" }
  );
