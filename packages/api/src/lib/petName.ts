// La regla vive en shared para que la app del equipo avise del duplicado
// mientras se captura, con la MISMA comparación que el candado de POST /pets.
export {
  normalizePetName,
  findPetByName,
  claveNombre,
  findSimilarPetByName,
} from "@holidoginn/shared";
