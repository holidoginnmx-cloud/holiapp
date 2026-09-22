// Proxy a Google Maps Platform. La API key vive SOLO aquí (server-side, env
// GOOGLE_MAPS_API_KEY); la app móvil nunca la ve. El origen del cálculo de
// distancia son las instalaciones HDI (env HDI_ORIGIN_LAT / HDI_ORIGIN_LNG).

// Places API (New). Google ya no deja habilitar la "Places API (Legacy)" en
// proyectos nuevos y, si la key solo tiene la New, el endpoint legacy responde
// REQUEST_DENIED: la app lo veía como "Sin resultados" y nunca salían opciones.
// Por eso se intenta primero la New y, si falla, la legacy (keys viejas que
// solo tengan esa habilitada siguen funcionando).
const PLACES_NEW_AUTOCOMPLETE =
  "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_NEW_DETAILS = "https://places.googleapis.com/v1/places";
const PLACES_AUTOCOMPLETE =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const PLACE_DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";
const DISTANCE_MATRIX =
  "https://maps.googleapis.com/maps/api/distancematrix/json";

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY no configurada en el servidor");
  }
  return key;
}

function hdiOrigin(): { lat: number; lng: number } {
  const lat = Number(process.env.HDI_ORIGIN_LAT);
  const lng = Number(process.env.HDI_ORIGIN_LNG);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("HDI_ORIGIN_LAT / HDI_ORIGIN_LNG no configuradas");
  }
  return { lat, lng };
}

export type PlacePrediction = { placeId: string; description: string };

// Bounding box de Sonora (rectangle:south,west|north,east). Google no permite
// filtrar por estado vía `components`, así que se restringe geográficamente.
const SONORA = { south: 26.0, west: -115.1, north: 32.55, east: -108.3 };
const SONORA_BOUNDS = `rectangle:${SONORA.south},${SONORA.west}|${SONORA.north},${SONORA.east}`;

/** Corre la versión New y, si truena, la legacy. Si ambas fallan, junta los dos errores. */
async function newThenLegacy<T>(
  viaNew: () => Promise<T>,
  viaLegacy: () => Promise<T>
): Promise<T> {
  try {
    return await viaNew();
  } catch (errNew) {
    try {
      return await viaLegacy();
    } catch (errLegacy) {
      throw new Error(
        `${(errNew as Error).message} | legacy: ${(errLegacy as Error).message}`
      );
    }
  }
}

/** Autocompletado de direcciones (restringido a Sonora, México). */
export function placesAutocomplete(
  input: string,
  sessionToken?: string
): Promise<PlacePrediction[]> {
  return newThenLegacy(
    () => placesAutocompleteNew(input, sessionToken),
    () => placesAutocompleteLegacy(input, sessionToken)
  );
}

async function placesAutocompleteNew(
  input: string,
  sessionToken?: string
): Promise<PlacePrediction[]> {
  const res = await fetch(PLACES_NEW_AUTOCOMPLETE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
    },
    body: JSON.stringify({
      input,
      languageCode: "es",
      includedRegionCodes: ["mx"],
      locationRestriction: {
        rectangle: {
          low: { latitude: SONORA.south, longitude: SONORA.west },
          high: { latitude: SONORA.north, longitude: SONORA.east },
        },
      },
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(
      `Places (New) autocomplete: ${res.status} ${json?.error?.message ?? ""}`
    );
  }
  // Sin coincidencias la New responde `{}` (no hay status ZERO_RESULTS).
  return (json.suggestions ?? [])
    .map((s: any) => s.placePrediction)
    .filter((p: any) => p?.placeId)
    .map((p: any) => ({
      placeId: p.placeId,
      description: p.text?.text ?? "",
    }));
}

async function placesAutocompleteLegacy(
  input: string,
  sessionToken?: string
): Promise<PlacePrediction[]> {
  const params = new URLSearchParams({
    input,
    key: apiKey(),
    language: "es",
    components: "country:mx",
    locationrestriction: SONORA_BOUNDS,
  });
  if (sessionToken) params.set("sessiontoken", sessionToken);

  const res = await fetch(`${PLACES_AUTOCOMPLETE}?${params.toString()}`);
  const json: any = await res.json();
  if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
    throw new Error(`Places autocomplete: ${json.status} ${json.error_message ?? ""}`);
  }
  return (json.predictions ?? []).map((p: any) => ({
    placeId: p.place_id,
    description: p.description,
  }));
}

type PlaceDetails = { lat: number; lng: number; address: string };

/** Detalle de un lugar → coordenadas + dirección formateada. */
export function placeDetails(
  placeId: string,
  sessionToken?: string
): Promise<PlaceDetails> {
  return newThenLegacy(
    () => placeDetailsNew(placeId, sessionToken),
    () => placeDetailsLegacy(placeId, sessionToken)
  );
}

async function placeDetailsNew(
  placeId: string,
  sessionToken?: string
): Promise<PlaceDetails> {
  const params = new URLSearchParams({ languageCode: "es" });
  if (sessionToken) params.set("sessionToken", sessionToken);
  const res = await fetch(
    `${PLACES_NEW_DETAILS}/${encodeURIComponent(placeId)}?${params.toString()}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": "location,formattedAddress",
      },
    }
  );
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(
      `Place (New) details: ${res.status} ${json?.error?.message ?? ""}`
    );
  }
  const loc = json.location;
  if (!loc) throw new Error("Place (New) details: sin geometría");
  return {
    lat: loc.latitude,
    lng: loc.longitude,
    address: json.formattedAddress ?? "",
  };
}

async function placeDetailsLegacy(
  placeId: string,
  sessionToken?: string
): Promise<PlaceDetails> {
  const params = new URLSearchParams({
    place_id: placeId,
    key: apiKey(),
    language: "es",
    fields: "geometry,formatted_address",
  });
  if (sessionToken) params.set("sessiontoken", sessionToken);

  const res = await fetch(`${PLACE_DETAILS}?${params.toString()}`);
  const json: any = await res.json();
  if (json.status !== "OK") {
    throw new Error(`Place details: ${json.status} ${json.error_message ?? ""}`);
  }
  const loc = json.result?.geometry?.location;
  if (!loc) throw new Error("Place details: sin geometría");
  return {
    lat: loc.lat,
    lng: loc.lng,
    address: json.result.formatted_address ?? "",
  };
}

/** Distancia por carretera (solo ida, en km) entre HDI y el destino. */
export async function distanceKmFromHdi(
  destLat: number,
  destLng: number
): Promise<number> {
  const origin = hdiOrigin();
  const params = new URLSearchParams({
    origins: `${origin.lat},${origin.lng}`,
    destinations: `${destLat},${destLng}`,
    key: apiKey(),
    units: "metric",
    mode: "driving",
  });

  const res = await fetch(`${DISTANCE_MATRIX}?${params.toString()}`);
  const json: any = await res.json();
  if (json.status !== "OK") {
    throw new Error(`Distance matrix: ${json.status} ${json.error_message ?? ""}`);
  }
  const element = json.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") {
    throw new Error(
      `Distance matrix: ruta no disponible (${element?.status ?? "sin elemento"})`
    );
  }
  // distance.value viene en metros.
  return element.distance.value / 1000;
}
