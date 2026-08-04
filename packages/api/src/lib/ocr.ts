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
  /**
   * Código del catálogo (VaccineCatalog.code) que le corresponde, o null si de
   * plano no se puede determinar. Esto es lo que permite que la app preseleccione
   * el TIPO de vacuna: sin él la fila queda sólo con fechas y el admin tiene que
   * elegir el tipo a mano en cada renglón.
   */
  catalogCode: string | null;
  appliedAt: string | null;
  expiresAt: string | null;
  vetName: string | null;
};

/** Entrada del catálogo que se le muestra a Claude para que elija el tipo. */
export type VaccineCatalogOption = {
  code: string;
  displayName: string;
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
// El enum de `catalogCode` se arma en runtime con el catálogo real de la BD.
function buildExtractionTool(catalog: VaccineCatalogOption[]): Anthropic.Tool {
  const codes = catalog.map((c) => c.code);
  return {
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
                "Lo que está escrito en el renglón, TAL CUAL: marca comercial, " +
                "siglas o nombre (ej. 'Nobivac DHPP', 'Canigen RL', 'Séxtuple', 'Rabia').",
            },
            catalogCode: {
              type: ["string", "null"],
              enum: [...codes, null],
              description:
                "Código del catálogo HDI que corresponde a esta vacuna, deducido de " +
                "la marca o las siglas del renglón. Usa null SOLO si es imposible " +
                "determinar de qué vacuna se trata. Opciones válidas: " +
                catalog.map((c) => `${c.code} = ${c.displayName}`).join("; "),
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
          required: ["name", "catalogCode", "appliedAt", "expiresAt", "vetName"],
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
}

// El prompt es la mitad del trabajo: las cartillas reales casi nunca escriben
// "DHPP" o "Leptospirosis". Traen la MARCA COMERCIAL (a mano, con sello o con la
// etiqueta del frasco pegada) y siglas locales. Sin esta tabla el modelo lee las
// fechas pero deja el tipo en null, que es justo lo que se veía en producción.
const SYSTEM_PROMPT = `Eres un médico veterinario que transcribe cartillas de vacunación caninas mexicanas para el hotel Holidog Inn.

CÓMO SON ESTAS CARTILLAS
- El renglón de una vacuna casi nunca dice el nombre técnico. Dice la MARCA COMERCIAL, una sigla, o ambas.
- El nombre puede venir escrito a mano, en un sello de la clínica, o en la ETIQUETA ADHESIVA del frasco pegada sobre el renglón (esas etiquetas traen la marca y el lote).
- Un mismo renglón puede tener varias fechas: la de aplicación y la de "próxima" o "refuerzo".

MARCAS Y SIGLAS FRECUENTES → QUÉ VACUNA SON
- Nobivac, Canigen, Vanguard, Eurican, Duramune, Recombitek, Novibac (mal escrito), Puppy DP, Bio Can: son FAMILIAS de marca. Lo que define la vacuna son las letras que las acompañan.
- DHPP, DAPP, DA2PP, DHPPi, DHPPiL, Puppy DP, Séxtuple, Quíntuple, Óctuple, "múltiple", "triple viral": es la polivalente → tipo DHPP.
- R, Rab, Rabia, Defensor, Rabisin, Nobivac R, Canigen R, "antirrábica": es RABIA.
- L, L4, Lepto, Leptospira: LEPTOSPIROSIS. Ojo con "RL" (p.ej. Canigen RL): la R es rabia y la L leptospirosis, así que ese renglón son DOS vacunas. En general, cuando un renglón cubre varias vacunas (DHPPiL, séxtuple con lepto, RL), registra UNA FILA POR CADA UNA, todas con la misma fecha.
- KC, Bb, Bordetella, Bronchicine, Nobivac KC, "tos de las perreras", "traqueobronquitis": es BORDETELLA (oral/intranasal si dice KC, oral o intranasal; inyectable si lo indica).
- Influenza, Gripe canina, CIV, H3N8, H3N2: es INFLUENZA.
- Parvo, Parvovirus, Puppy, "primovacunación de cachorro" sola: PARVOVIRUS.

REGLAS
- Registra UNA FILA POR CADA RENGLÓN que tenga al menos una fecha, aunque el nombre esté abreviado, mal escrito o incompleto. Un renglón con fecha y sin tipo identificable SÍ se registra: name con lo que se alcance a leer y catalogCode en null.
- Deduce catalogCode con la tabla de arriba. Es lo más importante de tu trabajo: no lo dejes en null sólo porque el renglón trae una marca en vez del nombre técnico — la marca ES la pista. Sólo usa null cuando de plano no haya forma de saber de qué vacuna se trata.
- Rabia: usa el código de 1 año salvo que la cartilla diga explícitamente 3 años / trienal.
- NO inventes fechas. Si una fecha no se distingue, usa null; el equipo la completa a mano.
- Fechas en ISO YYYY-MM-DD. Ojo con el formato mexicano DD/MM/AAAA: 03/07/25 es 2025-07-03, no 2025-03-07. Con año de dos dígitos asume 20XX.
- Las desparasitaciones (Bravecto, NexGard, Simparica, Drontal, Endogard, Panacur, Milbemax, Credelio, Frontline, Advantage) van en la lista de dewormings, NO en vacunas. Bravecto/NexGard/Simparica/Frontline/Advantage = EXTERNAL; Drontal/Endogard/Panacur/Milbemax = INTERNAL; si el producto cubre ambos (p.ej. Simparica Trio, Nexgard Spectro) = BOTH.
- Revisa TODAS las imágenes, incluidas las que parezcan repetidas: suelen ser páginas distintas de la misma cartilla.
- Si una foto no es una cartilla o no tiene registros legibles, simplemente no agregues filas por ella.
- Llama siempre a la herramienta registrar_cartilla, aun si las listas quedan vacías.`;

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVaccine(
  raw: unknown,
  validCodes: Set<string>
): CartillaVaccineSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const name = firstString(v.name);
  const appliedAt = firstString(v.appliedAt);
  // Antes se descartaba la fila si no traía nombre. Un renglón con fecha pero
  // con el tipo ilegible sigue siendo útil: el admin sólo elige el tipo.
  if (!name && !appliedAt) return null;
  const code = firstString(v.catalogCode);
  return {
    name: name ?? "Vacuna (sin especificar)",
    // Si el modelo inventa un código que no existe, lo tiramos en vez de
    // mandar basura que la app no va a poder mapear.
    catalogCode: code && validCodes.has(code) ? code : null,
    appliedAt,
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
  photoUrls: string[],
  catalog: VaccineCatalogOption[] = []
): Promise<CartillaExtraction> {
  if (photoUrls.length === 0) {
    return { vaccines: [], dewormings: [] };
  }

  return extraerDeImagenes(
    photoUrls.map((url) => ({ type: "image", source: { type: "url", url } })),
    catalog
  );
}

/**
 * Igual que `extraerCartilla` pero recibiendo los bloques de imagen ya armados
 * (URL de Cloudinary en producción, base64 al probar contra una imagen local).
 */
export async function extraerDeImagenes(
  imageBlocks: Anthropic.ImageBlockParam[],
  catalog: VaccineCatalogOption[] = []
): Promise<CartillaExtraction> {
  if (imageBlocks.length === 0) {
    return { vaccines: [], dewormings: [] };
  }

  const tool = buildExtractionTool(catalog);
  const validCodes = new Set(catalog.map((c) => c.code));

  const response = await client().messages.create({
    model: "claude-opus-5",
    // Cubre razonamiento + respuesta: en Opus 5 el thinking está encendido por
    // defecto y max_tokens es el tope de los dos juntos. Con 4096 una cartilla
    // de varias páginas se quedaba corta.
    max_tokens: 16000,
    // Leer una cartilla borrosa y deducir la vacuna a partir de la marca es
    // exactamente el tipo de tarea que mejora con razonamiento.
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text:
              "Transcribe TODAS las vacunas y desparasitaciones de esta cartilla. " +
              "Recorre la tabla renglón por renglón; para cada uno identifica la " +
              "vacuna a partir de la marca o las siglas y asígnale su catalogCode.",
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
    ? input.vaccines
        .map((v) => normalizeVaccine(v, validCodes))
        .filter((v): v is CartillaVaccineSuggestion => v !== null)
    : [];
  const dewormings = Array.isArray(input.dewormings)
    ? input.dewormings
        .map(normalizeDeworming)
        .filter((d): d is CartillaDewormingSuggestion => d !== null)
    : [];

  return { vaccines, dewormings };
}
