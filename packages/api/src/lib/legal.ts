// Versiones vigentes de los documentos legales.
//
// 🔴 IMPORTANTE: cuando el texto de un documento cambie (incluso un ajuste
//    menor), SUBE la versión aquí. Eso fuerza al usuario a re-aceptar —
//    LFPDPPP exige consentimiento informado, y "informado" significa que
//    aceptó la versión vigente, no una anterior.
//
// Convención: semver-like "MAYOR.MENOR.PARCHE" aunque las versiones suelen
// ser solo "1.0.0", "1.1.0", etc.

export const LEGAL_DOC_VERSIONS = {
  TOS: "1.0.0",
  PRIVACY: "1.0.0",
  IMAGE_USE: "1.0.0",
  VET_AUTH: "1.0.0",
  INCIDENT_POLICY: "1.0.0",
} as const;

export type LegalDocType = keyof typeof LEGAL_DOC_VERSIONS;

// Documentos que el usuario DEBE aceptar antes de poder crear una reserva.
// IMAGE_USE queda fuera: es opt-in (permite que HDI use fotos del perro en
// redes). No está en esta lista — no bloquea la reserva.
export const REQUIRED_FOR_BOOKING: LegalDocType[] = [
  "TOS",
  "PRIVACY",
  "VET_AUTH",
  "INCIDENT_POLICY",
];

// Todos los tipos (útil para UI de preferencias).
export const ALL_DOC_TYPES: LegalDocType[] = [
  "TOS",
  "PRIVACY",
  "IMAGE_USE",
  "VET_AUTH",
  "INCIDENT_POLICY",
];
