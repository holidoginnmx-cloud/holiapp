-- Agregar el tipo INCIDENT_POLICY al enum LegalDocumentType.
ALTER TYPE "LegalDocumentType" ADD VALUE IF NOT EXISTS 'INCIDENT_POLICY';
