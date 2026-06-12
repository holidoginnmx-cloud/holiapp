import type { CartillaStatus } from "@prisma/client";

// Política de cartilla para poder reservar.
//
// Móvil / usuarios logueados (source !== "web"): solo APPROVED puede reservar.
//   Esto NO cambia — los handlers de móvil siguen con su `!== "APPROVED"` literal.
//
// Invitado web (source === "web"): se permite PENDING (recién subida, sin
//   revisar) porque el equipo HDI revisa la cartilla ANTES del check-in. Solo
//   se bloquean EXPIRED y REJECTED: una cartilla con vacuna vencida o rechazada
//   es un "no" explícito y no debe pasar ni en web.
export function cartillaBlocks(
  pet: { cartillaStatus: CartillaStatus | null },
  source?: string
): boolean {
  if (source === "web") {
    return pet.cartillaStatus === "EXPIRED" || pet.cartillaStatus === "REJECTED";
  }
  return pet.cartillaStatus !== "APPROVED";
}
