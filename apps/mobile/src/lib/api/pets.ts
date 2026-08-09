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

export type PetForBooking = Pet & {
  vaccines: VaccineWithCatalog[];
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

export const getDewormings = (petId: string) =>
  apiFetch<Deworming[]>(`${ENDPOINTS.pets}/${petId}/dewormings`);

export const addDeworming = (
  petId: string,
  data: {
    type: DewormingType;
    productName?: string | null;
    appliedAt: string;
    expiresAt?: string | null;
    vetName?: string | null;
    fileUrl?: string | null;
    notes?: string | null;
  },
) =>
  apiFetch<Deworming>(`${ENDPOINTS.pets}/${petId}/dewormings`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const deleteDeworming = (petId: string, id: string) =>
  apiFetch<void>(`${ENDPOINTS.pets}/${petId}/dewormings/${id}`, {
    method: "DELETE",
  });

export const addVaccine = (petId: string, data: Record<string, unknown>) =>
  apiFetch<Vaccine>(`${ENDPOINTS.pets}/${petId}/vaccines`, {
    method: "POST",
    body: JSON.stringify(data),
  });

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
