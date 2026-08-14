-- Quién completó el servicio de un add-on.
--
-- Hasta ahora completar un baño EXIGÍA foto, y el único registro de quién lo
-- hizo era el StayUpdate de esa foto (el detalle admin lo deducía por una
-- heurística sobre el caption). Al volver la foto opcional —el equipo pidió
-- poder cerrar la cita cuando con las prisas no hay foto, en vez de subir
-- cualquier imagen— ese rastro desaparecería.
--
-- Mismo patrón de auditoría que extraSetById y courtesySetById: columna
-- nullable con FK ON DELETE SET NULL (borrar un usuario no debe borrar el
-- historial del servicio). Los add-ons ya completados quedan en NULL y siguen
-- resolviéndose por el StayUpdate.
ALTER TABLE "reservation_addons" ADD COLUMN "completedById" TEXT;

ALTER TABLE "reservation_addons" ADD CONSTRAINT "reservation_addons_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
