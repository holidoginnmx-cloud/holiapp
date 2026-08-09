import { ENDPOINTS } from "@/constants/api";
import type { User, Pet } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Users ───────────────────────────────────────────────

/** Usuario en la lista admin + `hasApp` computado por el backend
 * (clerkId vinculado o push token registrado = descargó la app). */
export type AdminUserListItem = User & { hasApp: boolean };

export const getUsers = () =>
  apiFetch<AdminUserListItem[]>(ENDPOINTS.users);

export const getUserById = (id: string) =>
  apiFetch<User & { pets: Pet[] }>(`${ENDPOINTS.users}/${id}`);

/** Alta de cliente walk-in desde el admin. Sin email, el backend genera un
 * placeholder @holidoginn.local (igual que el admin web); con teléfono, el
 * cliente podrá reclamar su cuenta al descargar la app. */
export const createUser = (data: {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string;
}) =>
  apiFetch<User>(ENDPOINTS.users, {
    method: "POST",
    body: JSON.stringify(data),
  });

// ─── Reclamar cuenta preexistente ("¿Ya eres cliente?") ──

export type ClaimCandidate = {
  candidateId: string;
  firstName: string;
  pets: {
    id: string;
    name: string;
    breed: string | null;
    photoUrl: string | null;
  }[];
};

/** Busca la cuenta preexistente del cliente (creada por el admin, sin app)
 * por teléfono y, como respaldo, por correo. */
export const lookupExistingAccount = (data: { phone?: string; email?: string }) =>
  apiFetch<{ candidates: ClaimCandidate[] }>("/users/claim/lookup", {
    method: "POST",
    body: JSON.stringify(data),
  });

/** Confirma el claim: reúne las mascotas seleccionadas (pueden venir de varios
 * registros duplicados) bajo la cuenta del usuario. */
export const confirmClaim = (data: {
  petIds: string[];
  phone?: string;
  email?: string;
}) =>
  apiFetch<User>("/users/claim/confirm", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateUser = (id: string, data: Partial<User>) =>
  apiFetch<User>(`${ENDPOINTS.users}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const updateMyRole = (role: User["role"]) =>
  apiFetch<User>(`${ENDPOINTS.users}/me/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });

export type CreditLedgerEntry = {
  id: string;
  type: "CREDIT_ADDED" | "CREDIT_APPLIED" | "CREDIT_ADJUSTED";
  amount: string;
  balanceAfter: string;
  description: string;
  createdAt: string;
  reservationId: string | null;
  changeRequestId: string | null;
};

export const getCreditLedger = () =>
  apiFetch<CreditLedgerEntry[]>(`/users/me/credit-ledger`);

export type MeResponse = User & { creditBalance: string };

export const getMe = () => apiFetch<MeResponse>(`/users/me`);

export const updateMe = (data: { firstName?: string; lastName?: string; phone?: string | null }) =>
  apiFetch<User>(`/users/me`, { method: "PATCH", body: JSON.stringify(data) });

export const exportMyData = () => apiFetch<Record<string, unknown>>(`/users/me/export`);

export const deleteMyAccount = () =>
  apiFetch<{ ok: true }>(`/users/me`, { method: "DELETE" });
