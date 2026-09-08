import { ENDPOINTS } from "@/constants/api";
import type { User, Pet } from "@holidoginn/shared";
import { apiFetch } from "./client";

// ─── Users ───────────────────────────────────────────────

/** Usuario en la lista admin + `hasApp` computado por el backend
 * (clerkId vinculado o push token registrado = descargó la app). */
export type AdminUserListItem = User & { hasApp: boolean };

export const getUsers = () =>
  apiFetch<AdminUserListItem[]>(ENDPOINTS.users);

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

export type ClaimLookupResult = {
  found: boolean;
  /** Por dónde se mandó el código: al teléfono o al correo QUE YA TIENE la
   * ficha. "none" = no había ningún contacto utilizable. */
  channel: "email" | "sms" | "none";
  candidates: ClaimCandidate[];
  maskedEmails?: string[];
  /** Enmascarado, con la lada visible: "+52 ••• ••• 4567". */
  maskedPhones?: string[];
  /** El otro contacto que tiene la ficha, para ofrecer "mejor por ahí". */
  altChannel?: "email" | "sms";
  challengeToken?: string;
  expiresInMinutes?: number;
  message?: string;
};

/** Busca la cuenta preexistente del cliente (creada por el admin, sin app)
 * por teléfono y, como respaldo, por correo. Si la encuentra, el servidor manda
 * un código de 6 dígitos al contacto que YA TIENE la ficha —SMS si hay
 * teléfono, si no correo—; las mascotas se ven hasta verificarlo.
 *
 * `prefer` sirve para "no me llegó el SMS, mándenmelo al correo": sin eso,
 * quien cambió de número se quedaría atorado, porque el envío sí salió bien. */
export const lookupExistingAccount = (data: {
  phone?: string;
  email?: string;
  prefer?: "email" | "sms";
}) =>
  apiFetch<ClaimLookupResult>("/users/claim/lookup", {
    method: "POST",
    // `v` dice qué entiende esta app. 3 = también el código por SMS; el
    // servidor no manda SMS a quien mande menos, porque la app de la tienda
    // (v: 2) mostraría "no tiene correo" y el mensaje se habría pagado igual.
    body: JSON.stringify({ ...data, v: 3 }),
  });

/** Verifica el código recibido (SMS o correo); devuelve las fichas (nombre +
 * mascotas) y el token que exige `confirmClaim`. */
export const verifyClaimCode = (data: { challengeToken: string; code: string }) =>
  apiFetch<{ candidates: ClaimCandidate[]; claimToken: string }>(
    "/users/claim/verify",
    { method: "POST", body: JSON.stringify(data) },
  );

/** Confirma el claim: reúne las mascotas seleccionadas (pueden venir de varios
 * registros duplicados) bajo la cuenta del usuario. */
export const confirmClaim = (data: {
  petIds: string[];
  claimToken: string;
  phone?: string;
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

/** Pide que el equipo vincule la ficha a mano.
 *
 * La salida para el cliente al que no se le puede mandar un código porque su
 * ficha no tiene ningún contacto utilizable. Crea una solicitud y le llega al
 * equipo a su bandeja de avisos. */
export const requestManualClaim = (data: {
  phone?: string;
  email?: string;
  note?: string;
}) =>
  apiFetch<{ ok: boolean; alreadyPending: boolean; id: string }>(
    "/users/claim/request",
    { method: "POST", body: JSON.stringify(data) },
  );

// ─── Bandeja del equipo (solo ADMIN) ──────────────────────

export type ClaimRequestRow = {
  id: string;
  typedPhone: string | null;
  typedEmail: string | null;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  requester: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  resolvedBy: { firstName: string; lastName: string } | null;
  /** Fichas que coinciden AHORA con lo que el cliente escribió. */
  candidates: ClaimCandidate[];
};

export const getClaimRequests = (status: "pending" | "all" = "pending") =>
  apiFetch<ClaimRequestRow[]>(`/admin/claim-requests?status=${status}`);

export const approveClaimRequest = (id: string, petIds: string[]) =>
  apiFetch<User>(`/admin/claim-requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ petIds }),
  });

export const rejectClaimRequest = (id: string, reason?: string) =>
  apiFetch<ClaimRequestRow>(`/admin/claim-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

/** Busca fichas SIN cuenta vinculada, por nombre o por dígitos del teléfono.
 *
 * Hace falta porque la coincidencia automática falla justo en el caso que trae
 * al cliente a pedir ayuda: si su ficha tiene el teléfono mal escrito, no la
 * encuentra ni él ni el sistema. El equipo la busca por nombre. */
export const searchClaimFichas = (q: string) =>
  apiFetch<ClaimCandidate[]>(
    `/admin/claim-requests/search?q=${encodeURIComponent(q)}`,
  );
