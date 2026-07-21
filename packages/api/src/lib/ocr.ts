// OCR de cartillas de vacunación con Claude (Anthropic vision). La API key vive
// SOLO aquí (server-side, env ANTHROPIC_API_KEY); la app móvil nunca la ve.
//
// Se usa bajo demanda desde el admin ("Leer con IA" en la revisión de
// cartillas): lee las fotos (URLs públicas de Cloudinary) y devuelve
// SUGERENCIAS de vacunas y desparasitaciones que el admin revisa/corrige antes
// de aprobar. No persiste nada — eso lo hace el PATCH /admin/pets/:id/cartilla.

import Anthropic from "@anthropic-ai/sdk";

// Forma de las sugerencias que devolvemos a la UI. Fechas como ISO string (o
// null si no son legibles); el admin completa lo que falte.
export type CartillaVaccineSuggestion = {
  name: string;
  appliedAt: string | null;
  expiresAt: string | null;
  vetName: string | null;
};

export type CartillaDewormingSuggestion = {
  type: "INTERNAL" | "EXTERNAL" | "BOTH";
  productName: string | null;
  appliedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
};

export type CartillaExtraction = {
  vaccines: CartillaVaccineSuggestion[];
  dewormings: CartillaDewormingSuggestion[];
};

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY no configurada en el servidor");
  }
  return new Anthropic({ apiKey });
}

// Tool forzado: garantiza que Claude responda con un JSON tipado en vez de prosa.
const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "registrar_cartilla",
  description:
    "Registra las vacunas y desparasitaciones transcritas de la cartilla de vacunación.",
  input_schema: {
    type: "object",
    properties: {
      vaccines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Nombre de la vacuna tal como aparece (ej. 'Rabia', 'Parvovirus', 'Séxtuple').",
            },
            appliedAt: {
              type: ["string", "null"],
              description: "Fecha de aplicación en formato ISO YYYY-MM-DD, o null si no se ve.",
            },
            expiresAt: {
              type: ["string", "null"],
              description: "Fecha de vencimiento / próxima dosis en ISO YYYY-MM-DD, o null.",
            },
            vetName: {
              type: ["string", "null"],
              description: "Nombre del veterinario o clínica que la aplicó, o null.",
            },
          },
          required: ["name", "appliedAt", "expiresAt", "vetName"],
          additionalProperties: false,
        },
      },
      dewormings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["INTERNAL", "EXTERNAL", "BOTH"],
              description:
                "INTERNAL = interna/oral (gusanos), EXTERNAL = externa (pulgas/garrapatas), BOTH = combinada.",
            },
            productName: {
              type: ["string", "null"],
              description: "Nombre del producto (ej. 'Bravecto', 'Drontal'), o null.",
            },
            appliedAt: {
              type: ["string", "null"],
              description: "Fecha de aplicación en ISO YYYY-MM-DD, o null.",
            },
            expiresAt: {
              type: ["string", "null"],
              description: "Próxima dosis sugerida en ISO YYYY-MM-DD, o null.",
            },
            notes: {
              type: ["string", "null"],
              description: "Notas adicionales legibles, o null.",
            },
          },
          required: ["type", "productName", "appliedAt", "expiresAt", "notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["vaccines", "dewormings"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT =
  "Eres un asistente que transcribe cartillas de vacunación de mascotas. " +
  "Extrae ÚNICAMENTE lo que sea claramente legible en las imágenes. " +
  "No inventes datos: si una fecha, producto o veterinario no se distingue, usa null. " +
  "Las fechas van en formato ISO YYYY-MM-DD. " +
  "Si una foto no corresponde a una cartilla o no tiene registros legibles, no agregues filas. " +
  "Llama siempre a la herramienta registrar_cartilla, aun si las listas quedan vacías.";

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVaccine(raw: unknown): CartillaVaccineSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const name = firstString(v.name);
  if (!name) return null; // sin nombre no sirve como sugerencia
  return {
    name,
    appliedAt: firstString(v.appliedAt),
    expiresAt: firstString(v.expiresAt),
    vetName: firstString(v.vetName),
  };
}

function normalizeDeworming(raw: unknown): CartillaDewormingSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const type = d.type;
  if (type !== "INTERNAL" && type !== "EXTERNAL" && type !== "BOTH") return null;
  return {
    type,
    productName: firstString(d.productName),
    appliedAt: firstString(d.appliedAt),
    expiresAt: firstString(d.expiresAt),
    notes: firstString(d.notes),
  };
}

/**
 * Lee las fotos de una cartilla (URLs públicas) con Claude y devuelve
 * sugerencias de vacunas y desparasitaciones. Lanza si la key falta o la API
 * falla; el endpoint lo traduce a un error controlado para la UI.
 */
export async function extraerCartilla(
  photoUrls: string[]
): Promise<CartillaExtraction> {
  if (photoUrls.length === 0) {
    return { vaccines: [], dewormings: [] };
  }

  const imageBlocks = photoUrls.map(
    (url): Anthropic.ImageBlockParam => ({
      type: "image",
      source: { type: "url", url },
    })
  );

  const response = await client().messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: "Transcribe las vacunas y desparasitaciones de esta cartilla.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Claude no devolvió una extracción estructurada");
  }

  const input = toolUse.input as Record<string, unknown>;
  const vaccines = Array.isArray(input.vaccines)
    ? input.vaccines.map(normalizeVaccine).filter((v): v is CartillaVaccineSuggestion => v !== null)
    : [];
  const dewormings = Array.isArray(input.dewormings)
    ? input.dewormings
        .map(normalizeDeworming)
        .filter((d): d is CartillaDewormingSuggestion => d !== null)
    : [];

  return { vaccines, dewormings };
}
