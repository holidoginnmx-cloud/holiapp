import type { Pet } from "@holidoginn/shared";
import { apiFetch } from "./client";
import type { Deworming, DewormingType } from "./pets";

// ─── Cartillas (admin) ───────────────────────────────────

export type CartillaStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type CartillaVaccine = {
  id: string;
  name: string;
  appliedAt: string;
  expiresAt: string | null;
  vetName: string | null;
  catalogId: string | null;
  catalog: {
    id: string;
    code: string;
    displayName: string;
  } | null;
};

export type PetWithCartilla = Pet & {
  cartillaUrl: string | null;
  cartillaPhotos: string[];
  cartillaStatus: CartillaStatusValue | null;
  cartillaReviewedAt: string | null;
  cartillaReviewedById: string | null;
  cartillaRejectionReason: string | null;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  cartillaReviewedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  vaccines?: CartillaVaccine[];
  dewormings?: Deworming[];
};

export const getCartillas = (status: CartillaStatusValue = "PENDING") =>
  apiFetch<PetWithCartilla[]>(`/admin/cartillas?status=${status}`);

export const getPendingCartillasCount = () =>
  apiFetch<{ pending: number }>("/admin/cartillas/pending-count");

export type VaccineCatalogEntry = {
  id: string;
  code: string;
  displayName: string;
  defaultDurationDays: number;
  description: string | null;
  isActive: boolean;
};

export const getVaccineCatalog = () =>
  apiFetch<VaccineCatalogEntry[]>("/vaccine-catalog");

export type ReviewCartillaPayload =
  | {
      action: "APPROVE";
      vaccines?: {
        catalogId?: string;
        appliedAt: string;
        expiresAt: string;
        vetName?: string;
      }[];
      dewormings?: {
        type: DewormingType;
        productName?: string | null;
        appliedAt: string;
        expiresAt?: string | null;
        notes?: string | null;
      }[];
    }
  | { action: "REJECT"; reason?: string };

export const reviewCartilla = (petId: string, data: ReviewCartillaPayload) =>
  apiFetch<Pet>(`/admin/pets/${petId}/cartilla`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

// OCR de la cartilla con Claude: devuelve sugerencias para prellenar el
// formulario de aprobación. No persiste nada.
export type CartillaOcrResult = {
  vaccines: {
    name: string;
    /** Código del catálogo deducido por la IA (VaccineCatalogEntry.code), o null. */
    catalogCode: string | null;
    appliedAt: string | null;
    expiresAt: string | null;
    vetName: string | null;
  }[];
  dewormings: {
    type: DewormingType;
    productName: string | null;
    appliedAt: string | null;
    expiresAt: string | null;
    notes: string | null;
  }[];
};

export const ocrCartilla = (petId: string) =>
  apiFetch<CartillaOcrResult>(`/admin/pets/${petId}/cartilla/ocr`, {
    method: "POST",
  });

export type UpdateVaccinePayload = {
  catalogId?: string;
  appliedAt?: string;
  expiresAt?: string;
  vetName?: string | null;
};

export const updateAdminVaccine = (
  vaccineId: string,
  data: UpdateVaccinePayload
) =>
  apiFetch<CartillaVaccine>(`/admin/vaccines/${vaccineId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteAdminVaccine = (vaccineId: string) =>
  apiFetch<{ id: string }>(`/admin/vaccines/${vaccineId}`, {
    method: "DELETE",
  });
