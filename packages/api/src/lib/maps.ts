// Proxy a Google Maps Platform. La API key vive SOLO aquí (server-side, env
// GOOGLE_MAPS_API_KEY); la app móvil nunca la ve. El origen del cálculo de
// distancia son las instalaciones HDI (env HDI_ORIGIN_LAT / HDI_ORIGIN_LNG).

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

/** Autocompletado de direcciones (restringido a México). */
export async function placesAutocomplete(
  input: string,
  sessionToken?: string
): Promise<PlacePrediction[]> {
  const params = new URLSearchParams({
    input,
    key: apiKey(),
    language: "es",
    components: "country:mx",
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

/** Detalle de un lugar → coordenadas + dirección formateada. */
export async function placeDetails(
  placeId: string,
  sessionToken?: string
): Promise<{ lat: number; lng: number; address: string }> {
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
