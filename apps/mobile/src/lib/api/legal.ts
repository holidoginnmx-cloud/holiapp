import { ENDPOINTS } from "@/constants/api";
import { apiFetch } from "./client";

// ─── Legal / consentimientos ──────────────────────────────

export type LegalDocType =
  | "TOS"
  | "PRIVACY"
  | "IMAGE_USE"
  | "VET_AUTH"
  | "INCIDENT_POLICY";

export type LegalDocument = {
  type: LegalDocType;
  version: string;
  required: boolean;
};

export type LegalAcceptance = {
  id: string;
  userId: string;
  documentType: LegalDocType;
  version: string;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type LegalStatus = {
  canBook: boolean;
  missing: LegalDocType[];
  versions: Record<LegalDocType, string>;
};

export const getLegalDocuments = () =>
  apiFetch<LegalDocument[]>(`${ENDPOINTS.legal}/documents`);

export const getMyLegalStatus = () =>
  apiFetch<LegalStatus>(`${ENDPOINTS.legal}/me/status`);

export const getMyLegalAcceptances = () =>
  apiFetch<LegalAcceptance[]>(`${ENDPOINTS.legal}/me/acceptances`);

export const acceptLegalDocument = (
  documentType: LegalDocType,
  version: string
) =>
  apiFetch<LegalAcceptance>(`${ENDPOINTS.legal}/acceptances`, {
    method: "POST",
    body: JSON.stringify({ documentType, version }),
  });
