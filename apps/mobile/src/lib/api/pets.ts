import { ENDPOINTS } from "@/constants/api";
import type {
  Pet,
  Vaccine,
  Reservation,
  StayUpdate,
  DailyChecklist,
  BehaviorTag,
  StaffAlert,
  Review,
} from "@holidoginn/shared";
import { apiFetch } from "./client";
import type { VaccineWithCatalog, PetWithVaccines } from "./types";

// ─── Pets ────────────────────────────────────────────────

export type PetPerson = { id: string; firstName: string; lastName?: string | null };

export type PetForBooking = Pet & {
  vaccines: VaccineWithCatalog[];
  // Un perro puede vivir en dos cuentas (pareja/familia que lo comparte).
  owner?: PetPerson | null;
  coOwners?: { user: PetPerson }[];
  reservations: {
    id: string;
    checkIn: string;
    checkOut: string;
    status: "CONFIRMED" | "CHECKED_IN";
    paymentType: "FULL" | "DEPOSIT" | null;
    totalAmount: string;
    hasBalance: boolean;
  }[];
};

export const getPetsByOwner = (ownerId: string) =>
  apiFetch<PetForBooking[]>(`${ENDPOINTS.pets}?ownerId=${ownerId}`);

export const getPetById = (id: string) =>
  apiFetch<PetWithVaccines>(`${ENDPOINTS.pets}/${id}`);

export const createPet = (data: Record<string, unknown>) =>
  apiFetch<Pet>(ENDPOINTS.pets, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updatePet = (id: string, data: Record<string, unknown>) =>
  apiFetch<Pet>(`${ENDPOINTS.pets}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deletePet = (id: string) =>
  apiFetch<void>(`${ENDPOINTS.pets}/${id}`, {
    method: "DELETE",
  });

// ─── Co-dueños ──────────────────────────────────────────
// Un perro puede estar en dos cuentas (pareja/familia que lo comparte). El
// equipo vincula a mano (estas tres, solo admin) y el dueño invita él solo
// (las de "Invitaciones", más abajo).

export type PetCoOwnersResponse = {
  pet: { id: string; name: string };
  owner: {
    id: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
    email: string;
  } | null;
  coOwners: {
    createdAt: string;
    createdByEmail: string | null;
    createdBy: { id: string; firstName: string; lastName: string | null } | null;
    user: {
      id: string;
      firstName: string;
      lastName: string | null;
      phone: string | null;
      email: string;
    };
  }[];
};

export const getPetCoOwners = (petId: string) =>
  apiFetch<PetCoOwnersResponse>(`${ENDPOINTS.pets}/${petId}/co-owners`);

export const addPetCoOwner = (petId: string, userId: string) =>
  apiFetch<{ ok: true; id: string }>(`${ENDPOINTS.pets}/${petId}/co-owners`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });

export const removePetCoOwner = (petId: string, userId: string) =>
  apiFetch<{ ok: true }>(`${ENDPOINTS.pets}/${petId}/co-owners/${userId}`, {
    method: "DELETE",
  });

// ─── Invitaciones para compartir ────────────────────────
// El DUEÑO genera una liga (con un código de respaldo para quien todavía no
// tiene la app) y la otra persona queda de co-dueño al aceptarla.
// `removePetCoOwner` de arriba ya no es solo de admin: el dueño la usa para
// quitar a alguien y el co-dueño para salirse (con su propio id).

export type PetInvite = {
  id: string;
  /** Ya viene formateado: "ABCD-EFGH". */
  code: string;
  /** Solo para el dueño, que es quien la reenvía. Al equipo no le llega. */
  url?: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: { firstName: string; lastName: string | null };
  /** El mensaje listo para compartir por WhatsApp (liga + código). Solo al dueño. */
  shareText?: string;
};

export type PetInvitesResponse = {
  /** Cuántas personas más caben (co-dueños + invitaciones vivas cuentan). */
  slotsLeft: number;
  maxCoOwners: number;
  invites: PetInvite[];
};

export type CreatedPetInvite = {
  id: string;
  code: string;
  url: string;
  expiresAt: string;
  shareText: string;
};

export type InviteStatus = "valid" | "used" | "revoked" | "expired";

export type InvitePreview = {
  status: InviteStatus;
  code: string;
  expiresAt: string;
  pet: { name: string; photoUrl: string | null };
  invitedByFirstName: string;
  /** Si quien consulta ya tiene a esta mascota (dueño o co-dueño). */
  alreadyLinked: boolean;
  /** Quien consulta es el dueño abriendo su propia liga. */
  viewerIsOwner: boolean;
};

export const getPetInvites = (petId: string) =>
  apiFetch<PetInvitesResponse>(`${ENDPOINTS.pets}/${petId}/invites`);

export const createPetInvite = (petId: string) =>
  apiFetch<CreatedPetInvite>(`${ENDPOINTS.pets}/${petId}/invites`, { method: "POST" });

export const revokePetInvite = (petId: string, inviteId: string) =>
  apiFetch<{ ok: true }>(`${ENDPOINTS.pets}/${petId}/invites/${inviteId}`, {
    method: "DELETE",
  });

/** Por token de la liga o por el código tecleado ("abcd-efgh" también sirve). */
export const getInvite = (key: string) =>
  apiFetch<InvitePreview>(`/invites/${encodeURIComponent(key)}`);

export const acceptInvite = (key: string) =>
  apiFetch<{ ok: true; petId: string; petName: string; alreadyLinked: boolean }>(
    `/invites/${encodeURIComponent(key)}/accept`,
    { method: "POST" },
  );

// ─── Dewormings ─────────────────────────────────────────

export type DewormingType = "INTERNAL" | "EXTERNAL" | "BOTH";

export type Deworming = {
  id: string;
  type: DewormingType;
  productName: string | null;
  appliedAt: string;
  expiresAt: string | null;
  vetName: string | null;
  fileUrl: string | null;
  notes: string | null;
  petId: string;
  createdAt: string;
};

export type PetHistory = {
  pet: Pet;
  reservations: (Reservation & {
    room: { id: string; name: string } | null;
    updates: StayUpdate[];
    checklists: DailyChecklist[];
    review: Review | null;
  })[];
  behaviorTags: (BehaviorTag & {
    staff: { firstName: string; lastName: string };
  })[];
};

export const getPetHistory = (petId: string) =>
  apiFetch<PetHistory>(`${ENDPOINTS.pets}/${petId}/history`);

export type PetAlert = StaffAlert & {
  staff: { id: string; firstName: string; lastName: string };
  reservation: {
    id: string;
    checkIn: string | null;
    checkOut: string | null;
    reservationType: "STAY" | "BATH";
    appointmentAt: string | null;
    room: { id: string; name: string } | null;
  };
};

export const getPetAlerts = (petId: string, resolved?: boolean) => {
  const qs = resolved === undefined ? "" : `?resolved=${resolved}`;
  return apiFetch<PetAlert[]>(`${ENDPOINTS.pets}/${petId}/alerts${qs}`);
};

export type PetWithOwner = Pet & {
  owner: { id: string; firstName: string; lastName: string; email: string };
};

export const getAllPets = () =>
  apiFetch<PetWithOwner[]>(ENDPOINTS.pets);
