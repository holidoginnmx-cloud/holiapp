// Barrel del cliente API, partido por dominio en src/lib/api/.
// Re-exporta todo para que ningún import existente (`@/lib/api`) cambie.
// La base compartida (apiFetch) vive en ./api/client y no era pública aquí.
export * from "./api/types";
export * from "./api/users";
export * from "./api/pets";
export * from "./api/rooms";
export * from "./api/reservations";
export * from "./api/payments";
export * from "./api/baths";
export * from "./api/daycare";
export * from "./api/staff";
export * from "./api/stay-updates";
export * from "./api/notifications";
export * from "./api/reviews";
export * from "./api/admin";
export * from "./api/cartillas";
export * from "./api/delivery";
export * from "./api/change-requests";
export * from "./api/push";
export * from "./api/legal";
