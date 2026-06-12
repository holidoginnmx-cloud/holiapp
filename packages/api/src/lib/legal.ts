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

// Registra (idempotente) las aceptaciones legales requeridas para reservar a
// nombre de un usuario, en su versión vigente. Se usa en el flujo de invitado
// web: el visitante marca los checkboxes de consentimiento y el servidor crea
// un registro real (con IP/user-agent para trazabilidad LFPDPPP) para el User
// auto-creado, de modo que el gate 412 de /reservations|/payments lo deje pasar.
//
// Mismo patrón de upsert que POST /legal/acceptances (routes/legal.ts).
export async function recordRequiredAcceptances(
  prisma: import("@prisma/client").PrismaClient,
  userId: string,
  meta?: { ipAddress?: string | null; userAgent?: string | null }
): Promise<void> {
  for (const documentType of REQUIRED_FOR_BOOKING) {
    const version = LEGAL_DOC_VERSIONS[documentType];
    await prisma.legalAcceptance.upsert({
      where: { userId_documentType_version: { userId, documentType, version } },
      update: {}, // idempotente — no re-escribir acceptedAt
      create: {
        userId,
        documentType,
        version,
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    });
  }
}
