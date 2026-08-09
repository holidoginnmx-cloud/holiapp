import { apiFetch } from "./client";

// ─── Servicio a domicilio (cliente; el backend hace proxy a Google) ──
export type PlacePrediction = { placeId: string; description: string };

// Gate ligero: ¿el servicio a domicilio está activo? Permite decidir si
// mostrar la opción ANTES de tener una dirección (el quote requiere lat/lng).
export const getDeliveryStatus = () =>
  apiFetch<{ active: boolean }>("/delivery/status");

export const deliveryAutocomplete = (input: string, sessionToken?: string) =>
  apiFetch<{ predictions: PlacePrediction[] }>(
    "/delivery/places/autocomplete",
    { method: "POST", body: JSON.stringify({ input, sessionToken }) }
  );

export const deliveryPlaceDetails = (placeId: string, sessionToken?: string) =>
  apiFetch<{ lat: number; lng: number; address: string }>(
    "/delivery/places/details",
    { method: "POST", body: JSON.stringify({ placeId, sessionToken }) }
  );

export const deliveryQuote = (lat: number, lng: number) =>
  apiFetch<{ active: boolean; distanceKm: number; fee: number }>(
    "/delivery/quote",
    { method: "POST", body: JSON.stringify({ lat, lng }) }
  );

export type SavedDeliveryAddress = {
  address: string | null;
  addressLat: number | null;
  addressLng: number | null;
  addressPlaceId: string | null;
};

export const getDeliveryAddress = () =>
  apiFetch<SavedDeliveryAddress>("/delivery/address");

export const saveDeliveryAddress = (data: {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}) =>
  apiFetch<SavedDeliveryAddress>("/delivery/address", {
    method: "PUT",
    body: JSON.stringify(data),
  });
