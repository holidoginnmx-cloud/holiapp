import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getDeliveryStatus,
  getDeliveryAddress,
  saveDeliveryAddress,
  deliveryQuote,
} from "@/lib/api";
import type { SelectedAddress } from "@/components/DeliveryAddressPicker";

/** Payload `homeDelivery` que esperan los create-intent de la API. */
export type HomeDeliveryPayload = {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
};

/**
 * Bloque completo de "Servicio a domicilio" de los wizards de creación
 * (guardería, baño, hospedaje). El flujo es idéntico en todos:
 *
 * 1. Gate: ¿el servicio está activo? (decide si se muestra la opción).
 * 2. Precarga de la dirección guardada del usuario.
 * 3. Cotización de distancia + tarifa al elegir dirección.
 * 4. Payload para el create-intent y persistencia best-effort de la dirección.
 */
export function useHomeDelivery() {
  const [homeDeliveryEnabled, setHomeDeliveryEnabled] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);

  // ¿El servicio está activo? Gate para mostrar la opción.
  const { data: deliveryStatus } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: getDeliveryStatus,
    staleTime: 1000 * 60 * 10,
  });
  const deliveryServiceActive = deliveryStatus?.active === true;

  // Precarga la dirección guardada del usuario (para futuras reservas).
  const { data: savedAddress } = useQuery({
    queryKey: ["delivery-address"],
    queryFn: getDeliveryAddress,
    enabled: deliveryServiceActive,
  });
  useEffect(() => {
    if (
      !deliveryAddress &&
      savedAddress?.address &&
      savedAddress.addressLat != null &&
      savedAddress.addressLng != null
    ) {
      setDeliveryAddress({
        address: savedAddress.address,
        lat: savedAddress.addressLat,
        lng: savedAddress.addressLng,
        placeId: savedAddress.addressPlaceId ?? undefined,
      });
    }
  }, [savedAddress, deliveryAddress]);

  // Cotiza distancia + tarifa para la dirección seleccionada.
  const { data: deliveryQuoteData, isLoading: deliveryQuoteLoading } = useQuery({
    queryKey: ["delivery-quote", deliveryAddress?.lat, deliveryAddress?.lng],
    queryFn: () => deliveryQuote(deliveryAddress!.lat, deliveryAddress!.lng),
    enabled: homeDeliveryEnabled && !!deliveryAddress,
  });
  const deliveryActive =
    homeDeliveryEnabled && !!deliveryAddress && deliveryQuoteData?.active === true;
  const deliveryFee = deliveryActive ? deliveryQuoteData!.fee : 0;

  const homeDeliveryPayload: HomeDeliveryPayload | undefined =
    deliveryActive && deliveryAddress
      ? {
          address: deliveryAddress.address,
          lat: deliveryAddress.lat,
          lng: deliveryAddress.lng,
          placeId: deliveryAddress.placeId,
        }
      : undefined;

  // Si activó domicilio, exige una dirección con cotización válida antes de pagar.
  const deliveryIncomplete = homeDeliveryEnabled && !deliveryActive;

  /** Guarda la dirección para precargarla en futuras reservas (best-effort). */
  const persistAddress = () => {
    if (homeDeliveryPayload && deliveryAddress) {
      saveDeliveryAddress({
        address: deliveryAddress.address,
        lat: deliveryAddress.lat,
        lng: deliveryAddress.lng,
        placeId: deliveryAddress.placeId,
      }).catch(() => {});
    }
  };

  return {
    deliveryServiceActive,
    homeDeliveryEnabled,
    setHomeDeliveryEnabled,
    deliveryAddress,
    setDeliveryAddress,
    deliveryQuoteData,
    deliveryQuoteLoading,
    deliveryActive,
    deliveryFee,
    homeDeliveryPayload,
    deliveryIncomplete,
    persistAddress,
  };
}

export type HomeDeliveryState = ReturnType<typeof useHomeDelivery>;
