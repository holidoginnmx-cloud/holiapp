import { dewormSizeFromWeight, dewormSizeRangeLabel } from "@holidoginn/shared";

/**
 * El desparasitante se cobra por PESO (`DEWORM_RANGES_KG`). Si el perro tiene
 * peso y quien lo agrega es del staff, la talla elegida tiene que ser la de su
 * peso: elegir otra es cambiar el precio, y eso es decisión de admin (el admin
 * sí puede, por si el peso de la ficha está desactualizado). Sin peso, o con un
 * peso fuera de los tramos, no hay contra qué comparar y se acepta la elegida.
 * Tampoco si la talla que le toca está desactivada en el catálogo: si no, el
 * staff se quedaría sin ninguna opción válida.
 * Devuelve el mensaje de error, o null si procede.
 */
export function dewormVariantMismatch(params: {
  serviceCode: string;
  variantPetSize: string;
  weightKg: number | null | undefined;
  isAdmin: boolean;
  petName: string;
  /** ¿Existe y está activa la variante de la talla que le toca? */
  expectedAvailable: boolean;
}): string | null {
  if (params.serviceCode !== "DEWORMING" || params.isAdmin) return null;
  if (!params.expectedAvailable) return null;
  const esperada = dewormSizeFromWeight(params.weightKg);
  if (!esperada || esperada === params.variantPetSize) return null;
  return `A ${params.petName} (${params.weightKg} kg) le toca el desparasitante de ${dewormSizeRangeLabel(esperada)}`;
}
