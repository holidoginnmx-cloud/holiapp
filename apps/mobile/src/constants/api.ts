import { Platform } from "react-native";

// Android emulator usa 10.0.2.2 para acceder al host; iOS simulator usa localhost
const LOCALHOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.96:3000';

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
} as const;
