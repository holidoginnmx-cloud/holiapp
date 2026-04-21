const baseUrl = process.env.EXPO_PUBLIC_API_URL;

if (!baseUrl) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is required. Set it in apps/mobile/.env (development) or inject it at build time (production).",
  );
}

if (!__DEV__ && !baseUrl.startsWith("https://")) {
  throw new Error(
    "EXPO_PUBLIC_API_URL must use HTTPS in production builds.",
  );
}

export const BASE_URL = baseUrl;

export const ENDPOINTS = {
  health: "/health",
  users: "/users",
  pets: "/pets",
  rooms: "/rooms",
  reservations: "/reservations",
  payments: "/payments",
  stayUpdates: "/stay-updates",
  notifications: "/notifications",
  reviews: "/reviews",
  services: "/services",
  pushTokens: "/push-tokens",
  legal: "/legal",
} as const;
