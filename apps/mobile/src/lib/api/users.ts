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
  /** Solo informativas y solo cuando NO se pudo mandar código (channel
   * "none"): las mascotas de la ficha encontrada, para que el cliente
   * reconozca que es la suya antes de pedir la vinculación manual. No sirven
   * para reclamar nada; eso sigue exigiendo el código o al equipo. */
  pets?: {
    id: string;
    name: string;
    breed: string | null;
    photoUrl: string | null;
  }[];
  /** Cuando no hubo código posible, el servidor ya le abrió la solicitud al
   * equipo: la pantalla dice "ya avisamos" en vez de ofrecer el botón. */
  requestFiled?: boolean;
  /** Solo con `probe`: hay ficha y SÍ se le puede mandar código, pero no se
   * mandó. El cliente decide si la busca ("Buscar mi cuenta") o sigue. */
  needsCode?: boolean;
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
  /** "Soy nuevo": solo averiguar si hay ficha, sin mandar código a nadie. */
  probe?: boolean;
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

/** En qué va MI solicitud de vinculación.
 *
 * La pantalla "¿Ya eres cliente?" se muestra UNA sola vez por cuenta, así que
 * sin esto el cliente pedía ayuda y se quedaba a ciegas: no podía distinguir
 * "el equipo todavía no la ve" de "nadie la recibió". Devuelve `null` cuando no
 * hay nada que contar (incluida la aprobada: para entonces ya está viendo sus
 * mascotas). */
export type MyClaimRequest = {
  id: string;
  status: "PENDING" | "REJECTED";
  createdAt: string;
  resolvedAt: string | null;
};

export const getMyClaimRequest = () =>
  apiFetch<{ request: MyClaimRequest | null }>("/users/claim/request/mine");

// ─── Bandeja del equipo (solo ADMIN) ──────────────────────

export type ClaimRequestRow = {
  id: string;
  typedPhone: string | null;
  typedEmail: string | null;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  /** CLIENT = la pidió el cliente; AUTO = el sistema vio que su teléfono ya
   *  tiene ficha (hay que confirmarlo con él); ADMIN = la abrió el equipo. */
  source: "CLIENT" | "AUTO" | "ADMIN";
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  /** NULL en cuanto la solicitud se resuelve vinculando: el merge BORRA la
   *  cuenta que pidió (la ficha vieja hereda su identidad), y la FK es
   *  SetNull. Para el historial hay que usar el snapshot de abajo. */
  requester: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  } | null;
  /** Copia tomada al crear la solicitud, justo porque la cuenta desaparece. */
  requesterName: string | null;
  requesterEmail: string | null;
  resolvedBy: { firstName: string; lastName: string } | null;
  /** Fichas que coinciden AHORA con lo que el cliente escribió. */
  candidates: ClaimCandidate[];
  /** Mascotas que la propia cuenta nueva ya registró (suele ser el MISMO perro
   *  que está en la ficha: por eso se pueden juntar con el de la ficha). */
  requesterPets: {
    id: string;
    name: string;
    breed: string | null;
    photoUrl: string | null;
    cartillaStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
    /** Reservas propias: viajan a la ficha si se juntan. */
    reservas: number;
  }[];
};

/** "Este perro de su cuenta es aquel de la ficha": se juntan en el de la
 * ficha, que se queda con lo que capturó el cliente. */
export type ClaimPetMerge = {
  from: string;
  into: string;
  /** Quedarse con el nombre que escribió el cliente. */
  useSourceName?: boolean;
};

export const getClaimRequests = (status: "pending" | "all" = "pending") =>
  apiFetch<ClaimRequestRow[]>(`/admin/claim-requests?status=${status}`);

export const approveClaimRequest = (
  id: string,
  petIds: string[],
  discardPetIds: string[] = [],
  mergePets: ClaimPetMerge[] = [],
) =>
  apiFetch<User>(`/admin/claim-requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ petIds, discardPetIds, mergePets }),
  });

/** Cuenta de la app (con sesión) para abrirle la vinculación a mano. */
export type ClaimAccount = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  mascotas: string[];
  solicitudPendienteId: string | null;
};

export const searchClaimAccounts = (q: string) =>
  apiFetch<ClaimAccount[]>(
    `/admin/claim-requests/accounts?q=${encodeURIComponent(q)}`,
  );

/** El equipo abre la vinculación sin que el cliente la haya pedido. */
export const openClaimRequest = (requesterId: string, note?: string) =>
  apiFetch<{ id: string; alreadyPending: boolean }>("/admin/claim-requests", {
    method: "POST",
    body: JSON.stringify({ requesterId, note }),
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
